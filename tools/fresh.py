"""เช็กว่า docs/data.json มีราคาปิดของวันซื้อขายล่าสุดของตลาดสหรัฐแล้วหรือยัง

ใช้ในงานอัปเดตอัตโนมัติ ซึ่งรันทุก 30 นาทีช่วงเช้า ถ้ามีราคาล่าสุดแล้วจะเขียน skip=true
ลงใน GITHUB_OUTPUT เพื่อให้ขั้นตอนดึงข้อมูลข้ามไป (จบภายในไม่กี่วินาที)
รันเองได้: python3 tools/fresh.py  (ใส่ --now 2026-11-03T05:30+07:00 เพื่อลองเวลาอื่น)
--live ใช้กับรอบคืนวันจันทร์ (เวลาไทย) ตอนตลาดสหรัฐเปิดอยู่ ดึงราคาระหว่างวันครั้งเดียว
ถ้าตลาดไม่ได้เปิด (เช่นวันหยุด) หรือได้ราคาระหว่างวันของวันนี้แล้ว จะข้าม
ใช้แค่ไลบรารีมาตรฐานของ Python
"""
import json
import os
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
# วันหยุดตลาดหุ้นนิวยอร์ก (NYSE) ปีที่ไม่อยู่ในรายการนี้จะนับแค่เสาร์อาทิตย์เป็นวันหยุด
HOLIDAYS = {
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03",
    "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
    "2027-09-06", "2027-11-25", "2027-12-24",
}
OPEN = time(9, 30)
CLOSE = time(16, 0)
CLOSE_DONE = time(16, 30)  # ตลาดปิด 16:00 น. เวลานิวยอร์ก เผื่อเวลาให้ราคาปิดเข้าระบบ 30 นาที


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d.isoformat() not in HOLIDAYS


def last_trading_day(now: datetime) -> date:
    """วันซื้อขายล่าสุดที่ปิดตลาดไปแล้ว ณ เวลา now"""
    ny = now.astimezone(NY)
    d = ny.date()
    if not (is_trading_day(d) and ny.time() >= CLOSE_DONE):
        d -= timedelta(days=1)
        while not is_trading_day(d):
            d -= timedelta(days=1)
    return d


def main() -> int:
    now = datetime.now(NY)
    if "--now" in sys.argv:
        now = datetime.fromisoformat(sys.argv[sys.argv.index("--now") + 1])
    try:
        cur = json.loads(Path("docs/data.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cur = {}
    have, live = cur.get("asOf") or "", bool(cur.get("live"))
    ny = now.astimezone(NY)
    market_open = is_trading_day(ny.date()) and OPEN <= ny.time() < CLOSE
    if "--live" in sys.argv or ("--auto" in sys.argv and market_open):
        today = ny.date().isoformat()
        skip = not market_open or (have == today and live)
        why = "ตลาดไม่ได้เปิด ข้าม" if not market_open else ("มีราคาระหว่างวันแล้ว ข้าม" if skip else "ตลาดเปิดอยู่ ดึงราคาระหว่างวัน")
        print(f"รอบระหว่างวัน {today} · ในไฟล์ตอนนี้ {have or '-'}{' (ระหว่างวัน)' if live else ''} · {why}")
    else:
        want = last_trading_day(now).isoformat()
        skip = have >= want and not live  # ราคาระหว่างวันยังไม่ใช่ราคาปิด ต้องดึงใหม่
        print(f"ราคาปิดล่าสุดที่ควรมี {want} · ในไฟล์ตอนนี้ {have or '-'}{' (ระหว่างวัน)' if live else ''} · {'มีแล้ว ข้ามรอบนี้' if skip else 'ยังไม่มี ดึงข้อมูลใหม่'}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"skip={'true' if skip else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
