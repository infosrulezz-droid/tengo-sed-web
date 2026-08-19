#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_dist.py — stages the deployable site into dist/

Why this exists:
  * products/ holds 682 images but only ~219 are reachable from the live
    catalog. The other 463 (≈61 MB) are the correction pool the image-editor
    agent picks from — valuable in git, pure waste on a CDN.
  * server.js, catalog-editor.html, notes.json and friends must never be
    published. Staging an allow-list is safer than blocklisting after the fact.

Usage:
    python build_seo.py      # refresh JSON-LD first
    python build_dist.py     # then stage
    firebase deploy          # then ship
"""
import json, io, os, re, shutil, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")

# Only these top-level files are ever published.
PAGES = ["index.html", "404.html", "robots.txt", "sitemap.xml",
         "logo.png", "logo.jpg", "banner.png"]

# Explicitly NOT published, listed so the intent is visible in review:
#   server.js               - backend; static hosting must not expose it
#   catalog-editor.html     - admin tooling
#   stamp-agent.html        - admin tooling
#   catalog.html            - has ADMIN_PASS in client JS
#   store.html              - has ADMIN_PASS in client JS
#   notes.json              - internal CEO queue
#   page_edits.json         - internal
#   products_inventory.json - see note below
#   product_img_map.json    - internal


def used_images():
    m = json.load(io.open(os.path.join(ROOT, "product_img_map.json"), encoding="utf-8"))
    d = json.load(io.open(os.path.join(ROOT, "products_inventory.json"), encoding="utf-8"))
    items = d if isinstance(d, list) else d.get("products", d)
    used = set()
    for p in items:
        v = m.get(p.get("name", ""))
        if v:
            used.add(v.split("?")[0])
    # anything hard-coded in the page too
    s = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    for mt in re.finditer(r"products/([^\"'\s)?]+)", s):
        f = mt.group(1)
        if "$" in f or "{" in f:  # skip JS template literals, e.g. products/${img}
            continue
        used.add(f)
    return used


def main():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(os.path.join(DIST, "products"))
    os.makedirs(os.path.join(DIST, "hero_slides"))

    for f in PAGES:
        src = os.path.join(ROOT, f)
        if os.path.exists(src):
            shutil.copy2(src, DIST)

    # index.html fetches this at runtime to render the grid, so it must ship.
    # It contains names, prices and categories only — no customer or internal
    # data — and the same values are already public in the JSON-LD.
    shutil.copy2(os.path.join(ROOT, "products_inventory.json"), DIST)
    shutil.copy2(os.path.join(ROOT, "product_img_map.json"), DIST)

    n_img = n_missing = 0
    for f in sorted(used_images()):
        src = os.path.join(ROOT, "products", f)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(DIST, "products", f))
            n_img += 1
        else:
            print(f"  WARNING missing image: {f}", file=sys.stderr)
            n_missing += 1

    n_hero = 0
    hero = os.path.join(ROOT, "hero_slides")
    for f in sorted(os.listdir(hero)):
        if f.lower().endswith((".png", ".webp", ".jpg")):
            shutil.copy2(os.path.join(hero, f), os.path.join(DIST, "hero_slides", f))
            n_hero += 1

    total = sum(os.path.getsize(os.path.join(dp, f))
                for dp, _, fs in os.walk(DIST) for f in fs)
    count = sum(len(fs) for _, _, fs in os.walk(DIST))

    print(f"dist/ staged")
    print(f"  pages          : {len([f for f in PAGES if os.path.exists(os.path.join(ROOT,f))])}")
    print(f"  product images : {n_img}" + (f"  ({n_missing} MISSING)" if n_missing else ""))
    print(f"  hero slides    : {n_hero}")
    print(f"  total          : {count} files, {total/1048576:.1f} MB")
    if n_missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
