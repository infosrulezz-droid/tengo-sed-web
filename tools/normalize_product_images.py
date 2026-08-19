#!/usr/bin/env python3
"""Normaliza fotos de producto al estilo de la casa: fondo transparente, cuadrado, HD.

El catalogo de Tengo Sed tiene dos mundos: las fotos buenas (600x600 PNG con fondo
transparente) y las que llegaron despues (_custom / _replacement) con caja blanca y
225-400px. Este script lleva las segundas al estilo de las primeras.

  Auditar:   python tools/normalize_product_images.py --report
  Probar:    python tools/normalize_product_images.py products/x.jpg --out out/ --dry-run
  Convertir: python tools/normalize_product_images.py products/ --out out/ --only white

Nunca escribe sobre products/ directamente: siempre a --out, para revisar antes.
"""
import argparse
import json
import os
import sys
from collections import Counter

import numpy as np
from PIL import Image, ImageFilter

TARGET_SIZE = 1200          # lienzo final cuadrado
CONTENT_RATIO = 0.88        # cuanto del lienzo ocupa el producto
WHITE_MIN = 236             # umbral de "casi blanco" para el recorte de fondo
EDGE_FLAT_STD = 12          # varianza maxima del borde para considerarlo fondo plano
MIN_HD_SOURCE = 500         # bajo esto no hay HD posible, solo interpolacion
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")


def classify(path):
    """Devuelve (bg, ancho, alto) mirando los 3px del borde."""
    with Image.open(path) as im:
        w, h = im.size
        a = np.asarray(im.convert("RGBA"))
    edges = np.concatenate([a[:3].reshape(-1, 4), a[-3:].reshape(-1, 4),
                            a[:, :3].reshape(-1, 4), a[:, -3:].reshape(-1, 4)])
    if edges[:, 3].mean() < 32:
        return "transparent", w, h
    rgb_mean = edges[:, :3].mean(axis=0)
    flat = edges[:, :3].std(axis=0).mean() < EDGE_FLAT_STD
    if flat and rgb_mean.min() > WHITE_MIN:
        return "white", w, h
    if flat and rgb_mean.min() > 215:
        return "light", w, h
    return "other", w, h


def background_mask(rgb, tolerance):
    """Fondo = pixeles claros CONECTADOS al borde. Un rotulo blanco en el centro
    de la botella no se toca, porque no toca el borde."""
    light = rgb.min(axis=2) >= tolerance
    mask = np.zeros(light.shape, bool)
    mask[0, :] = light[0, :]
    mask[-1, :] = light[-1, :]
    mask[:, 0] = light[:, 0]
    mask[:, -1] = light[:, -1]
    while True:
        grown = mask.copy()
        for shift, axis in ((1, 0), (-1, 0), (1, 1), (-1, 1)):
            grown |= np.roll(mask, shift, axis=axis)
        grown &= light
        if grown.sum() == mask.sum():
            return grown
        mask = grown


def knockout(im, tolerance=WHITE_MIN):
    """Saca el fondo plano y suaviza el borde para que no quede recortado a tijera."""
    rgba = im.convert("RGBA")
    arr = np.asarray(rgba).copy()
    bg = background_mask(arr[:, :, :3].astype(np.int16), tolerance)
    alpha = np.where(bg, 0, arr[:, :, 3]).astype(np.uint8)
    alpha_img = Image.fromarray(alpha)
    # erosion de 1px: se come el pixel contaminado de blanco del antialias (el halo
    # que se ve recien cuando pegas la foto sobre el fondo oscuro de la tienda)
    alpha_img = alpha_img.filter(ImageFilter.MinFilter(3))
    alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(0.5))
    alpha_img = alpha_img.point(lambda v: 0 if v < 24 else min(255, int(v * 1.25)))
    rgba.putalpha(alpha_img)
    return rgba


def fit_square(im, size=TARGET_SIZE, ratio=CONTENT_RATIO):
    """Recorta al contenido y lo centra en un lienzo cuadrado con aire parejo."""
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    box = int(size * ratio)
    scale = min(box / im.width, box / im.height)
    new = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    im = im.resize(new, Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - new[0]) // 2, (size - new[1]) // 2), im)
    return canvas


def sharpen(im):
    return im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=55, threshold=3))


def process(path, out_dir, dry_run=False, tolerance=WHITE_MIN):
    bg, w, h = classify(path)
    name = os.path.splitext(os.path.basename(path))[0]
    note = "upscale-only (re-fotografiar)" if min(w, h) < MIN_HD_SOURCE else "ok"
    record = {"file": os.path.basename(path), "bg": bg, "src": f"{w}x{h}",
              "hd": note, "out": None}
    if dry_run:
        return record
    with Image.open(path) as im:
        result = fit_square(sharpen(knockout(im, tolerance)) if bg in ("white", "light") else knockout(im, tolerance))
    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, name + ".png")
    result.save(dest, "PNG", optimize=True)
    record["out"] = dest
    return record


def collect(target):
    if os.path.isfile(target):
        return [target]
    return [os.path.join(target, f) for f in sorted(os.listdir(target))
            if f.lower().endswith(IMG_EXT)]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", nargs="?", default="products", help="archivo o carpeta")
    ap.add_argument("--out", default="products_normalized", help="carpeta de salida")
    ap.add_argument("--only", choices=["white", "light", "other", "transparent"],
                    action="append", help="procesar solo estos fondos (repetible)")
    ap.add_argument("--tolerance", type=int, default=WHITE_MIN,
                    help=f"umbral de blanco 200-254 (def. {WHITE_MIN})")
    ap.add_argument("--limit", type=int, help="procesar solo los primeros N")
    ap.add_argument("--dry-run", action="store_true", help="no escribe nada")
    ap.add_argument("--report", action="store_true", help="solo auditar el catalogo")
    args = ap.parse_args()

    files = collect(args.target)
    if not files:
        sys.exit(f"sin imagenes en {args.target}")

    if args.report:
        rows, tally, low = [], Counter(), 0
        for f in files:
            try:
                bg, w, h = classify(f)
            except Exception as exc:
                rows.append({"file": os.path.basename(f), "error": str(exc)[:60]})
                continue
            tally[bg] += 1
            low += min(w, h) < MIN_HD_SOURCE
            rows.append({"file": os.path.basename(f), "bg": bg, "src": f"{w}x{h}"})
        print(f"{len(files)} imagenes | " + " ".join(f"{k}={v}" for k, v in tally.most_common()))
        print(f"bajo {MIN_HD_SOURCE}px (no se pueden hacer HD sin re-fotografiar): {low}")
        with open("image_audit.json", "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=1, ensure_ascii=False)
        print("detalle -> image_audit.json")
        return

    done, skipped = [], 0
    for f in files:
        try:
            bg, _, _ = classify(f)
        except Exception as exc:
            print(f"  ERROR {os.path.basename(f)}: {exc}", file=sys.stderr)
            continue
        if args.only and bg not in args.only:
            skipped += 1
            continue
        done.append(process(f, args.out, args.dry_run, args.tolerance))
        if args.limit and len(done) >= args.limit:
            break

    for r in done:
        flag = "  <-- " + r["hd"] if r["hd"] != "ok" else ""
        print(f"{r['file']:<48} {r['bg']:<12} {r['src']:>9}{flag}")
    verb = "se convertirian" if args.dry_run else "convertidas"
    print(f"\n{len(done)} {verb}, {skipped} omitidas por --only")
    if not args.dry_run and done:
        print(f"salida: {args.out}/  (revisar antes de copiar a products/)")


if __name__ == "__main__":
    main()
