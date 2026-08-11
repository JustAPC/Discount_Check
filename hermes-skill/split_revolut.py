#!/usr/bin/env python3
"""Taglia uno screenshot lungo dell'app Revolut in strisce leggibili da un modello vision.

Gli screenshot stitchati sono alti decine di migliaia di pixel: dati interi a un modello
vengono ridimensionati e i badge (es. "2x", "4 per 10 EUR") diventano illeggibili.

Lo stitching lascia una banda uniforme tra una schermata e l'altra: si taglia lì, cosi'
nessuna card resta spezzata. Se le bande non ci sono, fallback a tagli a passo fisso.

Uso:  python split_revolut.py <screenshot> <cartella_output>
"""
import sys
import os
from PIL import Image

MIN_FLAT = 10     # altezza minima di una banda per considerarla separatore
MIN_STRIP = 400   # sotto questa altezza la striscia e' header/rumore: si fonde con la successiva
MAX_STRIP = 1400  # sopra, si spezza a meta' per non perdere risoluzione


def cut_lines(im):
    """y dove l'immagine e' orizzontalmente uniforme: le giunture dello stitching."""
    w, h = im.size
    g = im.convert('L').resize((16, h), Image.BILINEAR)
    px = list(g.getdata())
    sd = []
    for y in range(h):
        row = px[y * 16:(y + 1) * 16]
        m = sum(row) / 16
        sd.append((sum((v - m) ** 2 for v in row) / 16) ** 0.5)

    lo, hi = min(sd), max(sd)
    th = lo + (hi - lo) * 0.10
    cuts, start = [], None
    for y, v in enumerate(sd):
        if v < th and start is None:
            start = y
        elif v >= th and start is not None:
            if y - start >= MIN_FLAT:
                cuts.append((start + y - 1) // 2)
            start = None
    return cuts


def strips(h, cuts):
    """Segmenti [a,b) utilizzabili: header fusi, strisce troppo alte spezzate."""
    marks = sorted({0, *cuts, h})
    out, a = [], marks[0]
    for b in marks[1:]:
        if b - a < MIN_STRIP:
            continue                      # troppo corto: si allunga fino al taglio dopo
        while b - a > MAX_STRIP:
            mid = a + (b - a) // 2
            out.append((a, mid))
            a = mid
        out.append((a, b))
        a = b
    if h - a >= MIN_STRIP:
        out.append((a, h))
    return out


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)

    im = Image.open(src)
    w, h = im.size
    segs = strips(h, cut_lines(im))
    base = os.path.splitext(os.path.basename(src))[0]

    for i, (a, b) in enumerate(segs):
        path = os.path.join(dst, f'{base}_{i:02d}.png')
        im.crop((0, a, w, b)).save(path)
        print(f'{path}\t{w}x{b - a}\ty={a}-{b}')
    print(f'# {len(segs)} strisce da {src} ({w}x{h})', file=sys.stderr)


if __name__ == '__main__':
    main()
