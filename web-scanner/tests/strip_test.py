"""Full-image 2x rescue vs. a narrow strip around the badge column (speed + completeness).

Measured result: the strip recovers the same badges but is not faster, so the full-image pass is kept.
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

# Badge column observed on real captures: members mode x~80-120, ranking mode x~280-320.
STRIPS = {"members": (55, 145), "ranking": (250, 350), "unknown": (55, 350)}

full_t, strip_t = [], []
full_n, strip_n, agree, disagree = 0, 0, 0, []

for f in files:
    img = Image.open(f).convert("RGB")
    lines = server.ocr_lines(img)
    mode = server.detect_mode(lines)
    rows = server.build_rows(img, lines, mode)
    if not server.needs_rescue(lines, rows, mode):
        continue

    t = time.time()
    full = server.shield_rescue(img, lines)
    full_t.append(time.time() - t)

    x0, x1 = STRIPS.get(mode, STRIPS["unknown"])
    t = time.time()
    crop = img.crop((x0, 0, x1, img.height))
    strip = [l for l in server.ocr_lines(crop, 2)
             if server.RANK_BADGE_RE.match(l.text.strip()) and l.score >= server.SHIELD_MIN_SCORE]
    strip = [server.Line(l.text, l.score, l.left + x0, l.top, l.right + x0, l.bottom) for l in strip]
    strip_t.append(time.time() - t)

    full_n += len(full)
    strip_n += len(strip)
    for b in full:
        if any(s.text == b.text and abs(s.cy - b.cy) < 12 for s in strip):
            agree += 1
        else:
            disagree.append((f.name, mode, b.text, round(b.cy), round(b.score), b.left))

print(f"frames: {len(full_t)}")
print(f"full 2x pass:  mean {statistics.mean(full_t):.2f}s median {statistics.median(full_t):.2f}s "
      f"badges {full_n}")
print(f"strip 2x pass: mean {statistics.mean(strip_t):.2f}s median {statistics.median(strip_t):.2f}s "
      f"badges {strip_n}")
print(f"agree {agree}/{full_n}; missed by strip:")
for d in disagree:
    print("  ", d)
