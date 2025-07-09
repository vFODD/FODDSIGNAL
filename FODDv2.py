import requests
import time
import threading
import datetime
import os
import json
import pandas as pd
import concurrent.futures
import websocket
import queue
from blessed import Terminal

term = Terminal()
print(term.hide_cursor, end='', flush=True)

position_events_queue = queue.Queue()
price_events_queue = queue.Queue()

def print_log_from_y3(message):
    if not hasattr(print_log_from_y3, "current_y"):
        print_log_from_y3.current_y = 2
    if not hasattr(print_log_from_y3, "cleared_once"):
        print_log_from_y3.cleared_once = False
    start_y = print_log_from_y3.current_y
    width = term.width
    height = term.height
    lines = []
    for line in message.splitlines():
        while len(line) > width:
            lines.append(line[:width])
            line = line[width:]
        lines.append(line)
    for line in lines:
        if start_y >= height - 2:
            print(term.clear(), end='', flush=True)
            start_y = 2
            print_log_from_y3.cleared_once = True
        print(term.move_xy(0, start_y) + line + ' ' * (width - len(line)), end='', flush=True)
        start_y += 1
    print_log_from_y3.current_y = start_y

TELEGRAM_TOKEN = "7745249495:AAFC4Jh_xHCgJxZXBSgYusHgSWOVWgH63GM"
TELEGRAM_CHAT_ID = "-1002871674544"

BINANCE_API_KEY = "mJjropkRW3kvWEh3HPOApifDCbOmOaR17JzpqxCJc6qckSXeWG6dmdKPwhkGfLg9"
BINANCE_SECRET_KEY = "SH4bL2BH09AhOosKC0TtlxNEe0oig6WlxuNAPMbCxIdQ5qJPZ6QxBNDPomUC0mV1"

LAST_PRICES = {}
POSITIONS = []
RESULTS = []

SL_BAN_LIST = {}

POSITIONS_FILE = "open_positions.json"

def load_positions_from_file():
    global POSITIONS
    if os.path.exists(POSITIONS_FILE):
        try:
            with open(POSITIONS_FILE, "r", encoding="utf-8") as f:
                POSITIONS[:] = json.load(f)
        except Exception as e:
            print_log_from_y3(f"Pozisyonlar dosyadan okunamadı: {e}")

