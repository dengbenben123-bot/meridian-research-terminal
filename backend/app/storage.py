"""PostgreSQL persistence; SQLite is used only by isolated contract tests."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from sqlalchemy import create_engine, String, Text, Integer, DateTime, UniqueConstraint, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool
from pypinyin import lazy_pinyin, Style


class Base(DeclarativeBase):
    pass


class Instrument(Base):
    __tablename__ = 'instruments'
    symbol: Mapped[str] = mapped_column(String(40), primary_key=True)
    code: Mapped[str] = mapped_column(String(24), index=True)
    name: Mapped[str] = mapped_column(String(160))
    initials: Mapped[str] = mapped_column(String(100), index=True)
    exchange: Mapped[str] = mapped_column(String(16))
    kind: Mapped[str] = mapped_column(String(20))
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)


class WatchItem(Base):
    __tablename__ = 'watch_items'
    owner: Mapped[str] = mapped_column(String(120), primary_key=True)
    group: Mapped[str] = mapped_column(String(80), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(40), primary_key=True)


class Preference(Base):
    __tablename__ = 'preferences'
    owner: Mapped[str] = mapped_column(String(120), primary_key=True)
    category: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), primary_key=True)
    content: Mapped[str] = mapped_column(Text)


class Audit(Base):
    __tablename__ = 'audit_log'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Database:
    def __init__(self, url):
        options = {'pool_pre_ping': True}
        if url.startswith('sqlite'):
            options.update(connect_args={'check_same_thread': False}, poolclass=StaticPool)
        self.engine = create_engine(url, **options)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    def initialize(self, seed_path):
        Base.metadata.create_all(self.engine)
        with self.session() as db:
            if db.scalar(select(Instrument.symbol).limit(1)) is not None:
                return
            for row in json.loads(seed_path.read_text(encoding='utf-8'))['instruments']:
                exchange = row['symbol'].rsplit('.', 1)[-1]
                db.add(Instrument(symbol=row['symbol'], code=row['symbol'].split('.')[0], name=row['name'],
                                  initials=''.join(lazy_pinyin(row['name'], style=Style.FIRST_LETTER)).lower(),
                                  exchange=exchange, kind={'Equity': 'equity', 'Fund': 'fund', 'Index': 'index'}[row['type']]))

    @contextmanager
    def session(self):
        with self.sessions() as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    def audit(self, owner, action, detail):
        with self.session() as db:
            db.add(Audit(owner=owner, action=action, detail=json.dumps(detail, ensure_ascii=False)))

    def search(self, query, limit=20):
        with self.session() as db:
            # Literal search: % and _ in user text are not treated as wildcard syntax.
            q = query.strip().lower()
            cond = (Instrument.symbol.icontains(q, autoescape=True) | Instrument.name.icontains(q, autoescape=True)
                    | Instrument.initials.icontains(q, autoescape=True))
            items = db.scalars(select(Instrument).where(cond).order_by(Instrument.symbol).limit(limit)).all()
            items.sort(key=lambda i: (i.code != q, not i.code.startswith(q), i.symbol))
            return [self.instrument_dict(i) for i in items]

    @staticmethod
    def instrument_dict(item):
        return {key: getattr(item, key) for key in ('symbol', 'code', 'name', 'initials', 'exchange', 'kind', 'industry')}

    def instrument(self, symbol):
        with self.session() as db:
            row = db.get(Instrument, symbol)
            return self.instrument_dict(row) if row else None

    def industries(self):
        with self.session() as db:
            return list(db.scalars(select(Instrument.industry).where(Instrument.industry.is_not(None)).distinct().order_by(Instrument.industry)))

    def enrich_industry(self, symbol, industry):
        if isinstance(industry, str) and industry.strip():
            with self.session() as db:
                row = db.get(Instrument, symbol)
                if row:
                    row.industry = industry[:100]

    def industry_map(self):
        with self.session() as db:
            return dict(db.execute(select(Instrument.symbol, Instrument.industry)).all())

    def health(self):
        with self.engine.connect() as conn:
            return conn.execute(select(1)).scalar() == 1

