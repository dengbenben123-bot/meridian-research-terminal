"""Source normalization and bounded, coalesced snapshot retrieval."""
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import math
import re
import sys
import time


def number(value):
    try:
        result = float(str(value).replace(',', ''))
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def first(row, *keys):
    for key in keys:
        if key in row and row[key] is not None and row[key] != '':
            return row[key]
    return None


def exchange_for(code):
    return 'SH' if code.startswith('6') else 'BJ' if code.startswith(('4', '8', '9')) else 'SZ'


def normalize_quotes(rows, market, meta):
    result = []
    for row in rows:
        raw = first(row, '代码', 'symbol', 'ts_code', '证券代码')
        if raw is None:
            continue
        raw = str(raw)
        code = re.sub(r'^(sh|sz|bj|hk)', '', raw, flags=re.I).split('.')[0]
        if not code.isdigit():
            continue
        code = code.zfill(5 if market == 'hk' else 6)
        suffix = raw.split('.')[-1].upper() if '.' in raw else str(row.get('_exchange') or (
            'HK' if market == 'hk' else 'SH' if market == 'fund' and code.startswith('5') else
            'SH' if market == 'index' and not code.startswith('399') else exchange_for(code)))
        symbol = code + '.' + suffix
        result.append({'symbol': symbol, 'code': code, 'name': str(first(row, '名称', 'name') or code),
                       'exchange': suffix, 'kind': 'equity' if market in ('cn', 'hk') else market,
                       'price': number(first(row, '最新价', '现价', 'close', 'price')),
                       'change_pct': number(first(row, '涨跌幅', 'pct_chg', 'changepercent')),
                       'volume': number(first(row, '成交量', 'vol', 'volume')),
                       'turnover': number(first(row, '换手率', 'turnover_rate')),
                       'pe': number(first(row, '市盈率-动态', '市盈率', 'pe', 'pe_ttm')),
                       'market_cap': number(first(row, '总市值', 'market_cap')),
                       'source_time': first(row, '更新时间', '时间', 'trade_date') or meta.get('as_of'),
                       'retrieved_epoch': number(row.get('_retrieved_epoch')),
                       'currency': 'HKD' if market == 'hk' else 'CNY'})
    # Duplicate directory entries are not duplicate observations.
    return list({row['symbol']: row for row in result}.values())


def normalize_bars(rows):
    result = []
    for row in rows:
        date = first(row, '日期', '时间', 'date', 'trade_date', 'day', '时间戳')
        if date is None:
            continue
        date = str(date)
        if re.fullmatch(r'\d{8}', date):
            date = date[:4] + '-' + date[4:6] + '-' + date[6:]
        values = {key: number(first(row, *aliases)) for key, aliases in {
            'open': ('开盘', 'open'), 'high': ('最高', 'high'), 'low': ('最低', 'low'),
            'close': ('收盘', 'close'), 'volume': ('成交量', 'volume', 'vol')}.items()}
        if any(values[key] is None or values[key] <= 0 for key in ('open', 'high', 'low', 'close')):
            continue
        if values['low'] > min(values['open'], values['close']) or values['high'] < max(values['open'], values['close']) or values['high'] < values['low']:
            continue
        result.append({'date': date, **values})
    return sorted({row['date']: row for row in result}.values(), key=lambda row: row['date'])[-800:]


class ProviderRunner:
    def __init__(self, settings):
        self.timeout, self.token = settings.provider_timeout, settings.tushare_token
        self.semaphore = asyncio.Semaphore(2)

    async def __call__(self, provider, task, args):
        async with self.semaphore:
            if provider == 'akshare' and task == 'snapshot' and args.get('symbols'):
                return await self.invoke(provider, 'snapshot_fallback', args, self.timeout)
            fallback = provider == 'akshare' and task in ('snapshot', 'bars', 'forex', 'options', 'overview', 'financials')
            primary_timeout = min(10, self.timeout/2) if fallback else self.timeout
            result = await self.invoke(provider, task, args, primary_timeout)
            if fallback and (not result.get('ok') or not result.get('rows')):
                return await self.invoke(provider, task+'_fallback', args, max(.001, self.timeout-primary_timeout))
            return result

    async def invoke(self, provider, task, args, timeout):
        payload = {'provider': provider, 'task': task, 'args': args, 'token': self.token if provider == 'tushare' else ''}
        process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'app.provider_worker',
                       stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                       stderr=asyncio.subprocess.DEVNULL, limit=32 * 1024 * 1024)
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(json.dumps(payload).encode()), timeout)
            if process.returncode != 0 or len(stdout) > 24 * 1024 * 1024:
                return {'ok': False, 'error': 'ProviderProcessError'}
            data = json.loads(stdout)
            if not isinstance(data, dict) or not isinstance(data.get('ok'), bool):
                raise ValueError('Provider schema')
            return data
        except asyncio.CancelledError:
            if process.returncode is None:
                process.kill()
            await process.wait()
            raise
        except (TimeoutError, ValueError):
            if process.returncode is None:
                process.kill()
            await process.wait()
            return {'ok': False, 'error': 'TimeoutOrInvalidResponse'}


