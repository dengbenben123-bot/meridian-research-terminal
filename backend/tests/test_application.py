from dataclasses import replace
import hashlib
import json
from pathlib import Path
import pytest
from sqlalchemy import select
from app.config import Settings
from app.storage import WatchItem, Audit, Database
from app.main import create_app
from app.cache import MemoryCache
from .conftest import fixture_runner


async def test_private_gate_and_public_health(client):
    http,app=client
    assert (await http.get('/healthz',auth=None)).json()=={'status':'ok','version':'5.0.0'}
    for path in ['/api/status','/api/search','/api/docs']:
        reply=await http.get(path,auth=None)
        assert reply.status_code==401 and 'Basic' in reply.headers['WWW-Authenticate']
    assert (await http.get('/api/status',headers={'Authorization':'Basic !!!'},auth=None)).status_code==401
    result=await http.get('/api/status')
    assert result.status_code==200 and result.json()['live_execution'] is False
    assert result.headers['cache-control']=='no-store'
    assert 'fixture-password' not in result.text


async def test_search_chinese_pinyin_and_ambiguous_stock_index_codes(client):
    http,_=client
    for text in ['贵州','gzmt','600519']:
        rows=(await http.get('/api/search',params={'q':text})).json()['items']
        assert rows[0]['symbol']=='600519.SH'
    rows=(await http.get('/api/search?q=000001')).json()['items']
    assert {row['symbol'] for row in rows}=={'000001.SH','000001.SZ'}
    assert (await http.get('/api/search?q=%25')).json()['items']==[]


async def test_screening_missing_values_never_pass_bounds_and_industry_is_source_enriched(client):
    http,_=client
    result=(await http.get('/api/cn/equity/snapshot?pe_min=1')).json()
    assert len(result['rows'])==1 and result['rows'][0]['symbol']=='600519.SH'
    assert result['rows'][0]['source_time'] is None
    assert (await http.get('/api/cn/equity/snapshot?industry=白酒')).json()['rows']==[]
    assert (await http.get('/api/cn/equity/detail/overview?symbol=600519.SH')).status_code==200
    assert len((await http.get('/api/cn/equity/snapshot?industry=白酒')).json()['rows'])==1
    assert (await http.get('/api/cn/equity/snapshot?pe_min=nan')).status_code==422


async def test_cross_origin_writes_rejected_before_watchlist_mutation(client):
    http,_=client
    body={'symbol':'600519.SH','group':'我的自选'}
    assert (await http.post('/api/watchlists',json=body,headers={'Origin':'https://other.test'})).status_code==403
    assert (await http.post('/api/watchlists',json=body,headers={'X-Meridian-Request':'0'})).status_code==403
    assert (await http.get('/api/watchlists')).json()['items']==[]


async def test_watchlist_crud_is_idempotent_persistent_and_owner_scoped(client):
    http,app=client
    body={'symbol':'600519.SH','group':'重点'}
    for _ in range(2): assert (await http.post('/api/watchlists',json=body)).status_code==200
    with app.state.db.session() as db: db.add(WatchItem(owner='other',group='私密',symbol='000001.SZ'))
    items=(await http.get('/api/watchlists')).json()['items']
    assert len(items)==1 and items[0]['instrument']['name']=='贵州茅台'
    assert (await http.request('DELETE','/api/watchlists',json=body)).status_code==200
    assert (await http.get('/api/watchlists')).json()['items']==[]
    with app.state.db.session() as db: assert len(list(db.scalars(select(Audit))))==3


async def test_saved_filters_and_workspaces_reject_unknown_fields(client):
    http,_=client
    workspace={'category':'workspace','name':'研究','content':{'view':'detail','selected_symbol':'600519.SH','news_dock':'right'}}
    assert (await http.post('/api/preferences',json=workspace)).status_code==200
    result=(await http.get('/api/preferences')).json()['items'][0]
    assert result['content']['news_dock']=='right' and result['content']['selected_kind']=='equity'
    workspace['content']['live_execution']=True
    assert (await http.post('/api/preferences',json=workspace)).status_code==422
    assert (await http.post('/api/preferences',json={'category':'screen','name':'估值','content':{'pe_max':30}})).status_code==200
    assert (await http.get('/api/preferences?category=screen')).json()['items'][0]['content']['pe_max']==30


