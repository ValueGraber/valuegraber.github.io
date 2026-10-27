"""
สแกนหุ้น S&P 500 แบบ VI — ดึงราคาปิดและตัวเลขพื้นฐานจาก Yahoo Finance (ผ่าน yfinance)
แล้วเขียนไฟล์ docs/data.json ให้หน้าเว็บ docs/index.html อ่าน

รันเองได้ด้วย:  python scanner.py
GitHub Actions จะรันให้อัตโนมัติทุกวันหลังตลาดสหรัฐปิด (ดู .github/workflows/update.yml)
"""
import io
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).parent
OUT = ROOT / "docs" / "data.json"
HIST = ROOT / "docs" / "history.json"
PREV = ROOT / "docs" / "prev.json"
CONSTITUENTS_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
SECTOR_TH = {
    "Information Technology": "เทคโนโลยี", "Health Care": "สุขภาพ", "Financials": "การเงิน",
    "Consumer Discretionary": "สินค้าฟุ่มเฟือย", "Communication Services": "สื่อสาร",
    "Industrials": "อุตสาหกรรม", "Consumer Staples": "สินค้าจำเป็น", "Energy": "พลังงาน",
    "Utilities": "สาธารณูปโภค", "Real Estate": "อสังหาฯ", "Materials": "วัตถุดิบ",
}
RATING = {"strong_buy": "Strong Buy", "buy": "Buy", "hold": "Hold", "underperform": "Sell", "sell": "Sell", "strong_sell": "Strong Sell"}


def log(*a):
    print(*a, flush=True)


def num(x):
    try:
        v = float(x)
        return None if math.isnan(v) or math.isinf(v) else v
    except (TypeError, ValueError):
        return None


def rnd(x, d=2):
    v = num(x)
    return None if v is None else round(v, d)


def load_previous():
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log("อ่านไฟล์เก่าไม่ได้:", e)
    return {}


def load_universe(prev_rows):
    """รายชื่อหุ้น S&P 500 ล่าสุด ถ้าดึงไม่ได้ใช้รายชื่อจากรอบก่อน"""
    try:
        r = requests.get(CONSTITUENTS_URL, timeout=30)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        uni = [
            {"symbol": s, "name": n, "sector": SECTOR_TH.get(sec, sec)}
            for s, n, sec in zip(df["Symbol"], df["Security"], df["GICS Sector"])
            if s not in ("GOOG", "FOX", "NWS")  # ตัดหุ้นซ้ำคลาส
        ]
        if len(uni) > 400:
            return uni
    except Exception as e:  # noqa: BLE001
        log("ดึงรายชื่อ S&P 500 ไม่ได้ ใช้รายชื่อเดิม:", e)
    return [{"symbol": r["symbol"], "name": r.get("name"), "sector": r.get("sector")} for r in prev_rows]


def yahoo(sym):
    return sym.replace(".", "-")


def rsi14(close):
    d = close.diff().dropna()
    if len(d) < 15:
        return None
    gain = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean().iloc[-1]
    loss = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean().iloc[-1]
    if loss == 0:
        return 100.0
    return 100 - 100 / (1 + gain / loss)


def price_stats(symbols):
    """ราคาปิดย้อนหลัง 1 ปีของทุกตัวในครั้งเดียว → ราคา, MA50, MA200, RSI, เปลี่ยนแปลง 52 สัปดาห์"""
    out = {}
    tick = [yahoo(s) for s in symbols]
    for i in range(0, len(tick), 100):
        chunk = tick[i:i + 100]
        for attempt in range(3):
            try:
                df = yf.download(chunk, period="1y", interval="1d", auto_adjust=False, progress=False, threads=True, group_by="column")
                close = df["Close"] if isinstance(df.columns, pd.MultiIndex) else df[["Close"]].rename(columns={"Close": chunk[0]})
                break
            except Exception as e:  # noqa: BLE001
                log(f"ดึงราคาชุด {i} ไม่สำเร็จ (ครั้งที่ {attempt + 1}):", e)
                time.sleep(10)
        else:
            continue
        for t in chunk:
            if t not in close:
                continue
            c = close[t].dropna()
            if len(c) < 30:
                continue
            out[t] = {
                "price": rnd(c.iloc[-1]),
                "asOf": c.index[-1].strftime("%Y-%m-%d"),
                "ma50": rnd(c.tail(50).mean()),
                "ma200": rnd(c.tail(200).mean()),
                "rsi": rnd(rsi14(c)),
                "change52w": rnd((c.iloc[-1] / c.iloc[0] - 1) * 100),
            }
        time.sleep(2)
    return out


