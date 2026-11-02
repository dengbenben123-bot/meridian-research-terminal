"""Descriptive technical indicators; no return probability or trading signal claims."""
from math import sqrt


def sma(values, window):
    return [sum(values[i-window+1:i+1])/window if i >= window-1 else None for i in range(len(values))]


def ema(values, window):
    output, prior = [], None
    for i, value in enumerate(values):
        if i < window-1:
            output.append(None)
            continue
        prior = sum(values[:window])/window if prior is None else value*2/(window+1)+prior*(1-2/(window+1))
        output.append(prior)
    return output


def calculate(bars):
    close = [b['close'] for b in bars]
    fast, slow = ema(close, 12), ema(close, 26)
    macd = [f-s if f is not None and s is not None else None for f, s in zip(fast, slow)]
    compact = [x for x in macd if x is not None]
    signal = [None]*(len(close)-len(compact)) + ema(compact, 9)
    mid = sma(close, 20)
    gain = loss = atr = None
    gains, losses, ranges = [], [], []
    output = []
    ma = {w: sma(close, w) for w in (5, 20, 60)}
    for i, bar in enumerate(bars):
        if i:
            change = close[i]-close[i-1]
            gains.append(max(change, 0)); losses.append(max(-change, 0))
        tr = max(bar['high']-bar['low'], abs(bar['high']-close[i-1]) if i else 0, abs(bar['low']-close[i-1]) if i else 0)
        ranges.append(tr)
        if i == 14:
            gain, loss = sum(gains[:14])/14, sum(losses[:14])/14
        elif i > 14:
            gain, loss = (gain*13+gains[-1])/14, (loss*13+losses[-1])/14
        if i == 13:
            atr = sum(ranges[:14])/14
        elif i > 13:
            atr = (atr*13+tr)/14
        rsi = None if gain is None else 50 if gain == 0 and loss == 0 else 100 if loss == 0 else 100-100/(1+gain/loss)
        deviation = sqrt(sum((v-mid[i])**2 for v in close[i-19:i+1])/20) if mid[i] is not None else None
        output.append({'date': bar['date'], **{f'ma{w}': ma[w][i] for w in ma},
                       'rsi14': rsi, 'atr14': atr, 'macd': macd[i], 'signal': signal[i],
                       'histogram': macd[i]-signal[i] if macd[i] is not None and signal[i] is not None else None,
                       'boll_upper': mid[i]+2*deviation if deviation is not None else None,
                       'boll_lower': mid[i]-2*deviation if deviation is not None else None})
    return output

