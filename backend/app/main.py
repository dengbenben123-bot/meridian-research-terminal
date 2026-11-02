from contextlib import asynccontextmanager
import asyncio
import base64
import binascii
from datetime import date, datetime
import hashlib
import hmac
import json
from typing import Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from redis.exceptions import RedisError
from .config import Settings
from .cache import RedisCache
from .storage import Database, WatchItem, Preference, Audit
from .models import WatchChange, ScreenFilters, Workspace, PreferenceChange, PreviewOrder, SubmitOrder, valid_symbol
from .providers import MarketData, screen, first
from .indicators import calculate
from .brokers import PaperBrokerAdapter, QMTAdapter, PTradeAdapter, BrokerError

VERSION = '5.0.0'
Market = Literal['cn', 'hk', 'fund', 'index']
Kind = Literal['equity', 'fund', 'index', 'future', 'option', 'forex']
Section = Literal['overview', 'financials', 'announcements', 'shareholders', 'news', 'research', 'nav', 'fund_holdings']
Indicator = Literal['gdp', 'cpi', 'pmi', 'money', 'rates', 'imports', 'exports']


def symbol_checked(symbol):
    try:
        return valid_symbol(symbol)
    except ValueError:
        raise HTTPException(422, 'Invalid security symbol') from None


def create_app(settings=None, database=None, cache=None, runner=None):
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        settings.validate()
        app.state.db = database or Database(settings.database_url)
        try:
            await asyncio.to_thread(app.state.db.initialize, settings.seed_path)
        except Exception:
            raise RuntimeError('PostgreSQL initialization failed; check its health and DATABASE_URL') from None
        app.state.cache = cache or RedisCache(settings.redis_url)
        if not await app.state.cache.health():
            raise RuntimeError('Redis is not ready')
        app.state.market = MarketData(settings, app.state.cache, runner)

        async def quote_reader(symbol):
            instrument = app.state.db.instrument(symbol)
            if not instrument or instrument['kind'] != 'equity' or instrument['exchange'] not in ('SH', 'SZ', 'BJ'):
                raise BrokerError('模拟交易仅支持目录中的A股股票。', 422)
            snapshot = await app.state.market.get('snapshot', {'market': 'cn', 'symbols': [symbol]}, ttl=settings.snapshot_interval)
            row = next((row for row in snapshot['rows'] if row['symbol'] == symbol), None)
            if snapshot.get('meta', {}).get('frequency') != 'snapshot':
                raise BrokerError('日收盘回退数据不能用于模拟实时撮合。')
            return {**row, 'state': 'ok' if snapshot['state'] in ('ok','partial') and not row.get('is_stale') else 'stale', 'age_seconds': row.get('age_seconds', snapshot['age_seconds']),
                    'received_at': snapshot.get('received_at')} if row else None

        app.state.broker = {'paper': PaperBrokerAdapter, 'qmt': QMTAdapter, 'ptrade': PTradeAdapter}[settings.broker_mode](quote_reader) if settings.broker_mode == 'paper' else {'qmt': QMTAdapter, 'ptrade': PTradeAdapter}[settings.broker_mode]()
        task = asyncio.create_task(refresh_loop(app, settings)) if settings.scheduler_enabled else None
        try:
            yield
        finally:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            await app.state.cache.close()
            app.state.db.engine.dispose()

    app = FastAPI(title='Meridian 中国市场终端', version=VERSION, lifespan=lifespan,
                  docs_url='/api/docs', openapi_url='/api/openapi.json', redoc_url=None)

    @app.middleware('http')
    async def access(request: Request, call_next):
        if request.url.path != '/healthz':
            challenge = {'WWW-Authenticate': 'Basic realm="Meridian terminal", charset="UTF-8"'}
            try:
                scheme, value = request.headers.get('authorization', '').split(' ', 1)
                if scheme.lower() != 'basic' or len(value) > 4096:
                    raise ValueError()
                raw = base64.b64decode(value, validate=True)
                name, _ = raw.decode('utf-8').split(':', 1)
                if not name or not hmac.compare_digest(hashlib.sha256(raw).hexdigest(), settings.auth_digest.lower()):
                    raise ValueError()
                request.state.owner = name[:120]
            except (ValueError, binascii.Error, UnicodeError):
                return JSONResponse({'detail': 'Terminal login required'}, 401, headers=challenge)
            if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
                origin = request.headers.get('origin')
                try:
                    wrong_origin = bool(origin and urlsplit(origin).netloc.lower() != request.headers.get('host', '').lower())
                except ValueError:
                    wrong_origin = True
                if request.headers.get('x-meridian-request') != '1' or wrong_origin or request.headers.get('sec-fetch-site') == 'cross-site':
                    return JSONResponse({'detail': 'Same-origin API request required'}, 403)
        response = await call_next(request)
        response.headers.update({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                                 'X-Meridian-Build': 'meridian-5.0.0-coolify'})
        return response

    @app.exception_handler(BrokerError)
    async def broker_error(request, error):
        return JSONResponse({'detail': str(error), 'paper': True}, error.status)

    @app.exception_handler(NotImplementedError)
    async def broker_stub(request, error):
        return JSONResponse({'detail': str(error), 'live_execution': False}, 501)

    async def infrastructure_error(request, error):
        return JSONResponse({'detail': 'Database or cache is unavailable; no live trading is enabled.'}, 503)
    app.add_exception_handler(SQLAlchemyError, infrastructure_error)
    app.add_exception_handler(RedisError, infrastructure_error)

    @app.get('/healthz')
    async def health():
        try:
            ready = app.state.db.health() and await app.state.cache.health()
        except Exception:
            ready = False
        return JSONResponse({'status': 'ok' if ready else 'not_ready', 'version': VERSION}, 200 if ready else 503)

    @app.get('/api/auth/check')
    async def auth_check(request: Request):
        return {'owner': request.state.owner}

    @app.get('/api/status')
    async def status():
        return {'version': VERSION, 'configured_instruments': 5000, 'primary': settings.data_primary,
                'fallback': settings.fallback_chain, 'tushare_configured': bool(settings.tushare_token),
                'snapshot_interval_seconds': settings.snapshot_interval, 'broker_mode': settings.broker_mode,
                'live_execution': False, 'realtime_provider_configured': bool(settings.realtime_provider),
                'realtime_provider_active': False, 'full_wind_parity': False, 'snapshot_event_latency_verified': False}

    @app.get('/api/search')
    async def search_symbols(q: str = Query(default='', max_length=100), limit: int = Query(default=20, ge=1, le=100)):
        return {'items': app.state.db.search(q, limit)}

    @app.get('/api/cn/equity/industries')
    async def industries():
        return {'items': app.state.db.industries(), 'scope': 'Only source-confirmed company overview metadata; missing industries are not inferred.'}

    @app.get('/api/cn/equity/snapshot')
    async def equity_snapshot(market: Market = 'cn', q: str = Query(default='', max_length=100), industry: str = Query(default='', max_length=100),
                              pe_min: float | None = None, pe_max: float | None = None,
                              cap_min: float | None = Query(default=None, ge=0), cap_max: float | None = Query(default=None, ge=0),
                              change_min: float | None = None, change_max: float | None = None, symbols: str | None = Query(default=None, max_length=8000),
                              offset: int = Query(default=0, ge=0, le=30000), limit: int = Query(default=5000, ge=1, le=5000)):
        try:
            filters = ScreenFilters(q=q, industry=industry, pe_min=pe_min, pe_max=pe_max, cap_min=cap_min,
                                    cap_max=cap_max, change_min=change_min, change_max=change_max)
        except ValueError:
            raise HTTPException(422, 'Invalid finite screening bounds') from None
        args = {'market': market}
        if symbols:
            selected = sorted(set(symbols.split(',')))
            instruments = [app.state.db.instrument(s) for s in selected]
            if len(selected) > 200 or any(not item for item in instruments):
                raise HTTPException(422, 'Choose at most 200 configured symbols')
            if any(item['kind'] != ('equity' if market in ('cn','hk') else market) or ((item['exchange']=='HK') != (market=='hk')) for item in instruments):
                raise HTTPException(422, 'Selected symbols do not belong to this market')
            args['symbols'] = selected
        elif q:
            selected = app.state.db.search(q,200)
            matching = [row['symbol'] for row in selected if row['kind'] == ('equity' if market in ('cn','hk') else market) and ((row['exchange']=='HK')==(market=='hk'))]
            if matching:
                args['symbols'] = sorted(matching)
        data = await app.state.market.get('snapshot', args, ttl=settings.snapshot_interval)
        rows = screen(data['rows'], filters, app.state.db.industry_map())
        if args.get('symbols'):
            wanted = set(args['symbols'])
            rows = [row for row in rows if row['symbol'] in wanted]
        return {**data, 'rows': rows[offset:offset+limit], 'total': len(rows), 'observed_count': len(data['rows']),
                'configured_count': 5000, 'offset': offset, 'industry_coverage': 'source_enriched_only',
                'volume_units': 'Upstream original units; see source documentation'}

    @app.get('/api/cn/equity/bars')
    async def bars(symbol: str = Query(max_length=40), kind: Kind = 'equity', period: Literal['daily', '5'] = 'daily'):
        symbol_checked(symbol)
        data = await app.state.market.get('bars', {'symbol': symbol, 'kind': kind, 'period': period}, ttl=60 if period == '5' else 1800)
        return {**data, 'symbol': symbol, 'kind': kind, 'indicators': calculate(data['rows']),
                'timezone': 'Asia/Shanghai for Chinese market bars; dates are source labels',
                'bar_finality': 'Last intraday bar may still be forming', 'return_basis': 'unadjusted prices; excludes dividends'}

    @app.get('/api/cn/equity/detail/{section}')
    async def detail(section: Section, symbol: str = Query(max_length=40),
                     report_date: date | None = None, publication_date: date | None = None, year: int = Query(default=2026, ge=2000, le=2100)):
        symbol_checked(symbol)
        args = {'symbol': symbol}
        instrument = app.state.db.instrument(symbol)
        if section in ('overview', 'financials', 'announcements', 'shareholders', 'research', 'news') and (not symbol.endswith(('.SH', '.SZ', '.BJ')) or instrument and instrument['kind'] != 'equity'):
            return {'state': 'unsupported', 'rows': [], 'message': '该公司资料接口仅覆盖A股；未提供的数据不会补造。'}
        if section == 'shareholders':
            if report_date is None:
                raise HTTPException(422, 'Choose the disclosed shareholder report date')
            args['date'] = report_date.isoformat()
        if section == 'announcements':
            args['date'] = (publication_date or datetime.now(ZoneInfo('Asia/Shanghai')).date()).isoformat()
        if section == 'fund_holdings':
            args['year'] = str(year)
        data = await app.state.market.get(section, args, ttl=60 if section == 'news' else 3600)
        if section == 'overview' and data['state'] == 'ok':
            industry = next((first(r, 'value', '值') for r in data['rows'] if first(r, 'item', '项目') == '行业'), None)
            if not industry and data['rows']:
                industry = first(data['rows'][0], '所属行业', '行业')
            app.state.db.enrich_industry(symbol, industry)
        return {**data, 'selection': args, 'point_in_time_archive': False}

    async def asset_table(task, args, q, offset, limit, ttl=15):
        data = await app.state.market.get(task, args, ttl=ttl)
        rows = [row for row in data['rows'] if not q or q.lower() in ' '.join(str(v) for v in row.values()).lower()]
        return {**data, 'rows': rows[offset:offset+limit], 'total': len(rows), 'offset': offset}

    @app.get('/api/cn/futures/quotes')
    async def futures(symbol: str = Query(default='RB0,AU0,CU0,IF0', pattern=r'^[A-Za-z0-9,]{1,200}$')):
        return await asset_table('futures', {'symbol': symbol}, '', 0, 200)

    @app.get('/api/cn/options/chain')
    async def options(q: str = Query(default='', max_length=100), offset: int = Query(default=0, ge=0, le=30000), limit: int = Query(default=1000, ge=1, le=5000)):
        return await asset_table('options', {}, q, offset, limit)

    @app.get('/api/cn/bonds/yield')
    async def bonds():
        return await asset_table('bonds', {}, '', 0, 1000, 3600)

    @app.get('/api/cn/forex')
    async def forex():
        return await asset_table('forex', {}, '', 0, 1000)

    @app.get('/api/cn/macro/{indicator}')
    async def macro(indicator: Indicator):
        return await app.state.market.get('macro', {'indicator': indicator}, ttl=3600)

    @app.get('/api/cn/news')
    async def news():
        return await app.state.market.get('news', {}, ttl=60)

    @app.get('/api/watchlists')
    async def get_watchlist(request: Request):
        with app.state.db.session() as db:
            rows = db.scalars(select(WatchItem).where(WatchItem.owner == request.state.owner).order_by(WatchItem.group, WatchItem.symbol)).all()
            return {'items': [{'symbol': row.symbol, 'group': row.group, 'instrument': app.state.db.instrument(row.symbol)} for row in rows]}

    @app.post('/api/watchlists')
    async def add_watchlist(change: WatchChange, request: Request):
        if not app.state.db.instrument(change.symbol):
            raise HTTPException(422, 'Watchlists accept configured directory instruments')
        with app.state.db.session() as db:
            db.merge(WatchItem(owner=request.state.owner, group=change.group, symbol=change.symbol))
            db.add(Audit(owner=request.state.owner, action='watchlist.add', detail=change.model_dump_json()))
        return {'ok': True}

    @app.delete('/api/watchlists')
    async def remove_watchlist(change: WatchChange, request: Request):
        with app.state.db.session() as db:
            item = db.get(WatchItem, (request.state.owner, change.group, change.symbol))
            if item:
                db.delete(item)
            db.add(Audit(owner=request.state.owner, action='watchlist.remove', detail=change.model_dump_json()))
        return {'ok': True}

    @app.get('/api/preferences')
    async def get_preferences(request: Request, category: Literal['screen', 'workspace'] = 'workspace'):
        with app.state.db.session() as db:
            rows = db.scalars(select(Preference).where(Preference.owner == request.state.owner, Preference.category == category).order_by(Preference.name)).all()
            return {'items': [{'name': r.name, 'content': json.loads(r.content)} for r in rows]}

    @app.post('/api/preferences')
    async def save_preference(change: PreferenceChange, request: Request):
        try:
            content = (ScreenFilters if change.category == 'screen' else Workspace).model_validate(change.content).model_dump()
        except ValueError:
            raise HTTPException(422, 'Invalid preference fields') from None
        with app.state.db.session() as db:
            db.merge(Preference(owner=request.state.owner, category=change.category, name=change.name, content=json.dumps(content, ensure_ascii=False)))
            db.add(Audit(owner=request.state.owner, action='preferences.save', detail=json.dumps({'category': change.category, 'name': change.name})))
        return {'ok': True}

    @app.post('/api/broker/preview')
    async def preview(order: PreviewOrder, request: Request):
        return await app.state.broker.preview_order(request.state.owner, order)

    @app.post('/api/broker/submit')
    async def submit(order: SubmitOrder, request: Request):
        app.state.db.audit(request.state.owner, 'paper.submit.request', {'preview_id': order.preview_id})
        result = await app.state.broker.submit_order(request.state.owner, order.preview_id)
        app.state.db.audit(request.state.owner, 'paper.submit.result', {'order_id': result['order_id'], 'state': result['state']})
        return result

    @app.post('/api/broker/cancel/{order_id}')
    async def cancel(order_id: str, request: Request):
        result = await app.state.broker.cancel_order(request.state.owner, order_id)
        app.state.db.audit(request.state.owner, 'paper.cancel', {'order_id': result['order_id']})
        return result

    @app.get('/api/broker/positions')
    async def positions(request: Request):
        return await app.state.broker.get_positions(request.state.owner)

    return app


async def refresh_loop(app, settings):
    tick = 0
    while True:
        try:
            snapshot = await app.state.market.get('snapshot', {'market': 'cn'}, ttl=settings.snapshot_interval)
            if snapshot['state'] in ('ok','partial') and snapshot.get('meta', {}).get('frequency') == 'snapshot' and isinstance(app.state.broker, PaperBrokerAdapter):
                await app.state.broker.mark([row for row in snapshot['rows'] if not row.get('is_stale')])
            if tick % 6 == 0:
                market = ['fund', 'index', 'hk'][(tick // 6) % 3]
                await app.state.market.get('snapshot', {'market': market}, ttl=60)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Source errors are exposed in cached envelopes; avoid credential-bearing tracebacks.
            pass
        tick += 1
        await asyncio.sleep(settings.snapshot_interval)


app = create_app()