class MarketData:
    def __init__(self, settings, cache, runner=None, clock=time.time):
        self.cache, self.clock = cache, clock
        self.runner = runner or ProviderRunner(settings)
        self.chain = list(dict.fromkeys([settings.data_primary] + [v.strip() for v in settings.fallback_chain.split(',')]))
        self.token = bool(settings.tushare_token)
        self.timeout = settings.provider_timeout + 2
        self.locks = {}

    async def get(self, task, args=None, ttl=15, force=False):
        args = args or {}
        key = hashlib.sha256(json.dumps([task, args], sort_keys=True).encode()).hexdigest()
        lock = self.locks.setdefault(key, asyncio.Lock())
        async with lock:
            now = self.clock()
            old = await self.cache.get(key)
            if old and not force and now - old.get('attempt_epoch', 0) < (ttl if old['state'] in ('ok', 'partial', 'empty') else 30):
                return self.with_age(old)
            errors = []
            for provider in self.chain:
                if provider == 'tushare' and not self.token:
                    continue
                try:
                    reply = await asyncio.wait_for(self.runner(provider, task, args), timeout=self.timeout)
                except Exception as error:
                    reply = {'ok': False, 'error': type(error).__name__}
                if not reply.get('ok'):
                    errors.append({'provider': provider, 'code': reply.get('error', 'SourceUnavailable')})
                    continue
                rows, meta = reply.get('rows'), reply.get('meta', {})
                if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows) or not isinstance(meta, dict):
                    errors.append({'provider': provider, 'code': 'InvalidSchema'})
                    continue
                if task == 'snapshot':
                    rows = normalize_quotes(rows, args.get('market', 'cn'), meta)
                elif task == 'bars':
                    rows = normalize_bars(rows)
                if not rows and task in ('snapshot', 'bars', 'futures', 'options', 'forex', 'bonds', 'macro'):
                    errors.append({'provider': provider, 'code': 'EmptySource'})
                    continue
                received = self.clock()
                if task == 'snapshot':
                    for row in rows:
                        if row.get('retrieved_epoch') is None:
                            row['retrieved_epoch'] = received
                    if meta.get('driver') == 'tencent_public' and old and old.get('provider') == 'tencent_public':
                        merged = {row['symbol']: row for row in old['rows'] if received-row.get('retrieved_epoch', 0) < 86400}
                        merged.update({row['symbol']: row for row in rows})
                        rows = list(merged.values())
                        meta = {**meta, 'cached_observed': len(rows), 'rolling_refresh': True}
                record = {'state': ('partial' if meta.get('partial') else 'ok') if rows else 'empty', 'rows': rows, 'meta': meta,
                          'provider': meta.get('driver', provider), 'received_at': datetime.fromtimestamp(received, timezone.utc).isoformat(),
                          'received_epoch': received, 'attempt_epoch': received, 'errors': errors,
                          'refresh_seconds': ttl, 'source_time_supplied': any(row.get('source_time') for row in rows),
                          'message': '公开源快照；获取时间不代表交易所事件时间。'}
                await self.cache.set(key, record)
                return self.with_age(record)
            record = {**(old or {}), 'state': 'stale' if old and old.get('rows') else 'unavailable',
                      'rows': old.get('rows', []) if old else [], 'errors': errors, 'attempt_epoch': self.clock(),
                      'refresh_seconds': ttl, 'message': '公开源获取失败；保留的数据已标记过期，不作为最新行情。'}
            await self.cache.set(key, record)
            return self.with_age(record)

    def with_age(self, data):
        result = {**data, 'age_seconds': max(0, round(self.clock() - data['received_epoch'], 1)) if data.get('received_epoch') is not None else None}
        if data.get('rows') and 'retrieved_epoch' in data['rows'][0]:
            result['rows'] = [{**row, 'age_seconds': max(0, round(self.clock()-row['retrieved_epoch'], 1)),
                               'is_stale': self.clock()-row['retrieved_epoch'] > data.get('refresh_seconds',15) or data['state']=='stale'} for row in data['rows']]
        return result


def screen(rows, filters, industries=None):
    industries = industries or {}
    result = []
    for source in rows:
        row = {**source, 'industry': industries.get(source['symbol'])}
        if filters.q and filters.q.lower() not in (row['symbol'] + ' ' + row['name']).lower():
            continue
        if filters.industry and row['industry'] != filters.industry:
            continue
        if any((lower is not None and (row.get(field) is None or row[field] < lower)) or
               (upper is not None and (row.get(field) is None or row[field] > upper)) for field, lower, upper in [
                   ('pe', filters.pe_min, filters.pe_max), ('market_cap', filters.cap_min, filters.cap_max),
                   ('change_pct', filters.change_min, filters.change_max)]):
            continue
        result.append(row)
    return result

