"""End-to-end check through the /process endpoint for the frames that started this change.

save_capture is patched out so the run does not write into the gitignored captures/ folder.
"""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
import server

server.save_capture = lambda raw, label: "skipped"
client = TestClient(server.app)
IMG = ROOT / "images"

TARGETS = {
    "view-057.png": ("InfernoRudi", 1),
    "view-050.png": ("InfernoRudi", 1),
    "view-005.png": ("CONANu littleBeast", 3),
    "view-011.png": ("OberbefehlshaberTim", 2),
}

failures = 0
for name, (who, expected) in TARGETS.items():
    if not (IMG / name).exists():
        print(f"{name}: capture missing, skipped")
        continue
    t = time.time()
    d = client.post("/process", files={"file": (name, open(IMG / name, "rb").read(), "image/png")}).json()
    rows = d["rankings"] or d["cards"]
    got = next((r.get("rank_code") for r in rows if who in str(r.get("name"))), None)
    ok = got == expected
    failures += 0 if ok else 1
    print(f"{name} mode={d['mode']} {time.time() - t:.2f}s {who} -> {got} "
          f"(expected {expected}) {'OK' if ok else 'FAIL'}")
    print(f"  all codes: {[r.get('rank_code') for r in rows]}")

sys.exit(1 if failures else 0)
