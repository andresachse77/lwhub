"""Regression: primary 1x pass alone vs. the 1x pass plus the conditional 2x rescue.

Every difference must be either a gap being filled (None -> value) or a card being moved to the group
header it actually sits under. A change from one badge to a *different* badge is only acceptable when
the primary pass had no badge on that header row at all.

Captures live in web-scanner/images/, which is gitignored, so this script is a no-op on a fresh clone.
"""
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image
import server

IMG = ROOT / "images"
files = sorted(IMG.glob("view-*.png"))
if not files:
    print(f"no captures in {IMG} (gitignored) - nothing to check")
    sys.exit(0)

changed, times, triggers = 0, [], 0

for f in files:
    img = Image.open(f).convert("RGB")
    lines = server.ocr_lines(img)
    mode = server.detect_mode(lines)
    before = server.build_rows(img, lines, mode)
    if not server.needs_rescue(lines, before, mode):
        continue
    triggers += 1
    t = time.time()
    rescue = server.shield_rescue(img, lines)
    times.append(time.time() - t)
    if not rescue:
        continue
    after = server.build_rows(img, lines, mode, rescue)
    for b, a in zip(before, after):
        if b.get("rank_code") != a.get("rank_code"):
            changed += 1
            print(f"{f.name} [{mode}] {b.get('name') or b.get('rank_position')}: "
                  f"{b.get('rank_code')} -> {a.get('rank_code')}")

print(f"\ntrigger fired on {triggers}/{len(files)} frames")
if times:
    print(f"rescue mean {statistics.mean(times):.2f}s")
print(f"changed {changed} rows")

print("\n--- targets ---")
for name in ("view-057.png", "view-050.png", "view-005.png", "view-011.png"):
    if not (IMG / name).exists():
        continue
    img = Image.open(IMG / name).convert("RGB")
    lines = server.ocr_lines(img)
    mode = server.detect_mode(lines)
    rows = server.build_rows(img, lines, mode, server.shield_rescue(img, lines))
    for r in rows:
        if "Rudi" in str(r.get("name")) or r.get("name") in (
                "CONANu littleBeast", "CONANu little Beast", "OberbefehlshaberTim"):
            print(f"{name} [{mode}] {r.get('name')}: rank_code={r.get('rank_code')}")
