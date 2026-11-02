"""Runtime configuration. No credentials are written to application logs."""
from dataclasses import dataclass
import os
from pathlib import Path
import re


@dataclass(frozen=True)
class Settings:
    database_url: str = ''
    redis_url: str = 'redis://redis:6379/0'
    auth_digest: str = ''
    data_primary: str = 'akshare'
    fallback_chain: str = 'akshare,tushare'
    tushare_token: str = ''
    snapshot_interval: int = 10
    provider_timeout: int = 35
    broker_mode: str = 'paper'
    realtime_provider: str = ''
    scheduler_enabled: bool = True
    seed_path: Path = Path(__file__).resolve().parents[1] / 'data/universe.json'

    @classmethod
    def from_env(cls):
        from sqlalchemy.engine import URL
        database_url = os.getenv('DATABASE_URL', '')
        if not database_url and os.getenv('POSTGRES_PASSWORD'):
            database_url = URL.create('postgresql+psycopg2', username=os.getenv('POSTGRES_USER', 'meridian'),
                                     password=os.environ['POSTGRES_PASSWORD'], host=os.getenv('POSTGRES_HOST', 'postgres'),
                                     port=5432, database=os.getenv('POSTGRES_DB', 'meridian')).render_as_string(hide_password=False)
        return cls(database_url=database_url, redis_url=os.getenv('REDIS_URL', 'redis://redis:6379/0'),
                   auth_digest=os.getenv('MERIDIAN_AUTH_DIGEST', ''), data_primary=os.getenv('DATA_PRIMARY', 'akshare'),
                   fallback_chain=os.getenv('DATA_FALLBACK_CHAIN', 'akshare,tushare'),
                   tushare_token=os.getenv('TUSHARE_TOKEN', ''),
                   snapshot_interval=int(os.getenv('SNAPSHOT_INTERVAL_SECONDS', '10')),
                   provider_timeout=int(os.getenv('PROVIDER_TIMEOUT_SECONDS', '35')),
                   broker_mode=os.getenv('BROKER_MODE', 'paper'), realtime_provider=os.getenv('REALTIME_PROVIDER', ''))

    def validate(self):
        if not re.fullmatch(r'[0-9a-fA-F]{64}', self.auth_digest):
            raise ValueError('MERIDIAN_AUTH_DIGEST must be a 64-character SHA-256 digest')
        if not self.database_url:
            raise ValueError('DATABASE_URL must be configured')
        if self.data_primary != 'akshare' or any(p.strip() not in ('akshare', 'tushare') for p in self.fallback_chain.split(',')):
            raise ValueError('This edition supports DATA_PRIMARY=akshare and akshare,tushare fallback')
        if not 5 <= self.snapshot_interval <= 300 or not 5 <= self.provider_timeout <= 120:
            raise ValueError('Snapshot interval must be 5–300 seconds; provider timeout 5–120 seconds')
        if self.broker_mode not in ('paper', 'qmt', 'ptrade'):
            raise ValueError('Unknown BROKER_MODE')

