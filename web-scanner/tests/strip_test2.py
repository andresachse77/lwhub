"""Strip vs. full 2x pass, deduplicated against the primary pass the way shield_rescue does."""
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

STRIPS = {"members": (55, 145), "ranking": (250, 350), "unknown": (55, 350)}


def dedupe(found, already):
    out = []
    for l in found:
        if any(abs(o.cy - l.cy) < 12 and abs(o.cx - l.cx) < 25 for o in already):
            continue
        if any(abs(o.cy - l.cy) < 12 and abs(o.cx - l.cx) < 25 for o in out):
            continue
        out.append(l)
    return out


full_t, strip_t, extras = [], [], []
full_n, strip_n = 0, 0

for f in files:
    img = Image.open(f).convert("RGB")
    lines = server.ocr_lines(img)
    mode = server.detect_mode(lines)
    rows = server.build_rows(img, lines, mode)
    if not server.needs_rescue(lines, rows, mode):
        continue
    already = [l for l in lines if server.RANK_BADGE_RE.match(l.text.strip())]

    t = time.time()
    full = dedupe(server.shield_rescue(img, lines), already)
    full_t.append(time.time() - t)

    x0, x1 = STRIPS.get(mode, STRIPS["unknown"])
    t = time.time()
    crop = img.crop((x0, 0, x1, img.height))
    raw = [server.Line(l.text, l.score, l.left + x0, l.top, l.right + x0, l.bottom)
           for l in server.ocr_lines(crop, 2)
           if server.RANK_BADGE_RE.match(l.text.strip()) and l.score >= server.SHIELD_MIN_SCORE]
    strip = dedupe(raw, already)
    strip_t.append(time.time() - t)

    full_n += len(full)
    strip_n += len(strip)
    for b in strip:
        if not any(abs(s.cy - b.cy) < 12 and abs(s.cx - b.cx) < 25 for s in full):
            extras.append((f.name, mode, b.text, round(b.cy), round(b.score), round(b.left)))

print(f"frames: {len(full_t)}")
print(f"full:  mean {statistics.mean(full_t):.2f}s median {statistics.median(full_t):.2f}s "
      f"new badges {full_n}")
print(f"strip: mean {statistics.mean(strip_t):.2f}s median {statistics.median(strip_t):.2f}s "
      f"new badges {strip_n}")
print(f"strip-only extras ({len(extras)}):")
for e in extras[:25]:
    print("  ", e)
