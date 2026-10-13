"""Quality and cost of the rescue pass: how often the trigger fires and how good the recovered badges are."""
import sys
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

scores, needed = [], 0

for f in files:
    img = Image.open(f).convert("RGB")
    lines = server.ocr_lines(img)
    mode = server.detect_mode(lines)
    rows = server.build_rows(img, lines, mode)
    if not server.needs_rescue(lines, rows, mode):
        continue
    needed += 1
    found = server.shield_rescue(img, lines)
    scores.extend(l.score for l in found)

print(f"frames where the trigger fires: {needed}/{len(files)}")
if scores:
    print(f"rescue badge scores: min={min(scores):.2f}  below 0.9: "
          f"{sum(1 for s in scores if s < 0.9)}  total={len(scores)}")
    for s in sorted(scores)[:10]:
        print(f"  low: {s:.2f}")
