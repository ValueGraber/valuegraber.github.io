"""Build docs/index.html from src/template.html + src/calcs.js (the /*CALCS*/ placeholder)."""
from pathlib import Path
R = Path(__file__).resolve().parent.parent
t = (R / "src/template.html").read_text(encoding="utf-8")
c = (R / "src/calcs.js").read_text(encoding="utf-8")
assert "/*CALCS*/" in t
for k, f in (("/*SPOTCORE*/", "spot-core.js"), ("/*SPOT*/", "spot.js"), ("/*TRADE*/", "trade.js")):
    assert k in t
    t = t.replace(k, (R / "src" / f).read_text(encoding="utf-8").replace("if (typeof module !== 'undefined') module.exports = SPC;", ""))
import hashlib, json
out = t.replace("/*CALCS*/", c)
ver = hashlib.sha1(out.encode("utf-8")).hexdigest()[:10]
assert "/*BUILD*/" in out
(R / "docs/index.html").write_text(out.replace("/*BUILD*/", ver), encoding="utf-8")
(R / "docs/version.json").write_text(json.dumps({"v": ver}), encoding="utf-8")
print("built docs/index.html", len(t) // 1024, "KB template")
