"""
Local OCR server for the LWHub card-review prototype.
Runs RapidOCR (ONNX port of PaddleOCR's detection+recognition models) on a full
member-list screenshot, then groups the individually detected text lines into
per-member "cards" (name / combat values / status) using their positions —
no hand-tuned crop rectangles needed, unlike the earlier Tesseract approach.

100% local: the image never leaves this machine. Intended to run next to (or
be folded into) the existing PHP backend once this becomes a real server.
"""
import io
import re
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

engine = RapidOCR()

# Every processed frame is saved here (local disk only, never sent anywhere) so that a grouping/
# parsing bug fix can be re-run against the last real capture session instead of asking for a
# fresh scan every time. Never auto-deleted; clear it by hand if it grows too large.
CAPTURES_DIR = Path(__file__).parent / "captures"
CAPTURES_DIR.mkdir(exist_ok=True)

KAMPF_RE = re.compile(r"k[ae]mp", re.IGNORECASE)
HEADER_RE = re.compile(
    r"^(leader|ingenieure?|soldat(en)?|offizier(e)?|rookie|verwalter|rekrutierer|muse"
    r"|kriegsherr|kriegsanf[uü]hrer|kriegsf[uü]hrer"
    r"|mitglieder\s*suchen|mitgliederliste)$",
    re.IGNORECASE,
)
# Rank-group headers always carry an "N/M" member counter (e.g. "3/10", "14/68") right next to the
# label — this is a far more reliable signature than trying to enumerate every possible header word,
# since the label text itself OCRs inconsistently ("Kriegsherr" vs "Kriegsanfuhrer" vs whatever else).
FRACTION_RE = re.compile(r"^[0-9]{1,3}\s*/\s*[0-9]{1,3}$")
POWER_RE = re.compile(r"([0-9]{2,4}[.,]?[0-9]{0,2})\s*M", re.IGNORECASE)
LEVEL_RE = re.compile(r"Lv\.?\s*([0-9]{1,2})", re.IGNORECASE)
MEMBERS_HEADER_RE = re.compile(r"mitgliederliste", re.IGNORECASE)
RANKING_HEADER_RE = re.compile(r"st[äa]rke[\s-]*rangliste|rangliste", re.IGNORECASE)
RANK_BADGE_RE = re.compile(r"^R[1-5]$")
# Column headers ("Rang", "Kommandant", "Kampfkraft") and transient popup toasts ("...Geschenk
# erhalten!") sometimes land close enough to a real row to get grabbed as its name.
RANKING_NOISE_RE = re.compile(r"^(rang|kommandant|kampfkraft)$|geschenk|erhalten|!$", re.IGNORECASE)
RANK_POSITION_RE = re.compile(r"^[0-9]{1,3}$")
RAW_POWER_RE = re.compile(r"^[0-9]{5,}$")
# Every member row has a small gender-icon glyph immediately left of the name; RapidOCR occasionally
# fuses it into the name text as a stray leading "O"/"o". A real name essentially never starts with a
# bare O directly glued (no space) to another capital letter, so this is a safe, narrow strip.
GENDER_ICON_PREFIX_RE = re.compile(r"^[Oo](?=[A-ZÄÖÜ])")


def clean_name(text: str) -> str:
    return GENDER_ICON_PREFIX_RE.sub("", text.strip())


@dataclass
class Line:
    text: str
    score: float
    left: float
    top: float
    right: float
    bottom: float

    @property
    def cx(self):
        return (self.left + self.right) / 2

    @property
    def cy(self):
        return (self.top + self.bottom) / 2

    @property
    def height(self):
        return self.bottom - self.top


def to_line(box, text, score) -> Line:
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    return Line(text=text, score=float(score), left=min(xs), top=min(ys), right=max(xs), bottom=max(ys))


def detect_mode(lines: list[Line]) -> str:
    texts = " ".join(l.text for l in lines)
    if RANKING_HEADER_RE.search(texts):
        return "ranking"
    # The title text OCRs unreliably ("Rangliste" misread as "Ranaliste", etc.), so fall back to a
    # structural signal instead: the "Kampfkraft / Kills / Spende" tab bar is unique to the ranking
    # screen and, being three short common words, is much less likely to all get misread at once than
    # one longer, rarer word like "Rangliste" is.
    exact_texts = {l.text.strip().lower() for l in lines}
    if {"kills", "spende"} <= exact_texts:
        return "ranking"
    if MEMBERS_HEADER_RE.search(texts):
        return "members"
    return "unknown"


