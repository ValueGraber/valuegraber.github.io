"""สแกนออปชั่นหุ้นสหรัฐ → docs/options.json (หน้า ลงทุน → ออปชั่น อ่านไฟล์นี้)

ต่อหุ้นหนึ่งตัวเก็บ: ราคา แนวโน้ม (เส้น 20/50/200 วัน) แนวรับแนวต้าน 20 และ 60 วัน ATR
ความผันผวนจริง 20 วัน (HV) และจากออปชั่นอายุราว 45 วัน: IV ที่ราคา ATM (คำนวณเองจากราคากลาง
ด้วย Black-Scholes ไม่ใช้ IV ของ Yahoo ซึ่งมักเพี้ยน) ส่วนต่าง bid-ask, open interest
หุ้นในรายการหลัก (BASE) เก็บตาราง strike ไว้ให้หน้าวางแผนใช้ราคาจริงด้วย

IV ของแต่ละวันเก็บต่อใน docs/ivhist.json (เฉพาะราคาปิด ไม่เก็บรอบระหว่างวัน) พอมีครบ 20 วัน
จะคำนวณ IV Rank / IV Percentile ให้ ระหว่างนั้นหน้าเว็บใช้ IV เทียบ HV แทน

  python options_scan.py           รายการหลัก + หุ้นที่เคยมีในไฟล์ (ตัวอื่นใช้ข้อมูลเดิม)
  python options_scan.py --all     รายการหลัก + หุ้น S&P 500 ทั้งหมด (รอบเช้า วันละครั้ง)
  python options_scan.py --live    รอบกลางคืน: ถ้าตลาดไม่ได้เปิดจะจบทันที ไม่ดึงอะไร
  python options_scan.py --check   (ใช้ใน GitHub Actions) เขียน skip=true/false ลง GITHUB_OUTPUT
"""
import json
import math
import os
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "docs" / "options.json"
IVH = ROOT / "docs" / "ivhist.json"
DATA = ROOT / "docs" / "data.json"
sys.path.insert(0, str(ROOT / "tools"))
from fresh import CLOSE, CLOSE_DONE, NY, OPEN, is_trading_day, last_trading_day  # noqa: E402

BASE = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA",
        "AMD", "AVGO", "NFLX", "PLTR", "JPM", "BAC", "XOM", "UNH", "COST", "MU"]
R = 0.04            # ดอกเบี้ยไร้ความเสี่ยงโดยประมาณ ใช้ทั้งที่นี่และในหน้าเว็บ
DTE_WANT = 45       # อายุสัญญาที่อยากได้ (วัน)
DTE_MIN, DTE_MAX = 21, 80
KEEP_DAYS = 260     # เก็บประวัติ IV ราว 1 ปี
TIME_CAP = 40 * 60  # รอบ --all ทำงานไม่เกิน 40 นาที ที่เหลือใช้ข้อมูลเดิม


def log(*a):
    print(*a, flush=True)


def rnd(x, d=2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, d) if math.isfinite(x) else None


def nz(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return 0
    return int(x) if math.isfinite(x) else 0


def yahoo(sym):
    return sym.replace(".", "-")


# ---------- Black-Scholes ----------
def ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs(S, K, T, sig, call, r=R):
    if T <= 0 or sig <= 0:
        return max(0.0, (S - K) if call else (K - S))
    sq = sig * math.sqrt(T)
    d1 = (math.log(S / K) + (r + sig * sig / 2) * T) / sq
    d2 = d1 - sq
    if call:
        return S * ncdf(d1) - K * math.exp(-r * T) * ncdf(d2)
    return K * math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1)


def implied_vol(price, S, K, T, call):
    """หา IV จากราคาออปชั่นด้วยการแบ่งครึ่ง คืน None ถ้าราคาต่ำกว่ามูลค่าที่แท้จริงหรือเพี้ยน"""
    if not price or price <= 0 or T <= 0:
        return None
    lo, hi = 0.01, 5.0
    if price <= bs(S, K, T, lo, call) or price >= bs(S, K, T, hi, call):
        return None
    for _ in range(60):
        mid = (lo + hi) / 2
        if bs(S, K, T, mid, call) > price:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


# ---------- market clock ----------
def market_open(now=None):
    ny = (now or datetime.now(NY)).astimezone(NY)
    return is_trading_day(ny.date()) and OPEN <= ny.time() < CLOSE


def load_json(p, d):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return d