def ymd(ts):
    """วินาที epoch จาก Yahoo → YYYY-MM-DD (UTC)"""
    try:
        return datetime.fromtimestamp(int(ts), timezone.utc).strftime("%Y-%m-%d") if ts else None
    except (TypeError, ValueError, OSError):
        return None


def fundamentals(sym):
    """ตัวเลขพื้นฐานของหุ้นหนึ่งตัว (หน่วยเป็น % ให้ตรงกับหน้าเว็บ)"""
    info = None
    for attempt in range(3):
        try:
            info = yf.Ticker(yahoo(sym)).info
            if info and (info.get("marketCap") or info.get("trailingPE") or info.get("forwardPE")):
                break
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                log(f"  {sym}: ดึงงบไม่ได้ ({e})")
        time.sleep(3 * (attempt + 1))
    if not info:
        return {}
    mcap = num(info.get("marketCap"))
    fcf = num(info.get("freeCashflow"))
    rev = num(info.get("totalRevenue"))
    teps = num(info.get("trailingEps"))
    feps = num(info.get("forwardEps"))
    de = num(info.get("debtToEquity"))
    pct = lambda k: None if num(info.get(k)) is None else round(num(info.get(k)) * 100, 2)  # noqa: E731
    return {
        "marketCapB": rnd(mcap / 1e9) if mcap else None,
        "pe": rnd(info.get("trailingPE")),
        "forwardPe": rnd(info.get("forwardPE")),
        "peg": rnd(info.get("trailingPegRatio") or info.get("pegRatio")),
        "pb": rnd(info.get("priceToBook")),
        "pfcf": rnd(mcap / fcf) if mcap and fcf and fcf > 0 else None,
        "roe": pct("returnOnEquity"),
        "roic": pct("returnOnAssets"),  # Yahoo ไม่มี ROIC ใช้ ROA แทน
        "netMargin": pct("profitMargins"),
        "fcfMargin": rnd(fcf / rev * 100) if fcf and rev else None,
        "debtToEquity": rnd(de / 100) if de is not None else None,
        "epsTtm": rnd(teps),
        "dividendYield": pct("trailingAnnualDividendYield"),
        "beta": rnd(info.get("beta")),
        "analystTarget": rnd(info.get("targetMeanPrice")),
        "analystRating": RATING.get(info.get("recommendationKey")),
        "epsGrowth3y": rnd((feps / teps - 1) * 100) if feps and teps and teps > 0 else None,
        "revenueGrowth3y": pct("revenueGrowth"),
        "exDivDate": ymd(info.get("exDividendDate")),
        "earningsDate": ymd(info.get("earningsTimestampStart") or info.get("earningsTimestamp")),
        "lastDiv": rnd(info.get("lastDividendValue"), 4),
    }


def market_series():
    spy, yld = [], []
    try:
        w = yf.download("SPY", period="3y", interval="1wk", auto_adjust=False, progress=False)["Close"].dropna()
        w = w.iloc[:, 0] if isinstance(w, pd.DataFrame) else w
        spy = [{"date": d.strftime("%Y-%m-%d"), "close": round(float(v), 2)} for d, v in w.items()]
    except Exception as e:  # noqa: BLE001
        log("ดึง SPY ไม่ได้:", e)
    try:
        t = yf.download("^TNX", period="15mo", interval="1d", auto_adjust=False, progress=False)["Close"].dropna()
        t = t.iloc[:, 0] if isinstance(t, pd.DataFrame) else t
        yld = [{"date": d.strftime("%Y-%m-%d"), "yield10y": round(float(v), 3)} for d, v in t.items()]
    except Exception as e:  # noqa: BLE001
        log("ดึงดอกเบี้ย 10 ปีไม่ได้:", e)
    return spy, yld


def gold_usd():
    """ราคาทองคำตลาดโลก (ดอลลาร์ต่อออนซ์) ใช้ประมาณราคาทองไทยในหน้าเงินของฉัน"""
    try:
        t = yf.download("GC=F", period="10d", interval="1d", auto_adjust=False, progress=False)["Close"].dropna()
        t = t.iloc[:, 0] if isinstance(t, pd.DataFrame) else t
        return round(float(t.iloc[-1]), 2)
    except Exception as e:  # noqa: BLE001
        log("ดึงราคาทองไม่ได้:", e)
        return None


def usd_thb():
    """อัตราแลกเปลี่ยนดอลลาร์เป็นบาท ใช้แปลงมูลค่าพอร์ตเป็นเงินบาท"""
    try:
        t = yf.download("THB=X", period="10d", interval="1d", auto_adjust=False, progress=False)["Close"].dropna()
        t = t.iloc[:, 0] if isinstance(t, pd.DataFrame) else t
        return round(float(t.iloc[-1]), 4)
    except Exception as e:  # noqa: BLE001
        log("ดึงอัตราแลกเปลี่ยนไม่ได้:", e)
        return None