def find_leader_card(lines: list[Line]):
    """The alliance leader (R5) is shown only once, in the featured-leader banner at the top of the
    member list — never as a normal scrollable row with its own "Kampfkraft:" line, so group_cards()
    never finds them. Every members-mode screenshot shows this banner, so this runs on every frame;
    duplicates across frames collapse the same way regular member duplicates already do downstream."""
    badge = next((l for l in lines if l.text.strip() == "R5"), None)
    if badge is None:
        return None
    # The banner shows "R5  <name>" side by side on the same row, not stacked — unlike a regular
    # member card's name (which sits in the line above the Kampfkraft anchor).
    name_candidates = [
        l for l in lines
        if l is not badge
        and abs(l.cy - badge.cy) < badge.height * 1.5
        and l.left > badge.right
    ]
    if not name_candidates:
        return None
    name_line = min(name_candidates, key=lambda l: l.left)
    return {
        "anchor_y": badge.top,
        "name": clean_name(name_line.text),
        "values_text": "",
        "status": "R5 (Anführer-Banner)",
        "power": None,
        "level": None,
        "confidence": {"name": name_line.score, "values": None, "status": None},
        "box": {
            "left": min(badge.left, name_line.left) - 10,
            "top": badge.top - 10,
            "right": max(badge.right, name_line.right) + 10,
            "bottom": name_line.bottom + 10,
        },
        "name_box": vars(name_line),
        "values_box": None,
        "status_box": None,
    }


def group_ranking_rows(lines: list[Line]):
    """The Stärke-Rangliste (strength leaderboard) is a completely different layout: no "Kampfkraft:"
    label per row at all, just a row position number, a rank-group badge (R2/R3/R4), a name, and a bare
    integer combat-power number (no "M" suffix, no level, no status).

    Anchor on the power number, not the badge: the badge is a small icon-like glyph that occasionally
    fails to OCR at all for a given row (confirmed on real data — rank #70 had a perfectly readable
    position/name/power but no recognizable badge text, so badge-anchoring silently dropped the whole
    row). The power number is a long, distinctively-formatted integer present on every row, making it
    the far more reliable anchor — the badge is now optional decoration on the row, not required."""
    anchors = [l for l in lines if RAW_POWER_RE.match(l.text.strip())]
    rows = []
    for anchor in anchors:
        row_height = max(anchor.height * 2.5, 1)

        badge_candidates = [
            l for l in lines
            if RANK_BADGE_RE.match(l.text.strip())
            and abs(l.cy - anchor.cy) < row_height * 0.6
            and l.right < anchor.left
        ]
        badge_line = max(badge_candidates, key=lambda l: l.left) if badge_candidates else None

        position_candidates = [
            l for l in lines
            if l is not anchor
            and RANK_POSITION_RE.match(l.text.strip())
            and abs(l.cy - anchor.cy) < row_height * 0.6
            and l.right < anchor.left
            and (badge_line is None or l.right < badge_line.left)
        ]
        position_line = max(position_candidates, key=lambda l: l.left) if position_candidates else None

        name_candidates = [
            l for l in lines
            if l is not anchor and l is not badge_line and l is not position_line
            and abs(l.cy - anchor.cy) < row_height * 0.6
            and l.left < anchor.left
            and not RANK_POSITION_RE.match(l.text.strip())
            and not RANK_BADGE_RE.match(l.text.strip())
            and not RANKING_NOISE_RE.search(l.text.strip())
        ]
        name_line = max(name_candidates, key=lambda l: l.left) if name_candidates else None

        row_box_lines = [anchor, badge_line, name_line, position_line]
        rows.append({
            "anchor_y": anchor.top,
            "rank_position": (position_line.text.strip() if position_line else None),
            "rank_badge": (badge_line.text.strip() if badge_line else None),
            "name": (clean_name(name_line.text) if name_line else ""),
            "power": anchor.text.strip(),
            "confidence": {
                "name": name_line.score if name_line else None,
                "power": anchor.score,
            },
            "box": {
                "left": min(x.left for x in row_box_lines if x) - 10,
                "top": min(x.top for x in row_box_lines if x) - 6,
                "right": max(x.right for x in row_box_lines if x) + 10,
                "bottom": max(x.bottom for x in row_box_lines if x) + 6,
            },
        })
    rows.sort(key=lambda r: r["anchor_y"])
    return rows


