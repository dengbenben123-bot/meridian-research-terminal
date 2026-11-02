"""A single bounded provider call in a disposable process. Input is stdin only."""
from datetime import datetime, timedelta
import contextlib
import io
import json
import os
import sys
from pathlib import Path
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from zoneinfo import ZoneInfo


def tencent_parse(text, directory):
    """Tencent's public web protocol: timestamps stay distinct from retrieval time."""
    lookup = {row['public_code']: row for row in directory}
    rows = []
    from .providers import number
    for match in re.finditer(r'v_([a-z0-9]+)="([^"\r\n]*)";', text):
        item = lookup.get(match[1])
        if not item:
            continue
        fields = match[2].split('~')
        if len(fields) < 46 or not number(fields[3]) or number(fields[3]) <= 0:
            continue
        digits = re.sub(r'[/: ]', '', fields[30])
        if not re.fullmatch(r'\d{14}', digits):
            continue
        try:
            stamp = datetime.strptime(digits, '%Y%m%d%H%M%S').replace(tzinfo=ZoneInfo('Asia/Shanghai')).isoformat()
        except ValueError:
            continue
        equity = item['type'] == 'Equity' and item['currency'] == 'CNY'
        cap = number(fields[45]) if equity else None
        rows.append({'代码': item['symbol'], '名称': fields[1] or item['name'], '最新价': number(fields[3]),
                     '涨跌幅': number(fields[32]), '成交量': number(fields[6]), '换手率': number(fields[38]) if equity else None,
                     '市盈率': number(fields[39]) if equity else None, '总市值': cap*100_000_000 if cap is not None else None,
                     '更新时间': stamp})
    return rows


def tencent_snapshot(market, symbols=None):
    import pandas as pd
    import requests
    directory = json.loads((Path(__file__).resolve().parents[1]/'data/universe.json').read_text(encoding='utf-8'))['instruments']
    kind = {'cn':'Equity','hk':'Equity','fund':'Fund','index':'Index'}[market]
    directory = [row for row in directory if row['type'] == kind and ((row['currency']=='HKD') == (market=='hk'))]
    if symbols:
        wanted = set(symbols)
        directory = [row for row in directory if row['symbol'] in wanted]
    groups = [directory[index:index+100] for index in range(0, len(directory), 100)]
    if groups:
        rotation = (int(time.time()/30)*13) % len(groups)
        groups = groups[rotation:]+groups[:rotation]
    def fetch(group):
        reply = requests.get('https://qt.gtimg.cn/q='+','.join(row['public_code'] for row in group),
                             headers={'User-Agent':'Mozilla/5.0 MeridianPublicTerminal'}, timeout=4)
        reply.raise_for_status()
        if len(reply.content) > 1_000_000:
            raise ValueError('Oversized quote batch')
        rows = tencent_parse(reply.content.decode('gb18030'), group)
        for row in rows:
            row['_retrieved_epoch'] = time.time()
        return rows
    executor = ThreadPoolExecutor(max_workers=4)
    jobs = [executor.submit(fetch, group) for group in groups]
    rows = []
    try:
        for job in as_completed(jobs, timeout=16):
            try:
                rows.extend(job.result())
            except Exception:
                pass
    except FuturesTimeout:
        pass
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
    return pd.DataFrame(rows), {'source':'Tencent 公开批量快照 · AkShare主源失败后的补充', 'driver':'tencent_public',
           'frequency':'snapshot','configured_expected':len(directory),'observed':len(rows),
           'partial':len(rows)<len(directory), 'timestamp_basis':'Provider timestamp, Asia/Shanghai; latency unverified'}