def save_positions_to_file():
    try:
        with open(POSITIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(POSITIONS, f, ensure_ascii=False, indent=2, default=str)
    except Exception as e:
        print_log_from_y3(f"Pozisyonlar dosyaya kaydedilemedi: {e}")
        
SPECIAL_PENDING_ORDERS = []
COINS_CACHE = None

CLOSING_POSITIONS = set()
closing_positions_lock = threading.Lock()

last_prices_lock = threading.Lock()
positions_lock = threading.Lock()
results_lock = threading.Lock()
sl_ban_list_lock = threading.Lock()
special_pending_orders_lock = threading.Lock()
coins_cache_lock = threading.Lock()
file_io_lock = threading.Lock()

def safe_request(method, url, retries=5, delay=1, **kwargs):
    headers = kwargs.pop("headers", {})
    headers["X-MBX-APIKEY"] = BINANCE_API_KEY
    for attempt in range(retries):
        try:
            response = requests.request(method, url, timeout=10, headers=headers, **kwargs)
            return response
        except Exception:
            time.sleep(delay)
    return None

def get_top_100_coins():
    global COINS_CACHE
    with coins_cache_lock:
        if COINS_CACHE is not None:
            return COINS_CACHE
        try:
            with open("coins.json", "r", encoding="utf-8") as f:
                coins = json.load(f)
            COINS_CACHE = [{"symbol": c["symbol"], "decimals": c.get("decimals", 4)} for c in coins]
            return COINS_CACHE
        except Exception as e:
            print_log_from_y3(f"coins.json okunamadı: {e}")
            return []

def fetch_symbol_ohlcv(symbol, interval='1h', limit=100):
    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval={interval}&limit={limit}"
    response = safe_request("get", url)
    if response and response.status_code == 200:
        klines = response.json()
        df = pd.DataFrame(klines)[[0,1,2,3,4,5]]
        df.columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
        df = df.astype(float)
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('timestamp', inplace=True)
        return df
    return None

def get_last_price(symbol):
    with last_prices_lock:
        return LAST_PRICES.get(symbol)

def send_telegram_signal(symbol, trade_type, entry, special=False):
    wait_time = 0
    while not position_events_queue.empty() and wait_time < 2:
        time.sleep(0.05)
        wait_time += 0.05
    if not COINS_CACHE:
        get_top_100_coins()
    decimals = next((c["decimals"] for c in COINS_CACHE if c["symbol"] == symbol), 4)
    if entry is None:
        return
    entry_time = datetime.datetime.now()
    icon = "🟢" if trade_type == "long" else "🔴"
    direction = trade_type.upper()
    special_text = " (✨Exclusive Signal)" if special else ""
    if trade_type.lower() == "long":
        sl = entry * (1 - 0.02)
        tp = entry * (1 + (0.05 if special else 0.04))
    else:
        sl = entry * (1 + 0.02)
        tp = entry * (1 - (0.05 if special else 0.04))
    with positions_lock, closing_positions_lock:
        already_open = any(pos["symbol"] == symbol and pos["type"] == trade_type for pos in POSITIONS)
        is_closing = (symbol, trade_type) in CLOSING_POSITIONS
    if already_open or is_closing:
        return
    position_events_queue.put({
        'type': 'add_position',
        'symbol': symbol,
        'trade_type': trade_type,
        'entry': entry,
        'sl': sl,
        'tp': tp,
        'entry_time': entry_time,
        'special': special
    })

    message = (
        f"{icon} {symbol} {direction}{special_text}\n"
        f"🎯 Entry: {entry:.{decimals}f}  \n"
        f"🛡️ SL: {sl:.{decimals}f}  \n"
        f"🚀 TP: {tp:.{decimals}f}  \n"
        f"#BinanceFutures"
    )
    binance_url = f"https://www.binance.com/en/futures/{symbol}"
    message_html = message.replace(
        "#BinanceFutures",
        f'<a href="{binance_url}">#BinanceFutures</a>'
    )
    print_log_from_y3(message)
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    data = {"chat_id": TELEGRAM_CHAT_ID, "text": message_html, "parse_mode": "HTML", "disable_web_page_preview": True}
    try:
        safe_request("post", url, data=data)
    except Exception as e:
        print_log_from_y3(f"Telegram mesajı gönderilemedi: {e}")

def send_telegram_result(symbol, result, entry, close, trade_type, entry_time, sl, tp, special=False):
    def to_datetime_str(dt):
        if isinstance(dt, str):
            try:
                dt = datetime.datetime.fromisoformat(dt)
            except Exception:
                return dt
        if isinstance(dt, datetime.datetime):
            return dt.strftime("%d.%m.%y %H:%M")
        return "?"
    if not COINS_CACHE:
        get_top_100_coins()
    decimals = next((c["decimals"] for c in COINS_CACHE if c["symbol"] == symbol), 4)
    pct = ((entry - close) / entry if trade_type == "short" else (close - entry) / entry) * 100
    result_type = "TP" if result == "Kâr" else "SL"
    if result_type == "TP":
        message = f"🟩 {symbol} 🚀 TP - {close:.{decimals}f} ({pct:+.2f}%)"
    else:
        message = f"🟥 {symbol} 🛡️ SL - {close:.{decimals}f} ({pct:+.2f}%)"
    reason = result_type
    exit_time = datetime.datetime.now()
    
    try:
        equity = 100.0
        filename = "foddv2.csv"
        if os.path.exists(filename):
            with file_io_lock, open(filename, "r", encoding="utf-8") as f:
                lines = f.readlines()
                for line in reversed(lines):
                    if "Equity:" in line and line.strip():
                        try:
                            eq = float(line.strip().split("Equity:")[-1])
                            equity = eq
                            break
                        except (ValueError, IndexError):
                            continue
        equity = equity * (1 + pct / 100)
    except Exception:
        equity = None
    
    try:
        with file_io_lock, open("foddv2.csv", "a", encoding="utf-8") as f:
            entry_time_str = to_datetime_str(entry_time)
            exit_time_str = to_datetime_str(exit_time)
            decimals_str = f".{decimals}f"
            sl_str = format(sl, decimals_str) if sl else "?"
            tp_str = format(tp, decimals_str) if tp else "?"
            equity_str = f"{equity:.2f}" if equity is not None else "?"
            special_text = " (✨Exclusive Signal)" if special else ""
            f.write(f"[{entry_time_str} - {exit_time_str}] {symbol} {trade_type.upper()}{special_text} - Entry: {format(entry, decimals_str)}, SL: {sl_str}, TP: {tp_str}, Exit: {format(close, decimals_str)}, Reason: {reason}, Result: {pct:+.2f}%, Equity: {equity_str}\n")
    except Exception as e:
        print_log_from_y3(f"İşlem detayı dosyaya yazılamadı: {e}")
    
    print_log_from_y3(message)
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    data = {"chat_id": TELEGRAM_CHAT_ID, "text": message, "disable_web_page_preview": True}
    try:
        safe_request("post", url, data=data)
    except Exception as e:
        print("Telegram mesajı gönderilemedi:", e)

def get_top_10_volatility_coins():
    if not COINS_CACHE:
        get_top_100_coins()
    coins = COINS_CACHE
    def calc_volatility_and_stdmean(coin):
        symbol = coin["symbol"]
        df_1h = fetch_symbol_ohlcv(symbol, interval='1h', limit=72)
        df_15m = fetch_symbol_ohlcv(symbol, interval='15m', limit=70)
        std_mean_ratio = None
        if df_15m is not None and not df_15m.empty and len(df_15m) >= 69:
            df_15m['ema20'] = df_15m['close'].ewm(span=20, adjust=False).mean()
            last_50 = df_15m.tail(50)
            last_50 = last_50.dropna(subset=['ema20'])
            if len(last_50) == 50:
                deviations = last_50['close'] - last_50['ema20']
                mean_dev = deviations.mean() if len(deviations) > 0 else 0
                std_dev = deviations.std() if len(deviations) > 0 else 0
                std_mean_ratio = std_dev / abs(mean_dev) if mean_dev != 0 else float('nan')
        if df_1h is not None and not df_1h.empty and len(df_1h) >= 72:
            close_max = df_1h['close'].iloc[-72:].max()
            close_min = df_1h['close'].iloc[-72:].min()
            if close_min == 0:
                return None
            volatility = ((close_max - close_min) / close_min) * 100
            return (symbol, volatility, coin, std_mean_ratio)
        return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as executor:
        results = list(executor.map(calc_volatility_and_stdmean, coins))
    scored = [r for r in results if r is not None and r[3] is not None and r[3] < 2]
    scored_sorted = sorted(scored, key=lambda x: x[1], reverse=True)
    now = datetime.datetime.now()
    filtered = []
    trade_types = ["long", "short"]
    with sl_ban_list_lock:
        for symbol, volatility, coin, std_mean_ratio in scored_sorted:
            if volatility < 7:
                continue
            banned_for_both = True
            for trade_type in trade_types:
                ban = SL_BAN_LIST.get((symbol, trade_type))
                if not (ban and now < ban):
                    banned_for_both = False
                    break
            if banned_for_both:
                continue
            filtered.append((symbol, volatility, coin, std_mean_ratio))
            if len(filtered) == 10:
                break
    top10 = filtered[:10]
    return [{"symbol": c[0], "coin": c[2], "volatility": c[1], "std_mean_ratio": c[3]} for c in top10]

def start_multi_stream_websocket():
    if not COINS_CACHE:
        get_top_100_coins()
    coins = COINS_CACHE
    if not coins:
        print_log_from_y3("coins.json veya coin listesi bulunamadı!")
        return
    symbols = [coin['symbol'] for coin in coins]
    streams = '/'.join([f"{symbol.lower()}@aggTrade" for symbol in symbols])
    ws_url = f"wss://fstream.binance.com/stream?streams={streams}"

    def on_message(ws, message):
        try:
            msg = json.loads(message)
            if 'data' not in msg or msg['data'].get('e') != 'aggTrade':
                return
            data = msg['data']
            symbol = data['s']
            price = float(data['p'])
            with last_prices_lock:
                LAST_PRICES[symbol] = price
            price_events_queue.put({
                'type': 'price_update',
                'symbol': symbol,
                'price': price
            })
        except Exception as e:
            print_log_from_y3(f"WebSocket mesaj hatası: {e}")

    def on_error(ws, error):
        print_log_from_y3(f"WebSocket hatası: {error}")

    def on_close(ws, close_status_code, close_msg):
        print_log_from_y3(f"WebSocket kapandı: {close_status_code} {close_msg}")

    def on_open(ws):
        print_log_from_y3(f"WebSocket açıldı: {len(symbols)} sembol")

    def run_socket():
        while True:
            ws = websocket.WebSocketApp(ws_url,
                                        on_message=on_message,
                                        on_error=on_error,
                                        on_close=on_close,
                                        on_open=on_open)
            ws.run_forever()
            print_log_from_y3("WebSocket bağlantısı koptu, 5 sn sonra tekrar denenecek.")
            time.sleep(5)

    t = threading.Thread(target=run_socket, daemon=True)
    t.start()

def send_weekly_progress():
    now = datetime.datetime.now()
    from chart_generator import generate_weekly_cumulative_return_chart
    filename = "foddv2.csv"
    today = now
    week_start = today - datetime.timedelta(days=today.weekday())
    equity_by_day = {}
    with file_io_lock:
        if os.path.exists(filename):
            with open(filename, "r", encoding="utf-8") as f:
                lines = f.readlines()
            for line in lines:
                if not line.strip() or "Equity:" not in line:
                    continue
                try:
                    date_part = line.split("]")[0].split("[")[-1].split("-")[-1].strip()
                    date_obj = datetime.datetime.strptime(date_part, "%d.%m.%y %H:%M")
                    day_key = date_obj.date()
                    equity_str = line.strip().split("Equity:")[-1].strip()
                    equity = float(equity_str)
                    equity_by_day[day_key] = equity
                except Exception:
                    continue
    sorted_days = sorted(equity_by_day.keys())
    daily_returns = []
    prev_equity = 100.0
    for d in sorted_days:
        eq = equity_by_day[d]
        pct = (eq - prev_equity) / prev_equity
        daily_returns.append((pct, eq))
        prev_equity = eq
    week_days = 7
    week_start = today - datetime.timedelta(days=today.weekday())
    week_start_date = week_start.date()
    today_date = today.date()
    week_daily_returns = [item for d, item in zip(sorted_days, daily_returns) if week_start_date <= d <= today_date]
    initial_balance = 100.0
    ref_balance = initial_balance
    for pct, eq in week_daily_returns:
        ref_balance = ref_balance * (1 + pct)
    weekly_progress = ((ref_balance - initial_balance) / initial_balance) * 100
    is_last_day = (today.weekday() == (week_days - 1)) and (len(week_daily_returns) == week_days)

    if is_last_day:
        message = f"📆 Weekly Results: {'+' if weekly_progress >= 0 else ''}{weekly_progress:.2f}%"
    else:
        message = f"📈 Weekly Progress: {'+' if weekly_progress >= 0 else ''}{weekly_progress:.2f}%"
    print_log_from_y3(message)

    try:
        symbol = "WEEKLY"
        chart_returns = [item[0] for item in week_daily_returns]
        img_buf = generate_weekly_cumulative_return_chart(chart_returns, symbol)
        image_path = f"foddv2_wp.png"
        with open(image_path, "wb") as f:
            f.write(img_buf.read())
    except Exception as e:
        print_log_from_y3(f"Haftalık ilerleme grafiği oluşturulamadı: {e}")
        image_path = None

    if image_path:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendPhoto"
        data = {"chat_id": TELEGRAM_CHAT_ID, "caption": message}
        try:
            with open(image_path, "rb") as f:
                files = {"photo": f}
                safe_request("post", url, data=data, files=files)
        except Exception as e:
            print_log_from_y3(f"Telegram fotoğrafı gönderilemedi: {e}")
    else:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        data = {"chat_id": TELEGRAM_CHAT_ID, "text": message}
        try:
            safe_request("post", url, data=data)
        except Exception as e:
            print_log_from_y3(f"Haftalık ilerleme mesajı gönderilemedi: {e}")

def check_special_condition(top_coins):
    signal_generated = False
    now = datetime.datetime.now()
    def fetch_ohlcv_pair(coin):
        symbol = coin["symbol"]
        df_15m = fetch_symbol_ohlcv(symbol, interval='15m', limit=120)
        df_1h = fetch_symbol_ohlcv(symbol, interval='1h', limit=17)
        return (symbol, {"df_15m": df_15m, "df_1h": df_1h, "coin": coin})
    max_workers = min(10, len(top_coins)) if top_coins else 1
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(fetch_ohlcv_pair, top_coins))
    for symbol, data in results:
        coin = data["coin"]
        df_15m = data["df_15m"]
        df_1h = data["df_1h"]
        if df_15m is None or len(df_15m) < 51 or df_1h is None or len(df_1h) < 16:
            continue
        decimals = coin['decimals'] if 'decimals' in coin else 4
        df_15m['ema20'] = df_15m['close'].ewm(span=20, adjust=False).mean()
        df_15m['ema60'] = df_15m['close'].ewm(span=60, adjust=False).mean()
        ema20 = df_15m['ema20'].iloc[-51:-1]
        ema60 = df_15m['ema60'].iloc[-51:-1]
        all_below = all(e20 < e60 for e20, e60 in zip(ema20, ema60))
        all_above = all(e20 > e60 for e20, e60 in zip(ema20, ema60))
        ema20_prev = df_15m['ema20'].iloc[-2]
        ema60_prev = df_15m['ema60'].iloc[-2]
        ema20_curr = df_15m['ema20'].iloc[-1]
        ema60_curr = df_15m['ema60'].iloc[-1]
        
        ban_long = SL_BAN_LIST.get((symbol, 'long'))
        ban_short = SL_BAN_LIST.get((symbol, 'short'))
        
        already_open_long = any(pos['symbol'] == symbol and pos['type'] == 'long' for pos in POSITIONS)
        already_open_short = any(pos['symbol'] == symbol and pos['type'] == 'short' for pos in POSITIONS)
        
        if all_below and ema20_prev < ema60_prev and ema20_curr > ema60_curr:
            if not already_open_long and not (ban_long and now < ban_long):
                SPECIAL_PENDING_ORDERS[:] = [o for o in SPECIAL_PENDING_ORDERS if not (o["symbol"] == symbol and o["type"] == "long")]
                SPECIAL_PENDING_ORDERS.append({
                    "symbol": symbol,
                    "type": "long",
                    "special": True,
                    "pending_price": ema60_curr,
                    "created_at": now
                })
                print_log_from_y3(f"✨ ÖZEL LONG BEKLEYEN EMİR: {symbol} - {format(ema60_curr, f'.{decimals}f')} (EMA60)")
        if all_above and ema20_prev > ema60_prev and ema20_curr < ema60_curr:
            if not already_open_short and not (ban_short and now < ban_short):
                SPECIAL_PENDING_ORDERS[:] = [o for o in SPECIAL_PENDING_ORDERS if not (o["symbol"] == symbol and o["type"] == "short")]
                SPECIAL_PENDING_ORDERS.append({
                    "symbol": symbol,
                    "type": "short",
                    "special": True,
                    "pending_price": ema60_curr,
                    "created_at": now
                })
                print_log_from_y3(f"✨ ÖZEL SHORT BEKLEYEN EMİR: {symbol} - {format(ema60_curr, f'.{decimals}f')} (EMA60)")
        close_prev1 = df_1h['close'].iloc[-3]
        close_now = df_1h['close'].iloc[-2]
        pct_change = (close_now - close_prev1) / close_prev1 * 100
        delta = df_1h['close'].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        avg_gain = gain.rolling(window=14, min_periods=14).mean()
        avg_loss = loss.rolling(window=14, min_periods=14).mean()
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        rsi_prev2 = rsi.iloc[-3]
        ws_price = get_last_price(symbol)
        if pct_change > 5:
            if rsi_prev2 < 50:
                if not already_open_long and not (ban_long and now < ban_long):
                    entry_price = ws_price if ws_price is not None else close_now
                    send_telegram_signal(symbol, "long", entry_price, special=True)
                    signal_generated = True
            elif 50 <= rsi_prev2 <= 65:
                pending_price = close_now * 0.98
                if not already_open_long and not (ban_long and now < ban_long):
                    SPECIAL_PENDING_ORDERS[:] = [o for o in SPECIAL_PENDING_ORDERS if not (o["symbol"] == symbol and o["type"] == "long")]
                    SPECIAL_PENDING_ORDERS.append({
                        "symbol": symbol,
                        "type": "long",
                        "special": True,
                        "pending_price": pending_price,
                        "created_at": now
                    })
                    print_log_from_y3(f"✨ ÖZEL LONG BEKLEYEN EMİR: {symbol} - {pending_price:.{decimals}f}")
        if pct_change < -5:
            if rsi_prev2 > 50:
                if not already_open_short and not (ban_short and now < ban_short):
                    entry_price = ws_price if ws_price is not None else close_now
                    send_telegram_signal(symbol, "short", entry_price, special=True)
                    signal_generated = True
            elif 35 <= rsi_prev2 <= 50:
                pending_price = close_now * 1.02
                if not already_open_short and not (ban_short and now < ban_short):
                    SPECIAL_PENDING_ORDERS[:] = [o for o in SPECIAL_PENDING_ORDERS if not (o["symbol"] == symbol and o["type"] == "short")]
                    SPECIAL_PENDING_ORDERS.append({
                        "symbol": symbol,
                        "type": "short",
                        "special": True,
                        "pending_price": pending_price,
                        "created_at": now
                    })
                    print_log_from_y3(f"✨ ÖZEL SHORT BEKLEYEN EMİR: {symbol} - {pending_price:.{decimals}f}")
    return signal_generated

