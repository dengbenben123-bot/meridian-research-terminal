"""Paper fills are simulations at observed last prices, not exchange executions."""
import asyncio
from abc import ABC, abstractmethod
from decimal import Decimal, ROUND_HALF_UP
import time
import uuid


class BrokerError(Exception):
    def __init__(self, message, status=409):
        self.status = status
        super().__init__(message)


class BrokerAdapter(ABC):
    @abstractmethod
    async def preview_order(self, owner, order): ...
    @abstractmethod
    async def submit_order(self, owner, preview_id): ...
    @abstractmethod
    async def cancel_order(self, owner, order_id): ...
    @abstractmethod
    async def get_positions(self, owner): ...


class QMTAdapter(BrokerAdapter):
    async def preview_order(self, owner, order):
        raise NotImplementedError('QMT requires separately authorized broker-side software; no live implementation is supplied')
    async def submit_order(self, owner, preview_id):
        raise NotImplementedError('Live QMT execution is not implemented')
    async def cancel_order(self, owner, order_id):
        raise NotImplementedError('Live QMT execution is not implemented')
    async def get_positions(self, owner):
        raise NotImplementedError('Live QMT positions are not implemented')


class PTradeAdapter(QMTAdapter):
    async def preview_order(self, owner, order):
        raise NotImplementedError('PTrade requires separately authorized broker-side software; no live implementation is supplied')


def money(value):
    return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


