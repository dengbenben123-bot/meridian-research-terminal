import asyncio
from dataclasses import replace
import inspect
import math
from pathlib import Path
import json
import pytest
from app.providers import MarketData, ProviderRunner, normalize_quotes, normalize_bars, number
from app.cache import MemoryCache
from app.indicators import calculate
from app.brokers import PaperBrokerAdapter, BrokerError, PTradeAdapter
from app.models import PreviewOrder


def test_index_stock_etf_and_hk_symbol_namespaces_do_not_collide():
    row={'代码':'000001','名称':'上证指数','最新价':3000}
    assert normalize_quotes([row],'cn',{})[0]['symbol']=='000001.SZ'
    assert normalize_quotes([row],'index',{})[0]['symbol']=='000001.SH'
    assert normalize_quotes([{'代码':'510300'}],'fund',{})[0]['symbol']=='510300.SH'
    assert normalize_quotes([{'代码':'159915'}],'fund',{})[0]['symbol']=='159915.SZ'
    assert normalize_quotes([{'代码':'700'}],'hk',{})[0]['symbol']=='00700.HK'
    assert number('nan') is None and number('inf') is None and number('--') is None


def test_bar_validation_rejects_fabricated_candles_and_keeps_dates():
    rows=[{'日期':'20261030','开盘':10,'最高':12,'最低':9,'收盘':11,'成交量':None},
          {'日期':'20261029','开盘':10,'最高':9,'最低':8,'收盘':11},
          {'日期':'20261028','开盘':10,'最高':12,'最低':9,'收盘':float('nan')}]
    actual=normalize_bars(rows)
    assert len(actual)==1 and actual[0]['date']=='2026-10-30' and actual[0]['volume'] is None


async def test_shared_requests_are_coalesced_and_no_empty_source_becomes_success(settings):
    calls=[]
    async def run(provider,task,args):
        calls.append(task);await asyncio.sleep(.01)
        return {'ok':True,'rows':[{'代码':'600519','最新价':10}],'meta':{'frequency':'snapshot'}}
    service=MarketData(settings,MemoryCache(),run)
    left,right=await asyncio.gather(service.get('snapshot'),service.get('snapshot'))
    assert len(calls)==1 and left==right and left['state']=='ok'
    service=MarketData(settings,MemoryCache(),lambda *args:None)
    result=await service.get('snapshot')
    assert result['state']=='unavailable' and result['rows']==[]


async def test_failed_refresh_retains_original_time_and_marks_stale_with_cooldown(settings):
    now=[1000.0];healthy=[True];calls=[]
    async def run(provider,task,args):
        calls.append(provider)
        return {'ok':True,'rows':[{'代码':'600519','最新价':10}],'meta':{'frequency':'snapshot'}} if healthy[0] else {'ok':False,'error':'Timeout'}
    service=MarketData(settings,MemoryCache(),run,clock=lambda:now[0])
    first=await service.get('snapshot',ttl=10)
    healthy[0]=False;now[0]=1020
    stale=await service.get('snapshot',ttl=10)
    assert stale['state']=='stale' and stale['received_at']==first['received_at'] and stale['age_seconds']==20
    await service.get('snapshot',ttl=10)
    assert len(calls)==2


async def test_optional_tushare_fallback_stays_explicitly_daily(settings):
    calls=[]
    async def run(provider,task,args):
        calls.append(provider)
        if provider=='akshare':return {'ok':False,'error':'SourceDown'}
        return {'ok':True,'rows':[{'ts_code':'600519.SH','close':10,'trade_date':'20261030'}],
                'meta':{'source':'Tushare daily fixture','frequency':'daily_close'}}
    service=MarketData(replace(settings,tushare_token='fixture-only'),MemoryCache(),run)
    result=await service.get('snapshot')
    assert calls==['akshare','tushare'] and result['meta']['frequency']=='daily_close'
    assert result['rows'][0]['source_time']=='20261030'


async def test_process_timeout_kills_and_waits_for_child(settings,monkeypatch):
    class Process:
        returncode=None
        killed=False
        waited=False
        async def communicate(self,data):await asyncio.sleep(100)
        def kill(self):self.killed=True;self.returncode=-9
        async def wait(self):self.waited=True
    process=Process()
    async def spawn(*args,**kwargs):return process
    monkeypatch.setattr(asyncio,'create_subprocess_exec',spawn)
    runner=ProviderRunner(settings);runner.timeout=.01
    result=await runner('akshare','snapshot',{})
    assert not result['ok'] and process.killed and process.waited


