"""Print every line in the group-header band of the disagreeing frames.

Shows which label ("Leader", "Kriegsanfuhrer", "Ingenieure") each shield glyph belongs to, which is the
decisive evidence for the assignment the two passes disagree about.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image
import server

IMG = ROOT / "images"

for name, band in (("view-005.png", (620, 900)), ("view-011.png", (620, 1050))):
    if not (IMG / name).exists():
        continue
    img = Image.open(IMG / name).convert("RGB")
    print(f"\n=== {name} band y={band[0]}..{band[1]} ===")
    for src, lines in (("1x", server.ocr_lines(img)), ("2x", server.ocr_lines(img, 2))):
        print(f"-- {src} --")
        for l in sorted(lines, key=lambda x: x.cy):
            if band[0] <= l.cy <= band[1]:
                print(f"  y={round(l.cy):4d} x={round(l.cx):3d} {l.text.strip()!r} ({l.score:.2f})")
