# Tank Hero Assets

This folder stores Tank hero portraits for internal alliance usage.

Policy:
- This site is private and intended for known ally users only (Discord-gated access).
- Keep assets inside this project context and do not redistribute publicly.
- If you use game screenshots, treat them as internal reference assets only.
- Keep transparent PNG files when possible.

Suggested files:
- `kimberly.png`
- `thumbs/kimberly.png`
- `tank_hero_02.png`
- `thumbs/tank_hero_02.png`
- etc.

Recommended sizes:
- Full card image: 512x512 px
- Thumbnail: 160x160 px

Current tank pipeline:
- Portrait exports in `assets/heroes/tank/extracted` are normalized to 256x256.
- Thumbnails in `assets/heroes/tank/extracted/thumbs` are generated as 160x160.
- Run `python scripte/generate_hero_thumbs.py` after renaming hero files.

Manifest:
- Edit `manifest.json` and keep file paths in sync with real files.