def ema20_trend_bias(top_coins):
    now = datetime.datetime.now()
    signal_generated = False
    def check_trend(coin):
        nonlocal signal_generated
        symbol = coin["symbol"]
        ban_long = SL_BAN_LIST.get((symbol, 'long'))
        ban_short = SL_BAN_LIST.get((symbol, 'short'))
        already_open_long = any(pos["symbol"] == symbol and pos["type"] == "long" for pos in POSITIONS)
        already_open_short = any(pos["symbol"] == symbol and pos["type"] == "short" for pos in POSITIONS)
        df = fetch_symbol_ohlcv(symbol, interval='15m', limit=100)
        if df is None or len(df) < 60:
            return None
        df['ema'] = df['close'].ewm(span=20, adjust=False).mean()
        df = df.dropna().copy()
        last_50 = df.tail(50)
        ratio = (last_50['close'] > last_50['ema']).sum() / len(last_50)
        deviations = last_50['close'] - last_50['ema']
        mean_dev = deviations.mean() if len(deviations) > 0 else 0
        std_dev = deviations.std() if len(deviations) > 0 else 0
        std_mean_ratio = std_dev / abs(mean_dev) if mean_dev != 0 else float('nan')
        ws_price = get_last_price(symbol)
        last_close = last_50['close'].iloc[-1]
        last_ema = last_50['ema'].iloc[-1]
        max_dist = ((last_50['close'] - last_50['ema']).abs() / last_50['ema']).max()
        if ratio >= 0.9 and std_mean_ratio < 1 and not (ban_long and now < ban_long) and not already_open_long:
            if max_dist > 0.05:
                if last_close < last_ema * 0.98:
                    entry_price = last_ema * 0.98
                    send_telegram_signal(symbol, "long", entry_price)
                    signal_generated = True
                    return True
                else:
                    return None
            elif 0.03 <= max_dist <= 0.05:
                if last_close < last_ema * 0.99:
                    entry_price = last_ema * 0.99
                    send_telegram_signal(symbol, "long", entry_price)
                    signal_generated = True
                    return True
                else:
                    return None
            else:
                if abs(last_close - last_ema) / last_ema <= 0.0025:
                    entry_price = ws_price if ws_price is not None else df['close'].iloc[-1]
                    send_telegram_signal(symbol, "long", entry_price)
                    signal_generated = True
                    return True
                else:
                    return None
        if (1 - ratio) >= 0.9 and std_mean_ratio < 1 and not (ban_short and now < ban_short) and not already_open_short:
            if max_dist > 0.05:
                if last_close > last_ema * 1.02:
                    entry_price = last_ema * 1.02
                    send_telegram_signal(symbol, "short", entry_price)
                    signal_generated = True
                    return True
                else:
                    return None
            elif 0.03 <= max_dist <= 0.05:
                if last_close > last_ema * 1.01:
                    entry_price = last_ema * 1.01
                    send_telegram_signal(symbol, "short", entry_price)
                    signal_generated = True
                    return True
                else:
                    return None
            else:
                if abs(last_close - last_ema) / last_ema <= 0.0025:
                    entry_price = ws_price if ws_price is not None else df['close'].iloc[-1]
                    send_telegram_signal(symbol, "short", entry_price)
                    signal_generated = True
                    return True
                else:
                    return None
        return None
    max_workers = min(10, len(top_coins)) if top_coins else 1
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        list(executor.map(check_trend, top_coins))
    return signal_generated

