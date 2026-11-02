from app.providers import MarketData
from app.cache import MemoryCache


async def test_partial_scans_merge_without_rejuvenating_old_row_timestamps(settings):
    now=[1000.0];calls=[0]
    async def run(provider,task,args):
        calls[0]+=1
        code='600519' if calls[0]==1 else '000001'
        return {'ok':True,'rows':[{'代码':code,'最新价':10,'_retrieved_epoch':now[0]}],
                'meta':{'driver':'tencent_public','frequency':'snapshot','partial':True}}
    service=MarketData(settings,MemoryCache(),run,clock=lambda:now[0])
    first=await service.get('snapshot',ttl=10)
    assert first['state']=='partial'
    now[0]=1020
    merged=await service.get('snapshot',ttl=10)
    by_symbol={row['symbol']:row for row in merged['rows']}
    assert len(by_symbol)==2
    assert by_symbol['600519.SH']['age_seconds']==20 and by_symbol['600519.SH']['is_stale'] is True
    assert by_symbol['000001.SZ']['age_seconds']==0 and by_symbol['000001.SZ']['is_stale'] is False


async def test_direct_lookup_rejects_unconfigured_symbols(client):
    http,_=client
    reply=await http.get('/api/cn/equity/snapshot?symbols=FAKE.SH')
    assert reply.status_code==422
    assert (await http.get('/api/cn/equity/snapshot?symbols=600519.SH')).status_code==200
    assert len((await http.get('/api/cn/equity/snapshot?symbols=600519.SH')).json()['rows'])==1
    assert (await http.get('/api/cn/equity/snapshot?market=fund&symbols=600519.SH')).status_code==422
    assert (await http.get('/api/cn/equity/detail/financials?symbol=000001.SH')).json()['state']=='unsupported'
