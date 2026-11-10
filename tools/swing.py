"""สแกนสัญญาณเก็งกำไรระยะสั้นของหุ้น S&P 500 จากกราฟ 1 ชั่วโมง → docs/swing.json และ docs/swing-log.json

กติกาเดียวกับ src/swing-core.js (ฝั่งเว็บใช้กับคริปโต) แก้ที่หนึ่งต้องแก้อีกที่ด้วย
รันทุก 30 นาทีช่วงตลาดสหรัฐเปิด (.github/workflows/swing.yml) ถ้าตลาดปิดจะข้าม
รันเอง: python3 tools/swing.py --force
"""
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fresh import NY, OPEN, CLOSE_DONE, is_trading_day  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "swing.json"
LOG = ROOT / "docs" / "swing-log.json"


def ema(a, n):
    k, o, e = 2 / (n + 1), [], None
    for i, x in enumerate(a):
        e = x if i == 0 else x * k + e * (1 - k)
        o.append(e)
    return o


def rsi(c, n=14):
    o, g, l = [None] * len(c), 0.0, 0.0
    for i in range(1, len(c)):
        d = c[i] - c[i - 1]
        up, dn = max(d, 0), max(-d, 0)
        if i <= n:
            g += up / n
            l += dn / n
            if i == n:
                o[i] = 100 if l == 0 else 100 - 100 / (1 + g / l)
            continue
        g = (g * (n - 1) + up) / n
        l = (l * (n - 1) + dn) / n
        o[i] = 100 if l == 0 else 100 - 100 / (1 + g / l)
    return o


def atr(b, n=14):
    o, a = [None] * len(b), 0.0
    for i in range(1, len(b)):
        tr = max(b[i]["h"] - b[i]["l"], abs(b[i]["h"] - b[i - 1]["c"]), abs(b[i]["l"] - b[i - 1]["c"]))
        if i <= n:
            a += tr / n
            if i == n:
                o[i] = a
        else:
            a = (a * (n - 1) + tr) / n
            o[i] = a
    return o


def ind(b):
    c = [x["c"] for x in b]
    return {"e20": ema(c, 20), "e50": ema(c, 50), "rsi": rsi(c), "atr": atr(b)}


def jround(x):
    """ปัดแบบ Math.round ของ JS (ไม่ใช่ปัดเข้าเลขคู่แบบ Python)"""
    return math.floor(x + 0.5)


def clamp(x, a, z):
    return max(a, min(z, x))


def setup_at(b, I, i):
    if i < 60:
        return None
    x, A, r, e20, e50 = b[i], I["atr"][i], I["rsi"][i], I["e20"][i], I["e50"][i]
    if not A or r is None:
        return None
    if not (e20 > e50 and x["c"] > e50 and e50 > I["e50"][i - 5]):
        return None
    va = sum(b[k]["v"] for k in range(i - 20, i)) / 20
    vr = x["v"] / va if va > 0 else 1
    hh = max(b[k]["h"] for k in range(i - 20, i))
    lo = min(b[k]["l"] for k in range(i - 4, i + 1))
    touched = any(b[k]["l"] <= I["e20"][k] + 0.25 * I["atr"][k] for k in (i - 2, i - 1, i))
    kind = None
    if x["c"] > hh and vr >= 1.5 and r < 78 and x["c"] - x["l"] >= 0.6 * (x["h"] - x["l"]):
        kind = "brk"
    elif touched and x["c"] > e20 and x["c"] > x["o"] and x["c"] > b[i - 1]["c"] and 40 <= r <= 65 and r > I["rsi"][i - 1]:
        kind = "pb"
    if not kind:
        return None
    entry = x["c"]
    sl = min(entry - 0.8 * A, max(entry - 1.5 * A, lo - 0.1 * A))
    R = entry - sl
    strength = clamp((e20 - e50) / A, 0, 3) / 3
    rsi_fit = 1 - min(abs(r - 52) / 13, 1) if kind == "pb" else 1 - min(abs(r - 64) / 14, 1)
    vol_fit = clamp((vr - 0.8) / 1.7, 0, 1)
    room = (entry - sl) / A
    score = jround(100 * (0.35 * strength + 0.25 * rsi_fit + 0.25 * vol_fit + 0.15 * clamp(1.6 - room / 1.5, 0, 1)) + (5 if kind == "pb" else 0))
    return {"kind": kind, "t": x["t"], "entry": entry, "sl": sl, "tp1": entry + 1.5 * R, "tp2": entry + 3 * R, "R": R,
            "rsi": r, "atr": A, "vr": vr, "score": clamp(score, 0, 100)}


def scan(b, live=None):
    if not b or len(b) < 70:
        return None
    I = ind(b)
    n = len(b) - 1
    px = b[n]["c"] if live is None else live
    for i in range(n, n - 3, -1):
        s = setup_at(b, I, i)
        if not s:
            continue
        age = n - i
        hit = any(b[k]["l"] <= s["sl"] or b[k]["h"] >= s["tp1"] for k in range(i + 1, n + 1))
        if hit or px <= s["sl"] or px >= s["tp1"] or px > s["entry"] + 0.5 * s["R"]:
            return None
        s.update(age=age, price=px, score=max(0, s["score"] - age * 8 - jround(max(0, px - s["entry"]) / s["R"] * 20)))
        return s
    return None