class PaperBrokerAdapter(BrokerAdapter):
    def __init__(self, quote_reader, clock=time.time):
        self.quote_reader, self.clock = quote_reader, clock
        self.previews, self.orders, self.wallets, self.positions = {}, {}, {}, {}
        self.lock = asyncio.Lock()

    async def quote(self, symbol):
        quote = await self.quote_reader(symbol)
        if not quote or quote.get('state') != 'ok' or quote.get('age_seconds') is None or quote['age_seconds'] > 60:
            raise BrokerError('模拟委托需要60秒内成功获取的快照；过期或不可用数据不能成交。')
        price = quote.get('price')
        if price is None or price <= 0:
            raise BrokerError('证券没有有效的公开报价。')
        return money(price), quote

    def available(self, owner, symbol):
        cash = self.wallets.setdefault(owner, money(1_000_000))
        qty = self.positions.get((owner, symbol), {}).get('quantity', 0)
        for order in self.orders.values():
            if order['owner'] == owner and order['state'] == 'pending':
                if order['side'] == 'buy':
                    cash -= money(order['reserved_cash'])
                elif order['symbol'] == symbol:
                    qty -= order['quantity']
        return cash, qty

    async def preview_order(self, owner, order):
        if not order.symbol.endswith(('.SH', '.SZ', '.BJ')) or order.quantity % 100:
            raise BrokerError('模拟撮合仅支持已配置A股，数量须为100股的整数倍。', 422)
        if order.order_type == 'limit' and order.limit_price is None:
            raise BrokerError('限价单需要限价。', 422)
        price, quote = await self.quote(order.symbol)
        estimate = money(order.limit_price) if order.order_type == 'limit' else price
        gross = estimate * order.quantity
        fee = money(gross * Decimal('0.0003'))
        async with self.lock:
            self.previews = {key: row for key, row in self.previews.items() if row['expires_epoch'] > self.clock() or row.get('order_id')}
            if len(self.previews) > 2000:
                raise BrokerError('模拟会话订单过多；请在完成后重启纸面交易会话。')
            cash, qty = self.available(owner, order.symbol)
            if (order.side == 'buy' and cash < gross + fee) or (order.side == 'sell' and qty < order.quantity):
                raise BrokerError('模拟可用资金或持仓不足。')
            identifier = uuid.uuid4().hex
            record = {**order.model_dump(), 'preview_id': identifier, 'owner': owner, 'last_price': float(price),
                      'estimated_gross': float(gross), 'estimated_fee': float(fee), 'received_at': quote.get('received_at'),
                      'expires_epoch': self.clock() + 30, 'paper': True}
            self.previews[identifier] = record
            return {key: value for key, value in record.items() if key != 'owner'}

    async def submit_order(self, owner, preview_id):
        preview = self.previews.get(preview_id)
        if not preview or preview['owner'] != owner:
            raise BrokerError('模拟预览不存在。', 404)
        if preview.get('order_id'):
            return self.public(self.orders[preview['order_id']])
        if preview['expires_epoch'] <= self.clock():
            raise BrokerError('模拟预览已过期；请重新预览。')
        price, _ = await self.quote(preview['symbol'])
        async with self.lock:
            if preview.get('order_id'):
                return self.public(self.orders[preview['order_id']])
            if preview['expires_epoch'] <= self.clock():
                raise BrokerError('模拟预览已过期；请重新预览。')
            reference = money(preview['limit_price']) if preview['order_type'] == 'limit' else price
            reserved = reference * preview['quantity']
            reserved += money(reserved * Decimal('0.0003'))
            cash, qty = self.available(owner, preview['symbol'])
            if preview['side'] == 'buy' and cash < reserved or preview['side'] == 'sell' and qty < preview['quantity']:
                raise BrokerError('价格或可用余额已变化；请重新预览。')
            record = {**preview, 'order_id': uuid.uuid4().hex, 'state': 'pending', 'reserved_cash': float(reserved),
                      'created_epoch': self.clock(), 'fill_price': None, 'fee': None}
            self.orders[record['order_id']] = record
            preview['order_id'] = record['order_id']
            self.fill_if_crossed(record, price)
            return self.public(record)

    def fill_if_crossed(self, order, price):
        if order['order_type'] == 'limit':
            limit = money(order['limit_price'])
            if order['side'] == 'buy' and price > limit or order['side'] == 'sell' and price < limit:
                return
        owner, symbol = order['owner'], order['symbol']
        qty, side = order['quantity'], order['side']
        gross, fee = price * qty, money(price * qty * Decimal('0.0003'))
        position = self.positions.setdefault((owner, symbol), {'quantity': 0, 'cost': Decimal(0)})
        if side == 'buy':
            self.wallets[owner] -= gross + fee
            position['quantity'] += qty
            position['cost'] += gross + fee
        else:
            average = position['cost'] / position['quantity']
            position['quantity'] -= qty
            position['cost'] -= average * qty
            self.wallets[owner] += gross - fee
        order.update(state='filled', fill_price=float(price), fee=float(fee), filled_epoch=self.clock())

    async def mark(self, quotes):
        prices = {q['symbol']: money(q['price']) for q in quotes if q.get('price') and q['price'] > 0}
        async with self.lock:
            for order in self.orders.values():
                if order['state'] == 'pending' and order['symbol'] in prices:
                    self.fill_if_crossed(order, prices[order['symbol']])

    async def cancel_order(self, owner, order_id):
        async with self.lock:
            row = self.orders.get(order_id)
            if not row or row['owner'] != owner:
                raise BrokerError('模拟订单不存在。', 404)
            if row['state'] != 'pending':
                raise BrokerError('只有未成交的模拟限价单可以撤销。')
            row['state'] = 'cancelled'
            return self.public(row)

    async def get_positions(self, owner):
        async with self.lock:
            cash, _ = self.available(owner, '')
            return {'paper': True, 'cash': float(self.wallets.setdefault(owner, money(1_000_000))),
                    'available_cash': float(cash), 'currency': 'CNY', 'persistence': 'memory_reset_on_restart',
                    'positions': [{'symbol': symbol, 'quantity': row['quantity'], 'cost': float(row['cost'])}
                                  for (user, symbol), row in self.positions.items() if user == owner and row['quantity']],
                    'orders': [self.public(row) for row in self.orders.values() if row['owner'] == owner]}

    @staticmethod
    def public(row):
        return {key: value for key, value in row.items() if key not in ('owner',)}