def run_akshare(task, args):
    import akshare as ak
    today = datetime.now(ZoneInfo('Asia/Shanghai'))
    end = today.strftime('%Y%m%d')
    start = (today - timedelta(days=1000)).strftime('%Y%m%d')
    code = args.get('symbol', '600519.SH').split('.')[0]
    market = args.get('market', 'cn')
    frequency = 'snapshot'
    if task == 'snapshot_fallback':
        return tencent_snapshot(market, args.get('symbols'))
    if task == 'bars_fallback':
        if args.get('period', 'daily') != 'daily' or args.get('kind') not in ('equity','fund','index') or args['symbol'].endswith('.HK'):
            raise NotImplementedError('Tencent daily fallback is unavailable for this asset')
        prefix = args['symbol'].split('.')[-1].lower()
        data = ak.stock_zh_a_hist_tx(symbol=prefix+code, start_date=start, end_date=end, adjust='')
        return data, {'source':'AkShare · Tencent 日线补充（未复权）','frequency':'daily_unadjusted','adjustment':'unadjusted'}
    if task == 'forex_fallback':
        data = ak.fx_spot_quote()
        if '货币对' in data.columns:
            data['代码'] = data['货币对'].astype(str).str.replace('/', '', regex=False)
        return data, {'source':'AkShare · 中国外汇交易中心 人民币即期买卖报价','frequency':'interbank_bid_ask_snapshot'}
    if task == 'options_fallback':
        # Contract reference data must not be presented as observed current option prices.
        data = ak.option_current_day_sse()
        data = data.rename(columns={'合约编码':'代码','合约简称':'名称'})
        return data, {'source':'AkShare · 上交所当日合约目录（无实时价格）','frequency':'contract_directory_no_quotes'}
    if task == 'overview_fallback':
        data = ak.stock_profile_cninfo(symbol=code)
        return data, {'source':'AkShare · 巨潮资讯 公司资料','frequency':'latest_available'}
    if task == 'financials_fallback':
        import pandas as pd
        prefix = args['symbol'].split('.')[-1].lower()
        frames = []
        for statement in ['利润表', '资产负债表', '现金流量表']:
            frame = ak.stock_financial_report_sina(stock=prefix+code, symbol=statement)
            frame['报表类型'] = statement
            frames.append(frame)
        return pd.concat(frames, ignore_index=True), {'source':'AkShare · Sina 公开三大财务报表','frequency':'reported_financial_statements_latest_vintage'}
    if task == 'snapshot':
        if market == 'cn':
            try:
                data = ak.stock_zh_a_spot_em()
                source = 'AkShare · Eastmoney A股快照'
            except Exception:
                data = ak.stock_zh_a_spot_tx()
                source = 'AkShare · Tencent A股快照'
        elif market == 'hk':
            data, source = ak.stock_hk_spot_em(), 'AkShare · Eastmoney 港股快照'
        elif market == 'fund':
            data, source = ak.fund_etf_spot_em(), 'AkShare · Eastmoney ETF快照'
        elif market == 'index':
            import pandas as pd
            frames = []
            for label in ['上证系列指数', '深证系列指数', '中证系列指数']:
                frame = ak.stock_zh_index_spot_em(symbol=label)
                frame['_exchange'] = 'SZ' if label == '深证系列指数' else 'SH'
                frames.append(frame)
            data = pd.concat(frames, ignore_index=True)
            source = 'AkShare · Eastmoney 指数快照'
        else:
            raise ValueError('Unsupported market')
    elif task == 'bars':
        kind, period = args.get('kind', 'equity'), args.get('period', 'daily')
        if period == '5':
            if kind != 'equity' or args['symbol'].endswith('.HK'):
                raise NotImplementedError('Intraday capability is A-share only')
            data = ak.stock_zh_a_hist_min_em(symbol=code, period='5', adjust='')
            frequency = '5min'
        elif kind == 'equity' and args['symbol'].endswith('.HK'):
            data = ak.stock_hk_hist(symbol=code.zfill(5), start_date=start, end_date=end, adjust='')
        elif kind == 'equity':
            data = ak.stock_zh_a_hist(symbol=code, start_date=start, end_date=end, adjust='')
        elif kind == 'fund':
            data = ak.fund_etf_hist_em(symbol=code, start_date=start, end_date=end, adjust='')
        elif kind == 'index':
            prefix = args['symbol'].split('.')[-1].lower()
            data = ak.stock_zh_index_daily_em(symbol=prefix + code, start_date=start, end_date=end)
        elif kind == 'future':
            data = ak.futures_zh_daily_sina(symbol=code.upper())
        elif kind == 'option' and code.isdigit() and len(code) == 8:
            data = ak.option_sse_daily_sina(symbol=code)
        elif kind == 'forex':
            data = ak.forex_hist_em(symbol=code.upper())
        else:
            raise NotImplementedError('Daily bars unavailable for this instrument type')
        source = 'AkShare · 日线/分钟线公开源'
        frequency = '5min' if period == '5' else 'daily_unadjusted'
    elif task == 'overview':
        data, source, frequency = ak.stock_individual_info_em(symbol=code), 'AkShare · Eastmoney 公司概况', 'latest_available'
    elif task == 'financials':
        data = ak.stock_financial_analysis_indicator_em(symbol=args['symbol'], indicator='按报告期')
        source, frequency = 'AkShare · Eastmoney 财务指标', 'reported_quarterly_latest_vintage'
    elif task == 'shareholders':
        symbol = args['symbol'].split('.')[1].lower() + code
        data = ak.stock_gdfx_top_10_em(symbol=symbol, date=args['date'].replace('-', ''))
        source, frequency = 'AkShare · Eastmoney 十大股东', 'selected_report_period'
    elif task == 'announcements':
        data = ak.stock_notice_report(symbol='全部', date=args['date'].replace('-', ''))
        if '代码' in data.columns:
            data = data[data['代码'].astype(str).str.zfill(6) == code]
        source, frequency = 'AkShare · Eastmoney 公告', 'selected_publication_date'
    elif task == 'news':
        data = ak.stock_news_em(symbol=code) if args.get('symbol') else ak.stock_info_global_cls(symbol='全部')
        source, frequency = 'AkShare · Eastmoney 个股资讯' if args.get('symbol') else 'AkShare · 财联社公开电报', 'public_news'
    elif task == 'research':
        data = ak.stock_research_report_em(symbol=code)
        source, frequency = 'AkShare · Eastmoney 公开研报目录', 'research_index'
    elif task == 'futures':
        data = ak.futures_zh_spot(symbol=args.get('symbol', 'RB0,AU0,CU0,IF0'), market='CF', adjust='0')
        source = 'AkShare · Sina 国内期货快照（0结尾为连续合约）'
    elif task == 'options':
        data, source = ak.option_current_em(), 'AkShare · Eastmoney 期权行情/链'
    elif task == 'forex':
        data, source = ak.forex_spot_em(), 'AkShare · Eastmoney 外汇报价'
    elif task == 'bonds':
        data = ak.bond_china_yield(start_date=(today - timedelta(days=14)).strftime('%Y%m%d'), end_date=end)
        source, frequency = 'AkShare · 中国债券信息网 收益率曲线', 'published_daily_yields'
    elif task == 'macro':
        methods = {'gdp': ak.macro_china_gdp, 'cpi': ak.macro_china_cpi, 'pmi': ak.macro_china_pmi,
                   'money': ak.macro_china_money_supply, 'rates': ak.macro_china_lpr,
                   'imports': ak.macro_china_imports_yoy, 'exports': ak.macro_china_exports_yoy}
        data = methods[args['indicator']]()
        source, frequency = 'AkShare · 中国宏观公开统计', 'published_macro_latest_vintage'
    elif task == 'nav':
        data = ak.fund_open_fund_info_em(symbol=code, indicator='单位净值走势')
        source, frequency = 'AkShare · 天天基金 净值（非交易价格）', 'published_daily_nav'
    elif task == 'fund_holdings':
        data = ak.fund_portfolio_hold_em(symbol=code, date=args.get('year', str(today.year)))
        source, frequency = 'AkShare · 天天基金 披露持仓', 'reported_holdings'
    else:
        raise NotImplementedError('Unsupported AkShare capability')
    return data, {'source': source, 'frequency': frequency, 'adjustment': 'unadjusted' if task == 'bars' else None}


