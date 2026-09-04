#!/usr/bin/env python3
"""Taglia screenshot Revolut in crop adattivi e sovrapposti.

Uso: python split_revolut.py <screenshot> <cartella_output>
     python split_revolut.py <screenshot> <cartella_output> --target-height 900

Lo script usa il ritmo delle bande di stitching quando e' regolare. Negli altri casi
ricava la dimensione dei crop dalla larghezza dell'immagine. Scrive anche un manifest JSON
che elenca gli unici crop da analizzare e ne certifica la copertura verticale completa.
"""
import argparse
import json
import math
import os
import statistics
import sys

from PIL import Image


def cut_lines(im):
    """Restituisce il centro delle bande orizzontali uniformi."""
    w, h = im.size
    g = im.convert("L").resize((16, h), Image.Resampling.BILINEAR)
    px = list(g.get_flattened_data())
    deviation = []
    for y in range(h):
        row = px[y * 16:(y + 1) * 16]
        mean = sum(row) / 16
        deviation.append((sum((v - mean) ** 2 for v in row) / 16) ** 0.5)

    low, high = min(deviation), max(deviation)
    threshold = low + (high - low) * 0.10
    min_flat = max(3, round(w / 144))
    cuts, start = [], None
    for y, value in enumerate(deviation):
        if value < threshold and start is None:
            start = y
        elif value >= threshold and start is not None:
            if y - start >= min_flat:
                cuts.append((start + y - 1) // 2)
            start = None
    if start is not None and h - start >= min_flat:
        cuts.append((start + h - 1) // 2)
    return cuts


def regular_period(cuts, width):
    """Trova il passo dominante delle bande, oppure None se non sono regolari."""
    # Le righe uniformi dentro header e card possono sembrare bande, ma sono troppo
    # ravvicinate per delimitare una porzione utile dell'immagine.
    gaps = [b - a for a, b in zip(cuts, cuts[1:]) if b - a >= width * 0.25]
    if len(gaps) < 2:
        return None
    median = statistics.median(gaps)
    inliers = [gap for gap in gaps if abs(gap - median) <= median * 0.15]
    if len(inliers) < 2 or len(inliers) < math.ceil(len(gaps) * 0.6):
        return None
    return round(statistics.median(inliers))


def boundaries(height, width, cuts, target_height=None):
    """Calcola confini adattivi che includono sempre 0 e height."""
    period = regular_period(cuts, width) if target_height is None else None
    target = target_height or period or round(width * 1.25)
    target = max(1, min(target, height))

    if period is None:
        parts = max(1, math.ceil(height / target))
        return [round(i * height / parts) for i in range(parts + 1)], target, "proportional"

    min_part = target * 0.35
    marks = [0]
    for cut in cuts:
        if cut - marks[-1] >= min_part and height - cut >= min_part:
            marks.append(cut)
    marks.append(height)

    expanded = [marks[0]]
    for end in marks[1:]:
        gap = end - expanded[-1]
        parts = max(1, math.ceil(gap / (target * 1.6)))
        start = expanded[-1]
        expanded.extend(round(start + gap * i / parts) for i in range(1, parts))
        expanded.append(end)
    return expanded, target, "stitch-bands"


def crop_regions(height, marks, overlap):
    """Espande ogni segmento sui due lati senza lasciare pixel scoperti."""
    regions = []
    for index, (start, end) in enumerate(zip(marks, marks[1:])):
        crop_start = 0 if index == 0 else max(0, start - overlap)
        crop_end = height if index == len(marks) - 2 else min(height, end + overlap)
        regions.append((crop_start, crop_end))
    return regions


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("screenshot")
    parser.add_argument("output_dir")
    parser.add_argument(
        "--target-height",
        type=int,
        help="altezza desiderata dei crop; omettere per il rilevamento automatico",
    )
    parser.add_argument(
        "--overlap",
        type=float,
        default=0.12,
        help="quota di sovrapposizione rispetto all'altezza rilevata (default: 0.12)",
    )
    args = parser.parse_args()
    if args.target_height is not None and args.target_height <= 0:
        parser.error("--target-height deve essere positivo")
    if not 0 <= args.overlap < 0.5:
        parser.error("--overlap deve essere compreso tra 0 e 0.5")
    return args


def main():
    args = parse_args()
    os.makedirs(args.output_dir, exist_ok=True)

    im = Image.open(args.screenshot)
    width, height = im.size
    cuts = cut_lines(im)
    marks, target, strategy = boundaries(
        height, width, cuts, target_height=args.target_height
    )
    overlap = round(target * args.overlap)
    regions = crop_regions(height, marks, overlap)
    base = os.path.splitext(os.path.basename(args.screenshot))[0]

    crops = []
    for index, (start, end) in enumerate(regions):
        path = os.path.abspath(os.path.join(args.output_dir, f"{base}_{index:02d}.png"))
        im.crop((0, start, width, end)).save(path)
        crops.append({
            "path": path,
            "y_start": start,
            "y_end": end,
            "width": width,
            "height": end - start,
        })
        print(f"{path}\t{width}x{end - start}\ty={start}-{end}")

    manifest = {
        "version": 1,
        "source": os.path.abspath(args.screenshot),
        "width": width,
        "height": height,
        "strategy": strategy,
        "target_height": target,
        "overlap_pixels": overlap,
        "detected_cut_lines": cuts,
        "coverage": {"y_start": 0, "y_end": height, "uncovered_pixels": 0},
        "crops": crops,
    }
    manifest_path = os.path.abspath(os.path.join(args.output_dir, f"{base}_manifest.json"))
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
    print(f"manifest\t{manifest_path}")
    print(
        f"# {len(crops)} crop adattivi, strategia={strategy}, "
        f"target={target}, overlap={overlap}, copertura=100%",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