def weekly_history(symbols):
    """ราคาปิดรายสัปดาห์ย้อนหลัง 2 ปี ใช้วาดกราฟการเติบโตของพอร์ตในหน้าเว็บ"""
    tick = {yahoo(s): s for s in symbols}
    tick["SPY"] = "SPY"
    cols = {}
    names = list(tick)
    for i in range(0, len(names), 100):
        chunk = names[i:i + 100]
        for attempt in range(3):
            try:
                df = yf.download(chunk, period="2y", interval="1wk", auto_adjust=False, progress=False, threads=True, group_by="column")
                close = df["Close"] if isinstance(df.columns, pd.MultiIndex) else df[["Close"]].rename(columns={"Close": chunk[0]})
                for t in chunk:
                    if t in close and close[t].notna().sum() > 4:
                        cols[t] = close[t]
                break
            except Exception as e:  # noqa: BLE001
                log(f"ดึงราคารายสัปดาห์ชุด {i} ไม่สำเร็จ (ครั้งที่ {attempt + 1}):", e)
                time.sleep(10)
        time.sleep(2)
    if "SPY" not in cols or len(cols) < 300:
        log(f"ราคารายสัปดาห์ได้ {len(cols)} ตัว น้อยเกินไป ไม่เขียนทับ history.json")
        return None
    frame = pd.DataFrame(cols).sort_index()
    frame = frame[~frame.index.duplicated(keep="last")]
    fix = lambda v: None if pd.isna(v) else round(float(v), 2)  # noqa: E731
    return {
        "dates": [d.strftime("%Y-%m-%d") for d in frame.index],
        "spy": [fix(v) for v in frame["SPY"]],
        "closes": {tick[t]: [fix(v) for v in frame[t]] for t in frame.columns if t != "SPY"},
    }


def main():
    prev = load_previous()
    prev_rows = {r["symbol"]: r for r in prev.get("stocks", [])}
    uni = load_universe(list(prev_rows.values()))
    symbols = [u["symbol"] for u in uni]
    log(f"หุ้นทั้งหมด {len(symbols)} ตัว")

    prices = price_stats(symbols)
    log(f"ได้ราคา {len(prices)} ตัว")

    rows, ok_f = [], 0
    for i, u in enumerate(uni):
        s = u["symbol"]
        row = dict(prev_rows.get(s, {}))  # เริ่มจากค่าเดิม ถ้ารอบนี้ดึงไม่ได้จะยังมีข้อมูลเก่าอยู่
        row.update({k: v for k, v in u.items() if v})
        row.update({k: v for k, v in prices.get(yahoo(s), {}).items() if v is not None})
        f = fundamentals(s)
        if f:
            ok_f += 1
            row.update({k: v for k, v in f.items() if v is not None})
        if row.get("price"):
            rows.append(row)
        if (i + 1) % 50 == 0:
            log(f"  งบ {i + 1}/{len(uni)} (สำเร็จ {ok_f})")
        time.sleep(0.4)
    log(f"ได้งบ {ok_f}/{len(uni)} ตัว")

    spy, yld = market_series()
    data = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "asOf": max((p["asOf"] for p in prices.values()), default=prev.get("asOf")),
        "fundamentalsOk": ok_f,
        "stocks": rows,
        "spy": spy or prev.get("spy", []),
        "yield": yld or prev.get("yield", []),
        "usdthb": usd_thb() or prev.get("usdthb"),
        "gold": gold_usd() or prev.get("gold"),
    }
    if len(prices) < 300:
        log("ราคาได้น้อยผิดปกติ ไม่เขียนทับไฟล์เดิม")
        sys.exit(1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    try:  # เก็บข้อมูลวันก่อนไว้ให้หน้าเว็บสรุปว่าวันนี้อะไรเปลี่ยน
        old = OUT.read_text(encoding="utf-8")
        if json.loads(old).get("asOf") != data["asOf"]:
            PREV.write_text(old, encoding="utf-8")
    except (OSError, ValueError):
        pass
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"เขียน {OUT} แล้ว ({len(rows)} ตัว ราคา ณ {data['asOf']})")

    hist = weekly_history([r["symbol"] for r in rows])
    if hist:
        HIST.write_text(json.dumps(hist, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        log(f"เขียน {HIST} แล้ว ({len(hist['closes'])} ตัว {len(hist['dates'])} สัปดาห์)")


if __name__ == "__main__":
    main()