def follow(s, later, max_bars=72):
    half, n = False, 0
    for x in later:
        n += 1
        if not half:
            if x["l"] <= s["sl"]:
                return {"done": True, "res": "sl", "r": -1, "bars": n}
            if x["h"] >= s["tp1"]:
                half = True
                if x["h"] >= s["tp2"]:
                    return {"done": True, "res": "tp2", "r": 2.25, "bars": n}
                continue
        else:
            if x["l"] <= s["entry"]:
                return {"done": True, "res": "be", "r": 0.75, "bars": n}
            if x["h"] >= s["tp2"]:
                return {"done": True, "res": "tp2", "r": 2.25, "bars": n}
        if n >= max_bars:
            r = (x["c"] - s["entry"]) / s["R"]
            return {"done": True, "res": "time", "r": 0.75 + r / 2 if half else r, "bars": n}
    return {"done": False, "half": half, "bars": n}


def sig4(x):
    return float(f"{x:.4g}") if abs(x) < 1000 else round(x, 2)


def bars_from(df, sym, now_ms):
    """แปลงข้อมูล yfinance เป็นแท่งที่ปิดแล้ว + ราคาล่าสุด (แท่งที่ยังไม่ปิดใช้เป็นราคาสด)"""
    try:
        sub = df.xs(sym, axis=1, level=1) if hasattr(df.columns, "levels") else df
    except KeyError:
        return [], None
    sub = sub.dropna(subset=["Close"])
    out = []
    for ts, row in sub.iterrows():
        t = int(ts.timestamp() * 1000)
        out.append({"t": t, "o": float(row["Open"]), "h": float(row["High"]), "l": float(row["Low"]), "c": float(row["Close"]), "v": float(row["Volume"] or 0)})
    live = None
    # แท่งสุดท้ายของวันเริ่ม 15:30 น. นิวยอร์ก ยาวแค่ 30 นาที
    if out and out[-1]["t"] + (1800_000 if datetime.fromtimestamp(out[-1]["t"] / 1000, NY).strftime("%H:%M") == "15:30" else 3600_000) > now_ms:
        live = out.pop()["c"]
    return out, live


def main():
    now = datetime.now(timezone.utc)
    ny = now.astimezone(NY)
    if "--force" not in sys.argv and not (is_trading_day(ny.date()) and OPEN <= ny.time() <= CLOSE_DONE):
        print("ตลาดสหรัฐไม่ได้เปิด ข้าม")
        return 0
    import yfinance as yf

    data = json.loads((ROOT / "docs" / "data.json").read_text(encoding="utf-8"))
    syms = [s["symbol"] for s in data["stocks"]]
    ymap = {s: s.replace(".", "-") for s in syms}
    now_ms = int(now.timestamp() * 1000)
    allbars = {}
    for k in range(0, len(syms), 100):
        chunk = [ymap[s] for s in syms[k:k + 100]]
        try:
            df = yf.download(chunk, period="30d", interval="60m", auto_adjust=False, progress=False, threads=True, group_by="column")
        except Exception as e:  # noqa: BLE001
            print("ดึงไม่สำเร็จ", e)
            continue
        if df is None or df.empty:
            continue
        for s in syms[k:k + 100]:
            b, live = bars_from(df, ymap[s], now_ms)
            if len(b) >= 70:
                allbars[s] = (b, live)
    print(f"ได้กราฟ 1 ชม. {len(allbars)} ตัว")
    if len(allbars) < 100:
        print("ได้ข้อมูลน้อยเกินไป ไม่เขียนทับ")
        return 0

    sigs, px = [], {}
    for s, (b, live) in allbars.items():
        I = ind(b)
        p = live if live is not None else b[-1]["c"]
        px[s] = [sig4(p), sig4(I["e20"][-1])]
        r = scan(b, live)
        if r:
            sigs.append({"s": s, **{k: (sig4(v) if isinstance(v, float) else v) for k, v in r.items()}})
    sigs.sort(key=lambda x: -x["score"])

    # บันทึกผลสัญญาณย้อนหลัง: จดสัญญาณใหม่ แล้วตามดูว่าชนเป้าหรือจุดตัดขาดทุน
    try:
        log = json.loads(LOG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        log = []
    seen = {(x["s"], x["t"]) for x in log}
    for g in sigs:
        if (g["s"], g["t"]) not in seen:
            log.append({k: g[k] for k in ("s", "kind", "t", "entry", "sl", "tp1", "tp2", "R", "score")})
    for x in log:
        if x.get("res") or x["s"] not in allbars:
            continue
        later = [y for y in allbars[x["s"]][0] if y["t"] > x["t"]]
        f = follow(x, later)
        if f["done"]:
            x.update(res=f["res"], r=round(f["r"], 2), bars=f["bars"])
        elif x["t"] < now_ms - 20 * 86400_000:
            x.update(res="old", r=0, bars=f["bars"])
    log = log[-400:]

    last_t = max(b[-1]["t"] for b, _ in allbars.values())
    OUT.write_text(json.dumps({"updated": now.isoformat(timespec="seconds"), "asOf": last_t, "open": is_trading_day(ny.date()) and OPEN <= ny.time() < CLOSE_DONE,
                               "n": len(allbars), "sig": sigs[:30], "px": px}, separators=(",", ":")), encoding="utf-8")
    LOG.write_text(json.dumps(log, separators=(",", ":")), encoding="utf-8")
    print(f"สัญญาณ {len(sigs)} ตัว · บันทึก {len(log)} รายการ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
