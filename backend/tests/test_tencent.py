from app.provider_worker import tencent_parse
from app.providers import normalize_quotes


def test_chinese_quote_decoding_namespace_timestamps_and_cap_units():
    fields=['0']*50
    for index,value in {1:'贵州茅台',3:'1600',6:'1200',30:'20261030150000',32:'1.25',38:'0.5',39:'22.3',45:'20000'}.items():fields[index]=value
    text='v_sh600519="'+'~'.join(fields)+'";'
    directory=[{'public_code':'sh600519','symbol':'600519.SH','name':'贵州茅台','type':'Equity','currency':'CNY'}]
    rows=tencent_parse(text.encode('gb18030').decode('gb18030'),directory)
    quote=normalize_quotes(rows,'cn',{})[0]
    assert quote['symbol']=='600519.SH' and quote['name']=='贵州茅台' and quote['price']==1600
    assert quote['market_cap']==2_000_000_000_000 and quote['pe']==22.3
    assert quote['source_time']=='2026-10-30T15:00:00+08:00'
    fields[30]='20260231150000'
    assert tencent_parse('v_sh600519="'+'~'.join(fields)+'";',directory)==[]


def test_index_and_etf_do_not_receive_equity_fundamentals():
    fields=['0']*50;fields[3]='4';fields[30]='20261030150000';fields[39]='22';fields[45]='2000'
    directory=[{'public_code':'sh510300','symbol':'510300.SH','name':'ETF','type':'Fund','currency':'CNY'}]
    result=tencent_parse('v_sh510300="'+'~'.join(fields)+'";',directory)[0]
    assert result['市盈率'] is None and result['总市值'] is None