def check():
    """ตัดสินว่ารอบนี้ควรรันไหม (ใช้แค่ไลบรารีมาตรฐาน จึงรันก่อนติดตั้ง yfinance ได้)"""
    now = datetime.now(NY)
    cur = load_json(OUT, {})
    if "--live" in sys.argv:
        skip = not market_open(now)
        why = "ตลาดไม่ได้เปิด ข้าม" if skip else "ตลาดเปิดอยู่ ดึงข้อมูลระหว่างวัน"
    else:
        want = last_trading_day(now).isoformat()
        skip = (cur.get("fullAsOf") or "") >= want
        why = f"มีข้อมูลปิดของ {want} ครบแล้ว ข้าม" if skip else f"ยังไม่มีข้อมูลปิดของ {want} ดึงใหม่"
    log(why)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"skip={'true' if skip else 'false'}\n")


# ---------- prices ----------
def price_block(syms):
    """ราคารายวัน 1 ปี → แนวโน้ม แนวรับแนวต้าน ATR HV"""
    import pandas as pd
    import yfinance as yf
    out = {}
    tick = [yahoo(s) for s in syms]
    for i in range(0, len(tick), 100):
        chunk = tick[i:i + 100]
        df = None
        for attempt in range(3):
            try:
                df = yf.download(chunk, period="1y", interval="1d", auto_adjust=False, progress=False, threads=True, group_by="column")
                break
            except Exception as e:  # noqa: BLE001
                log(f"ดึงราคาชุด {i} ไม่สำเร็จ (ครั้งที่ {attempt + 1}):", e)
                time.sleep(10)
        if df is None or df.empty:
            continue
        multi = isinstance(df.columns, pd.MultiIndex)
        for t in chunk:
            try:
                c = (df["Close"][t] if multi else df["Close"]).dropna()
                h = (df["High"][t] if multi else df["High"]).reindex(c.index)
                lo = (df["Low"][t] if multi else df["Low"]).reindex(c.index)
            except KeyError:
                continue
            if len(c) < 2:
                continue
            px, prev = float(c.iloc[-1]), float(c.iloc[-2])
            lr = (c / c.shift(1)).apply(math.log).dropna()
            tr = pd.concat([h - lo, (h - c.shift(1)).abs(), (lo - c.shift(1)).abs()], axis=1).max(axis=1)
            res_prior = float(h.iloc[-21:-1].max())   # จุดสูงสุด 20 วันก่อนวันนี้ ใช้ดูการทะลุ
            sup_prior = float(lo.iloc[-21:-1].min())
            out[t] = {
                "px": rnd(px), "chg": rnd((px / prev - 1) * 100),
                "t": c.index[-1].strftime("%Y-%m-%d"),
                "ma20": rnd(c.tail(20).mean()) if len(c) >= 20 else None, "ma50": rnd(c.tail(50).mean()) if len(c) >= 50 else None,
                "ma200": rnd(c.tail(200).mean()) if len(c) >= 200 else None,
                "sup": rnd(lo.tail(20).min()), "res": rnd(h.tail(20).max()),
                "sup60": rnd(lo.tail(60).min()), "res60": rnd(h.tail(60).max()),
                "bo": 1 if px > res_prior else (-1 if px < sup_prior else 0),
                "atr": rnd(tr.tail(14).mean()),
                "hv": rnd(float(lr.tail(20).std()) * math.sqrt(252) * 100, 1) if len(lr) >= 10 else None,
                "hi52": rnd(h.max()), "lo52": rnd(lo.min()),
            }
        time.sleep(1)
    return out


def vix_block():
    import yfinance as yf
    try:
        c = yf.download("^VIX", period="1y", interval="1d", auto_adjust=False, progress=False)["Close"].dropna()
        if hasattr(c, "columns"):
            c = c.iloc[:, 0]
        v, prev = float(c.iloc[-1]), float(c.iloc[-2])
        return {"v": rnd(v), "chg": rnd(v - prev), "pct": rnd((c < v).mean() * 100, 0), "avg": rnd(c.mean())}
    except Exception as e:  # noqa: BLE001
        log("ดึง VIX ไม่ได้:", e)
        return None


# ---------- options ----------
def is_monthly(e):
    """สัญญารายเดือนมาตรฐาน (ศุกร์ที่ 3 ของเดือน) มักคล่องกว่าสัญญารายสัปดาห์"""
    d = date.fromisoformat(e)
    return d.weekday() == 4 and 15 <= d.day <= 21


