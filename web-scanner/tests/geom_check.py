"""Geometry check for the frames where the two passes disagree.

Prints every badge and group-header counter by y, then the card anchors, so it is visible which header
a card actually sits under. Used to confirm that a card below a header whose shield the primary pass
missed must inherit that header's rank, not the rank of the group above it.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image
import server

IMG = ROOT / "images"

for name in ("view-005.png", "view-011.png"):
    if not (IMG / name).exists():
        continue
    img = Image.open(IMG / name).convert("RGB")
    l1 = server.ocr_lines(img)
    l2 = server.ocr_lines(img, 2)
    print(f"\n=== {name} ===")
    print("badges + fractions, sorted by y:")
    for l in sorted(l1 + l2, key=lambda x: x.cy):
        t = l.text.strip()
        if server.RANK_BADGE_RE.match(t) or server.FRACTION_RE.match(t):
            src = "1x" if any(abs(o.cy - l.cy) < 6 and abs(o.cx - l.cx) < 10 for o in l1) else "2x"
            print(f"  y={round(l.cy):4d} x={round(l.cx):3d} {src} {t}")
    print("cards (anchor y, name):")
    for c in server.group_cards(l1, [l for l in l2 if server.RANK_BADGE_RE.match(l.text.strip())]):
        if c.get("name"):
            print(f"  anchor y={round(c['anchor_y']):4d} rank={c['rank_code']} {c['name']}")
