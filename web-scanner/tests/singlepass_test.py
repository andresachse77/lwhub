"""Single always-on 2x pass vs. the shipped 1x + conditional rescue.

The always-on variant is cheaper per frame but changes assignments and flips mode detection on some
frames, which is why the conditional variant is kept. Run this to re-confirm the tradeoff.
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

diff, same = 0, 0
combo_t, single_t = [], []

for f in files:
    img = Image.open(f).convert("RGB")

    t = time.time()
    l1 = server.ocr_lines(img)
    m = server.detect_mode(l1)
    r1 = server.build_rows(img, l1, m)
    resc = server.shield_rescue(img, l1) if server.needs_rescue(l1, r1, m) else []
    combo = server.build_rows(img, l1, m, resc) if resc else r1
    combo_t.append(time.time() - t)

    t = time.time()
    l2 = server.ocr_lines(img, 2)
    m2 = server.detect_mode(l2)
    single = server.build_rows(img, l2, m2)
    single_t.append(time.time() - t)

    if m != m2:
        print(f"{f.name}: mode differs {m} vs {m2}")
    for a, b in zip(combo, single):
        if a.get("rank_code") == b.get("rank_code"):
            same += 1
        else:
            diff += 1
            print(f"{f.name} [{m}/{m2}] {a.get('name') or a.get('rank_position')}: "
                  f"combo={a.get('rank_code')} single2x={b.get('rank_code')}")

print(f"\nsame {same}, different {diff}")
print(f"combo mean {statistics.mean(combo_t):.2f}s  single2x mean {statistics.mean(single_t):.2f}s")