def tushare_client(token):
    from tushare.pro.client import DataApi
    client = DataApi(token, timeout=10)
    # The pinned SDK defaults to HTTP and has no public endpoint setter.
    # Keep token-bearing requests on the official HTTPS endpoint.
    client._DataApi__http_url = 'https://api.tushare.pro'
    return client


def run_tushare(task, args, token):
    """Optional token-backed daily fallback; never presented as a tick feed."""
    if not token:
        raise PermissionError('Tushare token absent')
    pro = tushare_client(token)
    now = datetime.now(ZoneInfo('Asia/Shanghai'))
    end = now.strftime('%Y%m%d')
    if task == 'bars' and args.get('kind', 'equity') == 'equity' and args.get('period', 'daily') == 'daily' and not args['symbol'].endswith('.HK'):
        frame = pro.daily(ts_code=args['symbol'], start_date=(now-timedelta(days=1000)).strftime('%Y%m%d'), end_date=end)
        return frame, {'source': 'Tushare Pro · 日收盘历史（需账户权限）', 'frequency': 'daily_unadjusted', 'adjustment': 'unadjusted'}
    if task == 'snapshot' and args.get('market', 'cn') == 'cn':
        dates = pro.trade_cal(exchange='SSE', start_date=(now-timedelta(days=14)).strftime('%Y%m%d'), end_date=end, is_open='1')
        # A close for an unfinished session is not yet available.
        eligible = [str(value) for value in dates['cal_date'] if str(value) < end or now.hour >= 17]
        for date in sorted(eligible, reverse=True)[:2]:
            frame = pro.daily(trade_date=date)
            if not frame.empty:
                return frame, {'source': 'Tushare Pro · 最近交易日日收盘（非实时快照）', 'frequency': 'daily_close', 'as_of': date}
    raise NotImplementedError('Tushare fallback does not cover this capability')


def main():
    payload = json.loads(sys.stdin.read(20000))
    # Some libraries print progress; stdout must contain exactly one JSON document.
    with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        try:
            if payload['provider'] == 'akshare':
                frame, meta = run_akshare(payload['task'], payload['args'])
            else:
                frame, meta = run_tushare(payload['task'], payload['args'], payload.get('token', ''))
            import pandas as pd
            if not isinstance(frame, pd.DataFrame):
                raise TypeError('Expected DataFrame')
            if len(frame) > 25000:
                raise ValueError('Provider response exceeds row bound')
            # Pandas serializes NaN/NaT/Inf as null, preserving original column names.
            records = json.loads(frame.to_json(orient='records', date_format='iso', force_ascii=False))
            result = {'ok': True, 'rows': records, 'meta': meta}
        except Exception as error:
            result = {'ok': False, 'error': type(error).__name__}
    sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == '__main__':
    main()

