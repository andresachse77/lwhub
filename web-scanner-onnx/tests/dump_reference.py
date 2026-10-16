"""Dump the Python server's results for local captures so parity.js can compare the JS port.

Reads web-scanner/images/view-*.png (gitignored, local only) and writes one JSON per frame to
tests/reference/ (also gitignored — the frames show real member data).
Run with:  py -3.12 dump_reference.py [view-001.png view-050.png ...]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCANNER = HERE.parent.parent / "web-scanner"
sys.path.insert(0, str(SCANNER))

from PIL import Image  # noqa: E402
import server  # noqa: E402

out_dir = HERE / "reference"
out_dir.mkdir(exist_ok=True)
names = sys.argv[1:] or sorted(p.name for p in (SCANNER / "images").glob("view-*.png"))

for name in names:
    img = Image.open(SCANNER / "images" / name).convert("RGB")
    lines = server.ocr_lines(img)
    mode = server.detect_mode(lines)
    rows = server.build_rows(img, lines, mode)
    rescue = []
    if server.needs_rescue(lines, rows, mode):
        rescue = server.shield_rescue(img, lines)
        if rescue:
            rows = server.build_rows(img, lines, mode, rescue)
    ref = {
        "lines": [vars(l) for l in lines],
        "rescue": [vars(l) for l in rescue],
        "mode": mode,
        "rows": rows,
    }
    (out_dir / (name + ".json")).write_text(json.dumps(ref, ensure_ascii=False, default=float), encoding="utf-8")
    print(f"{name}: {mode}, {len(lines)} lines, {len(rows)} rows, rescue={len(rescue)}")