def process_special_pending_orders():
    now = datetime.datetime.now()
    with special_pending_orders_lock:
        SPECIAL_PENDING_ORDERS[:] = [o for o in SPECIAL_PENDING_ORDERS if not ("created_at" in o and (now - o["created_at"]).total_seconds() > 21600)]
        orders = list(SPECIAL_PENDING_ORDERS)
    for order in orders:
        symbol = order["symbol"]
        order_type = order["type"]
        pending_price = order.get("pending_price")
        with sl_ban_list_lock:
            ban = SL_BAN_LIST.get((symbol, order_type))
        price = get_last_price(symbol)
        if price is None:
            continue
        trigger = (
            (order_type == "long" and pending_price is not None and price <= pending_price) or
            (order_type == "short" and pending_price is not None and price >= pending_price)
        )
        if trigger and not (ban and now < ban):
            with special_pending_orders_lock:
                SPECIAL_PENDING_ORDERS[:] = [o for o in SPECIAL_PENDING_ORDERS if not (o["symbol"] == symbol and o["type"] == order_type)]
            send_telegram_signal(symbol, order_type, price, special=True)

def process_price_events():
    try:
        with positions_lock:
            open_symbols = set(pos['symbol'] for pos in POSITIONS)
        global top_coins
        top10_symbols = set(c['symbol'] for c in top_coins) if 'top_coins' in globals() and top_coins else set()
        allowed_symbols = open_symbols | top10_symbols
    except Exception as e:
        allowed_symbols = set()
    while not price_events_queue.empty():
        try:
            event = price_events_queue.get_nowait()
            if event['type'] == 'price_update':
                symbol = event['symbol']
                price = event['price']
                if symbol in allowed_symbols:
                    check_positions_for_symbol(symbol, price)
        except queue.Empty:
            break
        except Exception as e:
            print_log_from_y3(f"Price event işlem hatası: {e}")

