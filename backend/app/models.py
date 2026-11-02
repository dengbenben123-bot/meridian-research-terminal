from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator
import re


SYMBOL_PATTERN = r'^[A-Za-z0-9][A-Za-z0-9.\-]{0,39}$'


def valid_symbol(value):
    if not re.fullmatch(SYMBOL_PATTERN, value):
        raise ValueError('Invalid security symbol')
    return value


class WatchChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    symbol: str = Field(max_length=40)
    group: str = Field(default='我的自选', min_length=1, max_length=80)
    _symbol = field_validator('symbol')(valid_symbol)


class ScreenFilters(BaseModel):
    model_config = ConfigDict(extra='forbid')
    q: str = Field(default='', max_length=100)
    industry: str = Field(default='', max_length=100)
    pe_min: float | None = Field(default=None, allow_inf_nan=False)
    pe_max: float | None = Field(default=None, allow_inf_nan=False)
    cap_min: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    cap_max: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    change_min: float | None = Field(default=None, allow_inf_nan=False)
    change_max: float | None = Field(default=None, allow_inf_nan=False)


class Workspace(BaseModel):
    model_config = ConfigDict(extra='forbid')
    view: Literal['equity', 'hk', 'fund', 'index', 'bonds', 'futures', 'options', 'forex', 'macro', 'news', 'research', 'watchlist', 'detail', 'paper', 'help'] = 'equity'
    selected_symbol: str = Field(default='600519.SH', max_length=40)
    selected_kind: Literal['equity', 'fund', 'index', 'future', 'option', 'forex'] = 'equity'
    sidebar_collapsed: bool = False
    news_dock: Literal['bottom', 'right', 'hidden'] = 'bottom'
    pinned: bool = True
    _symbol = field_validator('selected_symbol')(valid_symbol)


class PreferenceChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    category: Literal['screen', 'workspace']
    name: str = Field(min_length=1, max_length=80)
    content: dict


class PreviewOrder(BaseModel):
    model_config = ConfigDict(extra='forbid')
    symbol: str = Field(max_length=40)
    side: Literal['buy', 'sell']
    quantity: int = Field(gt=0, le=1_000_000, strict=True)
    order_type: Literal['market', 'limit'] = 'market'
    limit_price: float | None = Field(default=None, gt=0, le=1_000_000, allow_inf_nan=False)
    _symbol = field_validator('symbol')(valid_symbol)


class SubmitOrder(BaseModel):
    model_config = ConfigDict(extra='forbid')
    preview_id: str = Field(pattern=r'^[a-f0-9]{32}$')