async def test_cancelled_provider_call_does_not_leave_a_running_child(settings,monkeypatch):
    class Process:
        returncode=None
        killed=False
        async def communicate(self,data):await asyncio.sleep(100)
        def kill(self):self.killed=True;self.returncode=-9
        async def wait(self):return -9
    process=Process()
    async def spawn(*args,**kwargs):return process
    monkeypatch.setattr(asyncio,'create_subprocess_exec',spawn)
    task=asyncio.create_task(ProviderRunner(settings)('akshare','snapshot',{}))
    await asyncio.sleep(.01);task.cancel()
    with pytest.raises(asyncio.CancelledError):await task
    assert process.killed


def test_indicators_constant_series_have_no_infinite_or_fabricated_warmup_values():
    bars=[{'date':str(i),'open':10,'high':10,'low':10,'close':10,'volume':0} for i in range(80)]
    result=calculate(bars)
    assert result[0]['rsi14'] is None and result[0]['ma5'] is None
    assert result[-1]['rsi14']==50 and result[-1]['ma60']==10 and result[-1]['atr14']==0
    assert result[-1]['macd']==0 and result[-1]['histogram']==0
    assert all(value is None or isinstance(value,str) or math.isfinite(value) for row in result for value in row.values())


async def test_paper_rejects_stale_data_and_expired_or_foreign_previews():
    now=[1000.0];age=[0]
    async def quote(symbol):return {'state':'ok','age_seconds':age[0],'price':10,'received_at':'fixture'}
    broker=PaperBrokerAdapter(quote,clock=lambda:now[0])
    order=PreviewOrder(symbol='600519.SH',side='buy',quantity=100)
    age[0]=100
    with pytest.raises(BrokerError):await broker.preview_order('owner',order)
    age[0]=0;preview=await broker.preview_order('owner',order)
    with pytest.raises(BrokerError):await broker.submit_order('other',preview['preview_id'])
    now[0]=1040
    with pytest.raises(BrokerError):await broker.submit_order('owner',preview['preview_id'])
    assert (await broker.get_positions('owner'))['positions']==[]


async def test_resting_limit_reserves_cash_and_fills_only_when_crossed():
    price=[10]
    async def quote(symbol):return {'state':'ok','age_seconds':0,'price':price[0]}
    broker=PaperBrokerAdapter(quote)
    preview=await broker.preview_order('owner',PreviewOrder(symbol='600519.SH',side='buy',quantity=100,order_type='limit',limit_price=9))
    order=await broker.submit_order('owner',preview['preview_id'])
    assert order['state']=='pending'
    await broker.mark([{'symbol':'600519.SH','price':9.5}])
    assert (await broker.get_positions('owner'))['positions']==[]
    await broker.mark([{'symbol':'600519.SH','price':8.5}])
    account=await broker.get_positions('owner')
    assert account['positions'][0]['quantity']==100 and account['cash']==999149.74
    assert account['available_cash']==account['cash']


def test_pinned_akshare_functions_and_argument_names_exist():
    import akshare as ak
    functions={'stock_zh_a_spot_em':[], 'stock_zh_a_spot_tx':[], 'stock_hk_spot_em':[], 'fund_etf_spot_em':[],
               'stock_zh_index_spot_em':['symbol'], 'stock_zh_a_hist':['symbol','adjust'],
               'stock_financial_analysis_indicator_em':['symbol','indicator'], 'stock_gdfx_top_10_em':['symbol','date'],
               'stock_notice_report':['symbol','date'], 'stock_info_global_cls':['symbol'],
               'stock_research_report_em':['symbol'], 'futures_zh_spot':['symbol','market','adjust'],
               'option_current_em':[], 'forex_spot_em':[], 'bond_china_yield':['start_date','end_date'],
               'macro_china_gdp':[], 'macro_china_cpi':[], 'macro_china_pmi':[], 'macro_china_lpr':[],
               'macro_china_money_supply':[], 'macro_china_imports_yoy':[], 'macro_china_exports_yoy':[]}
    for name,parameters in functions.items():
        assert callable(getattr(ak,name,None)),name
        assert all(key in inspect.signature(getattr(ak,name)).parameters for key in parameters),name


def test_optional_token_backed_tushare_requests_use_https(monkeypatch):
    import requests
    from app.provider_worker import tushare_client
    calls=[]
    class Reply:
        text='{"code":0,"data":{"fields":["ts_code","close"],"items":[["600519.SH",10]]}}'
    def post(url,**kwargs):
        calls.append((url,kwargs));return Reply()
    monkeypatch.setattr(requests,'post',post)
    result=tushare_client('fixture-token-only').daily(ts_code='600519.SH')
    assert len(result)==1 and calls[0][0].startswith('https://api.tushare.pro/')
    assert calls[0][1]['json']['token']=='fixture-token-only'
