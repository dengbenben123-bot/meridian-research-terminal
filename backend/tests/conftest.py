from dataclasses import replace
import hashlib
import json
import pytest
import httpx
from app.main import create_app
from app.config import Settings
from app.cache import MemoryCache
from app.storage import Database


@pytest.fixture
def settings(tmp_path):
    seed = tmp_path/'seed.json'
    seed.write_text(json.dumps({'instruments':[
        {'symbol':'600519.SH','name':'贵州茅台','type':'Equity'},
        {'symbol':'000001.SZ','name':'平安银行','type':'Equity'},
        {'symbol':'000001.SH','name':'上证指数','type':'Index'},
        {'symbol':'510300.SH','name':'沪深300ETF','type':'Fund'}]},ensure_ascii=False),encoding='utf-8')
    return Settings(database_url='sqlite://',auth_digest=hashlib.sha256(b'owner:fixture-password').hexdigest(),
                    scheduler_enabled=False,seed_path=seed)


async def fixture_runner(provider, task, args):
    meta={'source':'Test fixture only','frequency':'snapshot'}
    if task=='snapshot':
        rows=[{'代码':'600519','名称':'贵州茅台','最新价':10.0,'涨跌幅':2.0,'成交量':1200,'换手率':1,'市盈率-动态':20,'总市值':2000000000},
              {'代码':'000001','名称':'平安银行','最新价':8.0,'涨跌幅':-1,'成交量':1000,'总市值':None}]
    elif task=='bars':
        rows=[{'日期':f'2026-09-{day:02d}','开盘':day+10,'最高':day+12,'最低':day+9,'收盘':day+11,'成交量':1000} for day in range(1,29)]
    elif task=='overview':
        rows=[{'item':'行业','value':'白酒'}]
    elif task=='macro':
        rows=[{'季度':'2025年第1季度','GDP(亿元)':300000},{'季度':'2025年第2季度','GDP(亿元)':None}]
    elif task=='news':
        rows=[{'标题':'Fixture news, not production data','内容':'测试文本','发布时间':'2026-10-30 10:00:00'}]
    else:
        rows=[]
    return {'ok':True,'rows':rows,'meta':meta}


@pytest.fixture
async def client(settings):
    application=create_app(settings,cache=MemoryCache(),runner=fixture_runner)
    async with application.router.lifespan_context(application):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application),base_url='https://terminal.test',
               auth=('owner','fixture-password'),headers={'X-Meridian-Request':'1','Origin':'https://terminal.test'}) as http:
            yield http,application