def group_cards(lines: list[Line]):
    anchors = [l for l in lines if KAMPF_RE.search(l.text)]
    cards = []
    for anchor in anchors:
        card_height = max(anchor.height * 4, 1)

        # Name: nearest line above the anchor, roughly left-aligned with it, not a rank-group header.
        # Kept tight (a name always sits within its own card, close above the Kampfkraft line) so that
        # when a card is cut off at a frame edge and its real name isn't visible at all, we correctly
        # end up with no candidate here rather than grabbing unrelated text further away (the search
        # box placeholder, a rank-group header, etc.) that happens to be the nearest line found.
        name_candidates = [
            l for l in lines
            if l is not anchor
            and anchor.top - card_height * 0.75 < l.cy < anchor.top
            and l.left < anchor.right
            # Real names start in the same column as the Kampfkraft line (confirmed across real
            # captures). A stray text fragment glued to the window's left edge — seen in practice as a
            # tiny leftover scrap of a neighboring name during a mid-scroll capture — sits far to the
            # left of that column and should never be mistaken for the name.
            and l.left >= anchor.left - card_height * 0.5
            and not HEADER_RE.match(l.text.strip())
            and not RANK_BADGE_RE.match(l.text.strip())
        ]
        name_line = min(name_candidates, key=lambda l: anchor.top - l.cy) if name_candidates else None

        # Status: nearest line whose vertical center matches the name line's (or, if no name line,
        # a band above the anchor), positioned to the right of the card's horizontal midpoint.
        ref_cy = name_line.cy if name_line else anchor.top - card_height * 0.3
        status_candidates = [
            l for l in lines
            if l is not anchor and l is not name_line
            and abs(l.cy - ref_cy) < card_height * 0.5
            and l.left > anchor.left + card_height * 1.5
            and not FRACTION_RE.match(l.text.strip())  # a header's "N/M" counter, never a real status
        ]
        status_line = min(status_candidates, key=lambda l: abs(l.cy - ref_cy)) if status_candidates else None

        power_match = POWER_RE.search(anchor.text)
        level_match = LEVEL_RE.search(anchor.text)

        card_box = {
            "left": min(x.left for x in [anchor, name_line, status_line] if x),
            "top": min(x.top for x in [anchor, name_line, status_line] if x) - card_height * 0.15,
            "right": max(x.right for x in [anchor, name_line, status_line] if x),
            "bottom": anchor.bottom + card_height * 0.1,
        }

        power = power_match.group(1).replace(",", ".") if power_match else None
        if name_line is None and power is None:
            # Nothing usable at all — typically a phantom anchor near a rank-group header (its own
            # text accidentally resembling "Kampf...", or a duplicate/misaligned detection) that
            # carries no real member data. Confirmed on real captures: these showed up as an empty
            # name plus a header's "N/M" counter as a garbage "status", cluttering the results.
            continue

        cards.append({
            "anchor_y": anchor.top,
            "name": (clean_name(name_line.text) if name_line else ""),
            "values_text": anchor.text,
            "status": (status_line.text.strip() if status_line else ""),
            "power": power,
            "level": level_match.group(1) if level_match else None,
            "confidence": {
                "name": name_line.score if name_line else None,
                "values": anchor.score,
                "status": status_line.score if status_line else None,
            },
            "box": card_box,
            "name_box": (vars(name_line) if name_line else None),
            "values_box": vars(anchor),
            "status_box": (vars(status_line) if status_line else None),
        })
    cards.sort(key=lambda c: c["anchor_y"])
    return cards


def save_capture(raw: bytes, label: str) -> str:
    safe_label = re.sub(r"[^A-Za-z0-9_.-]", "_", label) or "frame.png"
    filename = f"{time.strftime('%Y%m%d-%H%M%S')}_{safe_label}"
    (CAPTURES_DIR / filename).write_bytes(raw)
    return filename


@app.post("/process")
async def process(file: UploadFile = File(...)):
    raw = await file.read()
    save_capture(raw, file.filename or "frame.png")
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    result, _ = engine(np.array(image))
    lines = [to_line(box, text, score) for box, text, score in (result or [])]
    mode = detect_mode(lines)

    cards = []
    rankings = []
    if mode == "ranking":
        rankings = group_ranking_rows(lines)
    else:
        # Default to members-mode grouping even when the header text isn't recognized (e.g. a frame
        # captured mid-scroll where the sticky header happens to be obscured) — this is the far more
        # common screen and degrading gracefully beats silently returning nothing.
        cards = group_cards(lines)
        leader = find_leader_card(lines)
        if leader:
            cards.insert(0, leader)

    return JSONResponse({
        "width": image.width,
        "height": image.height,
        "mode": mode,
        "raw_lines": [{"text": l.text, "score": l.score} for l in lines],
        "cards": cards,
        "rankings": rankings,
    })


@app.get("/")
async def index():
    # Serve the review UI so the whole prototype lives under one URL (http://127.0.0.1:8795/).
    return FileResponse(Path(__file__).parent / "index.html")


@app.get("/health")
async def health():
    return {"ok": True}