def pick_expiry(exps, today):
    best, bd = None, 1e9
    monthly = [e for e in exps if is_monthly(e) and DTE_MIN <= (date.fromisoformat(e) - today).days <= DTE_MAX]
    for e in (monthly or exps):
        try:
            dte = (date.fromisoformat(e) - today).days
        except ValueError:
            continue
        if DTE_MIN <= dte <= DTE_MAX and abs(dte - DTE_WANT) < bd:
            best, bd = e, abs(dte - DTE_WANT)
    if best is None:  # ไม่มีในช่วง: เอาสัญญาแรกที่อายุเกิน 21 วัน
        later = [e for e in exps if (date.fromisoformat(e) - today).days >= DTE_MIN]
        best = later[0] if later else None
    return best


def mid_of(row):
    b, a, last = float(row.get("bid") or 0), float(row.get("ask") or 0), float(row.get("lastPrice") or 0)
    if b > 0 and a >= b:
        return (a + b) / 2, (a - b) / ((a + b) / 2), True
    return (last if last > 0 else None), None, False


def option_block(sym, px, today, ladder):
    import yfinance as yf
    tk = yf.Ticker(yahoo(sym))
    exps = list(tk.options or [])
    exp = pick_expiry(exps, today)
    if not exp:
        return None
    ch = tk.option_chain(exp)
    calls, puts = ch.calls, ch.puts
    if calls is None or calls.empty or puts is None or puts.empty:
        return None
    dte = (date.fromisoformat(exp) - today).days
    T = max(dte, 1) / 365
    kc = calls.iloc[(calls["strike"] - px).abs().argsort()[:1]].iloc[0]
    kp = puts.iloc[(puts["strike"] - px).abs().argsort()[:1]].iloc[0]
    cm, cs, cq = mid_of(kc)
    pm, ps, pq = mid_of(kp)
    ivs = [v for v in (implied_vol(cm, px, float(kc["strike"]), T, True), implied_vol(pm, px, float(kp["strike"]), T, False)) if v]
    iv = sum(ivs) / len(ivs) if ivs else None
    sprs = [s for s in (cs, ps) if s is not None]
    oi = lambda df: int(df["openInterest"].fillna(0).sum())  # noqa: E731
    out = {
        "exp": exp, "dte": dte, "k": rnd(kc["strike"]),
        "iv": rnd(iv * 100, 1) if iv else None,
        "cMid": rnd(cm), "pMid": rnd(pm),
        "spr": rnd(max(sprs) * 100, 1) if sprs else None,      # ส่วนต่าง bid-ask ของ ATM (% ของราคากลาง)
        "q": "ba" if (cq and pq) else "last",                    # ba = มี bid/ask จริง, last = ใช้ราคาซื้อขายล่าสุด
        "oiAtm": nz(kc.get("openInterest")) + nz(kp.get("openInterest")),
        "oi": oi(calls) + oi(puts),
        "vol": int(calls["volume"].fillna(0).sum() + puts["volume"].fillna(0).sum()),
        "em": rnd(px * iv * math.sqrt(T)) if iv else None,       # คาดว่าราคาจะแกว่ง ± เท่านี้ถึงวันหมดอายุ (1 SD)
    }
    if ladder:
        lo, hi = px * 0.8, px * 1.2
        m = calls[["strike", "bid", "ask", "lastPrice", "openInterest"]].merge(
            puts[["strike", "bid", "ask", "lastPrice", "openInterest"]], on="strike", suffixes=("c", "p"))
        m = m[(m["strike"] >= lo) & (m["strike"] <= hi)]
        m = m.iloc[(m["strike"] - px).abs().argsort()[:60]].sort_values("strike")
        f = lambda v: rnd(v) or 0  # noqa: E731
        out["lad"] = [[f(r.strike), f(r.bidc), f(r.askc), f(r.lastPricec), nz(r.openInterestc),
                       f(r.bidp), f(r.askp), f(r.lastPricep), nz(r.openInterestp)] for r in m.fillna(0).itertuples()]
    return out


