"""Optimize the uploaded logo PNGs for the web.

The originals (12800px, ~10MB each) are kept in brand/ as source; web-sized, optimized
copies replace the ones in frontend/public/. Run from the repo root:
    backend/.venv/Scripts/python.exe scripts/optimize_logos.py
"""
import os
import shutil

from PIL import Image

PUB = "frontend/public"
BRAND = "brand"
TARGETS = {
    "icon-light.png": (512, 512),
    "icon-dark.png": (512, 512),
    "full-light.png": (1400, 700),
    "full-dark.png": (1400, 700),
}

os.makedirs(BRAND, exist_ok=True)

for name, box in TARGETS.items():
    src = os.path.join(PUB, name)
    if not os.path.exists(src):
        print("skip (missing):", name)
        continue
    original = os.path.join(BRAND, name)
    if not os.path.exists(original):
        shutil.copy2(src, original)        # preserve the full-res source
    im = Image.open(src).convert("RGBA")
    im.thumbnail(box, Image.LANCZOS)       # preserves aspect ratio, fits within box
    im.save(src, "PNG", optimize=True)
    print(f"{name}: {im.size[0]}x{im.size[1]}  {os.path.getsize(src)//1024}KB")