def check_positions_for_symbol(symbol, price):
    if not COINS_CACHE:
        get_top_100_coins()
    with positions_lock:
        if not POSITIONS:
            for y in range(0, 20):
                print(term.move_xy(56, y*2+5) + " " * (term.width - 56), end='', flush=True)
            return
        long_lines = []
        short_lines = []
        symbol_type_list = sorted([(pos['symbol'], pos['type']) for pos in POSITIONS])
        symbol_type_to_idx = {k: i for i, k in enumerate(symbol_type_list)}
        used_lines = set()
        to_remove = []
        for pos in POSITIONS[:]:
            sym = pos['symbol']
            entry = pos['entry']
            trade_type = pos['type']
            special = pos.get('special', False)
            current_price = price if sym == symbol else get_last_price(sym)
            if current_price is None:
                continue
            close = False
            result = None
            idx = symbol_type_to_idx.get((sym, trade_type), None)
            if idx is not None:
                used_lines.add(idx)
            if entry is not None and entry != 0:
                if trade_type == 'long':
                    sl_price = entry * (1 - 0.02)
                    tp_price = entry * (1 + (0.05 if special else 0.04))
                    if current_price <= sl_price:
                        result = "Zarar"
                        close = True
                    elif current_price >= tp_price:
                        result = "Kâr"
                        close = True
                elif trade_type == 'short':
                    sl_price = entry * (1 + 0.02)
                    tp_price = entry * (1 - (0.05 if special else 0.04))
                    if current_price >= sl_price:
                        result = "Zarar"
                        close = True
                    elif current_price <= tp_price:
                        result = "Kâr"
                        close = True
            if close:
                if idx is not None:
                    print(term.move_xy(56, idx*2+5) + " " * (term.width - 56), end='', flush=True)
                to_remove.append(pos)
                with closing_positions_lock:
                    CLOSING_POSITIONS.add((pos["symbol"], pos["type"]))
                position_events_queue.put({
                    'type': 'close_position',
                    'position': pos,
                    'result': result,
                    'close_price': current_price,
                    'special': special
                })
                if result == "Zarar":
                    with sl_ban_list_lock:
                        SL_BAN_LIST[(pos["symbol"], pos["type"])] = datetime.datetime.now() + datetime.timedelta(hours=6)
            else:
                diff_pct = None
                if entry is not None and entry != 0:
                    if trade_type == 'short':
                        diff_pct = ((entry - current_price) / entry) * 100
                    else:
                        diff_pct = ((current_price - entry) / entry) * 100
                    diff_pct_str = f" ({diff_pct:+.2f}%)"
                else:
                    diff_pct_str = ""
                prefix = "🚀" if diff_pct is not None and diff_pct >= 0 else "⚠️"
                decimals_disp = next((c["decimals"] for c in COINS_CACHE if c["symbol"] == sym), 4)
                line = f"{prefix} {sym}: {current_price:.{decimals_disp}f}{diff_pct_str}"
                if trade_type == 'long':
                    long_lines.append(line)
                else:
                    short_lines.append(line)
        y = 5
        if long_lines:
            header_long = "↑ LONG İŞLEMLER:"
            print(term.move_xy(56, y) + term.bold(header_long) + term.normal, end='', flush=True)
            y += 2
            for l in long_lines:
                print(term.move_xy(56, y) + l + " " * (term.width - 56 - len(l)), end='', flush=True)
                y += 2
        if short_lines:
            y += 1
            header_short = "↓ SHORT İŞLEMLER:"
            print(term.move_xy(56, y) + term.bold(header_short) + term.normal, end='', flush=True)
            y += 2
            for l in short_lines:
                print(term.move_xy(56, y) + l + " " * (term.width - 56 - len(l)), end='', flush=True)
                y += 2
        for i in range(y//2, 20):
            print(term.move_xy(56, i*2+5) + " " * (term.width - 56), end='', flush=True)
        for pos in to_remove:
            if pos in POSITIONS:
                POSITIONS.remove(pos)

def process_position_events():
    while not position_events_queue.empty():
        try:
            event = position_events_queue.get_nowait()
            if event['type'] == 'add_position':
                with positions_lock:
                    POSITIONS.append({
                        "symbol": event['symbol'],
                        "type": event['trade_type'],
                        "entry": event['entry'],
                        "sl": event['sl'],
                        "tp": event['tp'],
                        "entry_time": event['entry_time'],
                        "special": event['special']
                    })
                save_positions_to_file()
            elif event['type'] == 'close_position':
                pos = event['position']
                result = event['result']
                close_price = event['close_price']
                special = event['special']
                with results_lock:
                    RESULTS.append((result, pos["symbol"], pos["entry"], close_price, pos["type"]))
                send_telegram_result(pos["symbol"], result, pos["entry"], close_price, pos["type"], 
                                   pos.get("entry_time"), pos.get("sl"), pos.get("tp"), special=special)
                with closing_positions_lock:
                    CLOSING_POSITIONS.discard((pos["symbol"], pos["type"]))
                with positions_lock:
                    if pos in POSITIONS:
                        POSITIONS.remove(pos)
                save_positions_to_file()
            elif event['type'] == 'remove_positions':
                with positions_lock:
                    for pos in event['positions']:
                        if pos in POSITIONS:
                            POSITIONS.remove(pos)
                save_positions_to_file()
        except queue.Empty:
            break
        except Exception as e:
            print_log_from_y3(f"Position event işlem hatası: {e}")

def main_loop():
    last_summary_date = None
    top_coins = get_top_10_volatility_coins()
    def print_top_coins(coins):
        names = [f"{c['symbol']}" for c in coins]
        line = ", ".join(names)
        print(term.move_xy(0, 0) + " " * term.width, end='', flush=True)
        print(term.move_xy(0, 0) + term.bold(line) + term.normal, end='', flush=True)
    print_top_coins(top_coins)
    last_top_coins_update = datetime.datetime.now()
    trade_types = ["long", "short"]
    import time as _time
    def print_duration(label, duration):
        print_log_from_y3(f"[TIMER] {label}: {duration:.2f} sn")
    while True:
        try:
            now = datetime.datetime.now()
            t0 = _time.time()
            if (now - last_top_coins_update).total_seconds() > 300:
                t1 = _time.time()
                top_coins = get_top_10_volatility_coins()
                t2 = _time.time()
                print_top_coins(top_coins)
                t3 = _time.time()
                last_top_coins_update = now
                print_duration("get_top_10_volatility_coins", t2-t1)
                print_duration("print_top_coins", t3-t2)
            if now.hour == 23 and now.minute == 59 and last_summary_date != now.strftime("%Y-%m-%d %H:%M"):
                t4 = _time.time()
                send_weekly_progress()
                t5 = _time.time()
                last_summary_date = now.strftime("%Y-%m-%d %H:%M")
                RESULTS.clear()
                print_duration("send_weekly_progress", t5-t4)
            t6 = _time.time()
            process_special_pending_orders()
            t7 = _time.time()
            process_position_events()
            t8 = _time.time()
            process_price_events()
            t9 = _time.time()
            open_positions = {(pos["symbol"], pos["type"]) for pos in POSITIONS}
            has_available_slots = any((coin["symbol"], trade_type) not in open_positions 
                                    for coin in top_coins for trade_type in trade_types)
            print_duration("process_special_pending_orders", t7-t6)
            print_duration("process_position_events", t8-t7)
            print_duration("process_price_events", t9-t8)
            if has_available_slots:
                t10 = _time.time()
                special_condition_met = check_special_condition(top_coins)
                t11 = _time.time()
                print_duration("check_special_condition", t11-t10)
                if special_condition_met:
                    continue
                t12 = _time.time()
                ema20_trend_met = ema20_trend_bias(top_coins)
                t13 = _time.time()
                print_duration("ema20_trend_bias", t13-t12)
                if ema20_trend_met:
                    continue
            t14 = _time.time()
            print_duration("main_loop iteration", t14-t0)
            time.sleep(1)
        except Exception as e:
            continue

if __name__ == "__main__":
    load_positions_from_file()
    start_multi_stream_websocket()
    main_loop()