# ---------- IV history ----------
def update_hist(hist, day, ivs):
    d, v = hist.setdefault("d", []), hist.setdefault("v", {})
    if not d or d[-1] < day:
        d.append(day)
        for arr in v.values():
            arr.append(None)
    elif d[-1] != day:
        return hist  # วันเก่ากว่าวันล่าสุดในไฟล์: ไม่แตะ
    n = len(d)
    for s, iv in ivs.items():
        arr = v.setdefault(s, [None] * n)
        arr.extend([None] * (n - len(arr)))
        arr[-1] = iv
    if n > KEEP_DAYS:
        cut = n - KEEP_DAYS
        hist["d"] = d[cut:]
        for s in v:
            v[s] = v[s][cut:]
    return hist


def rank_of(hist, sym, iv):
    arr = [x for x in (hist.get("v", {}).get(sym) or []) if x is not None]
    if iv is None or len(arr) < 20:
        return None, None, len(arr)
    lo, hi = min(arr), max(arr)
    ivr = (iv - lo) / (hi - lo) * 100 if hi > lo else 50
    ivp = sum(1 for x in arr if x < iv) / len(arr) * 100
    return rnd(ivr, 0), rnd(ivp, 0), len(arr)


def main():
    if "--check" in sys.argv:
        return check()
    live_run = "--live" in sys.argv
    if live_run and not market_open():
        log("ตลาดไม่ได้เปิด ไม่ดึงข้อมูล")
        return
    start = time.time()
    old = load_json(OUT, {})
    rows = {r["s"]: r for r in old.get("rows", [])}
    syms = list(BASE)
    if "--all" in sys.argv:
        sp = [s["symbol"] for s in load_json(DATA, {}).get("stocks", [])]
        syms += [s for s in sp if s not in syms]
    log(f"สแกน {len(syms)} ตัว{' (ระหว่างวัน)' if live_run else ''}")

    prices = price_block(syms)
    ny = datetime.now(NY)
    today = ny.date()
    done, fails, streak = 0, 0, 0
    for s in syms:
        p = prices.get(yahoo(s))
        if not p:
            continue
        if time.time() - start > TIME_CAP:
            log("ใช้เวลาครบกำหนดแล้ว ตัวที่เหลือใช้ข้อมูลเดิม")
            break
        o = None
        for attempt in range(2):
            try:
                o = option_block(s, p["px"], today, s in BASE)
                break
            except Exception as e:  # noqa: BLE001
                log(f"{s}: ดึงออปชั่นไม่สำเร็จ ({attempt + 1})", str(e)[:120])
                time.sleep(3)
        if o is None:
            fails += 1
            streak += 1
            if streak >= 8:
                log("ล้มเหลวติดกันหลายตัว พัก 60 วินาที")
                time.sleep(60)
                streak = 0
            # ราคาใหม่ใช้ได้ ออปชั่นใช้ของเดิมถ้ามี
            keep = {k: v for k, v in (rows.get(s) or {}).items() if k not in p}
            rows[s] = {**keep, "s": s, **p}
            continue
        streak = 0
        rows[s] = {"s": s, "base": s in BASE, **p, **o}
        done += 1
        time.sleep(0.35)

    # as-of ของข้อมูลชุดนี้ = วันที่ของแท่งราคาล่าสุดในรายการหลัก
    as_of = max((r.get("t") or "" for r in rows.values() if r.get("base")), default=today.isoformat())
    is_live = as_of == today.isoformat() and is_trading_day(today) and ny.time() < CLOSE_DONE

    hist = load_json(IVH, {})
    if not is_live:
        fresh = {s: r["iv"] for s, r in rows.items() if r.get("iv") is not None and r.get("t") == as_of}
        hist = update_hist(hist, as_of, fresh)
        IVH.write_text(json.dumps(hist, separators=(",", ":")), encoding="utf-8")
    for s, r in rows.items():
        r["ivr"], r["ivp"], r["n"] = rank_of(hist, s, r.get("iv"))

    full_as_of = old.get("fullAsOf")
    if "--all" in sys.argv and not is_live and done >= len(syms) * 0.6:
        full_as_of = as_of
    data = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "asOf": as_of, "live": is_live, "fullAsOf": full_as_of, "r": R, "base": BASE,
        "vix": vix_block() or old.get("vix"),
        "rows": sorted(rows.values(), key=lambda r: (not r.get("base"), BASE.index(r["s"]) if r.get("base") else 0, r["s"])),
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"เขียน {OUT.name} แล้ว: ออปชั่นใหม่ {done} ตัว ไม่สำเร็จ {fails} ตัว ข้อมูล ณ {as_of}{' (ระหว่างวัน)' if is_live else ''} ใช้เวลา {int(time.time() - start)} วินาที")


if __name__ == "__main__":
    main()