async def test_detail_bars_macro_and_unsupported_assets(client):
    http,_=client
    result=(await http.get('/api/cn/equity/bars?symbol=600519.SH')).json()
    assert len(result['rows'])==28 and result['rows'][0]['date']=='2026-09-01'
    assert result['indicators'][0]['rsi14'] is None and result['indicators'][-1]['rsi14']==100
    assert result['indicators'][0]['ma20'] is None
    assert (await http.get('/api/cn/equity/detail/financials?symbol=00700.HK')).json()['state']=='unsupported'
    assert (await http.get('/api/cn/equity/detail/shareholders?symbol=600519.SH')).status_code==422
    assert (await http.get('/api/cn/macro/unknown')).status_code==422
    assert (await http.get('/api/cn/macro/gdp')).json()['rows'][1]['GDP(亿元)'] is None


async def test_paper_preview_submit_idempotency_and_limit_cancel(client):
    http,_=client
    order={'symbol':'600519.SH','side':'buy','quantity':100,'order_type':'market'}
    preview=(await http.post('/api/broker/preview',json=order)).json()
    assert preview['paper'] is True and preview['last_price']==10
    first=await http.post('/api/broker/submit',json={'preview_id':preview['preview_id']})
    second=await http.post('/api/broker/submit',json={'preview_id':preview['preview_id']})
    assert first.status_code==second.status_code==200 and first.json()['order_id']==second.json()['order_id']
    account=(await http.get('/api/broker/positions')).json()
    assert account['positions'][0]['quantity']==100 and account['cash']==998999.7
    assert (await http.post('/api/broker/cancel/'+first.json()['order_id'],json={})).status_code==409
    order.update(order_type='limit',limit_price=9)
    pending=(await http.post('/api/broker/preview',json=order)).json()
    submitted=(await http.post('/api/broker/submit',json={'preview_id':pending['preview_id']})).json()
    assert submitted['state']=='pending'
    account=(await http.get('/api/broker/positions')).json()
    assert account['available_cash']<account['cash']
    assert (await http.post('/api/broker/cancel/'+submitted['order_id'],json={})).json()['state']=='cancelled'


async def test_paper_input_and_missing_position_rejections(client):
    http,_=client
    for order in [{'symbol':'600519.SH','side':'buy','quantity':-1},
                  {'symbol':'600519.SH','side':'buy','quantity':1.5},
                  {'symbol':'600519.SH','side':'buy','quantity':150},
                  {'symbol':'510300.SH','side':'buy','quantity':100},
                  {'symbol':'600519.SH','side':'sell','quantity':100}]:
        assert (await http.post('/api/broker/preview',json=order)).status_code in (409,422)


async def test_qmt_is_a_real_unimplemented_boundary_not_simulated_live(client):
    http,app=client
    from app.brokers import QMTAdapter
    app.state.broker=QMTAdapter()
    reply=await http.post('/api/broker/preview',json={'symbol':'600519.SH','side':'buy','quantity':100})
    assert reply.status_code==501 and reply.json()['live_execution'] is False


def test_password_special_characters_are_escaped_without_echo(monkeypatch):
    from sqlalchemy.engine import make_url
    password='x:@/+# secret'
    monkeypatch.delenv('DATABASE_URL',raising=False)
    monkeypatch.setenv('POSTGRES_PASSWORD',password)
    assert make_url(Settings.from_env().database_url).password==password


def test_real_seed_has_5000_unique_symbols():
    seed=Path(__file__).resolve().parents[1]/'data/universe.json'
    rows=json.loads(seed.read_text(encoding='utf-8'))['instruments']
    assert len(rows)==5000 and len({r['symbol'] for r in rows})==5000
    assert sum(r['type']=='Fund' for r in rows)==180
