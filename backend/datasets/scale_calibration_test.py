# Shark AI - dev utility, NOT shipped to production behaviour.
# Standalone smoke-test driver for backend/datasets/scale_calibration.py.
# Runs detect_scale_bar on a list of image paths and emits debug overlay PNGs.

import json
import os
import sys
from typing import List, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Make the module importable when run as a script via `python scale_calibration_test.py`.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scale_calibration import detect_scale_bar, ScaleBarResult, BlobInfo


CLASS_COLOURS = {
    'tooth':     (40, 220, 80),    # green
    'scale_bar': (255, 200, 20),   # yellow
    'unknown':   (180, 180, 180),  # grey
}


def _load_for_overlay(path: str, max_long_side: int = 2000) -> Tuple[Image.Image, float]:
    """Open the image as RGB on white background, downscaled for overlay rendering."""
    src = Image.open(path)
    if src.mode in ('RGBA', 'LA'):
        bg = Image.new('RGB', src.size, (255, 255, 255))
        bg.paste(src, mask=src.split()[-1])
        rgb = bg
    else:
        rgb = src.convert('RGB')

    w, h = rgb.size
    long_side = max(w, h)
    if long_side > max_long_side:
        scale = max_long_side / float(long_side)
        rgb = rgb.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    else:
        scale = 1.0
    return rgb, scale


def _scaled(box, s):
    x0, y0, x1, y1 = box
    return (int(x0 * s), int(y0 * s), int(x1 * s), int(y1 * s))


def _try_default_font(size: int = 22) -> ImageFont.ImageFont:
    """Pick whichever default font is available so the script does not crash on minimal containers."""
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size)
            except Exception:
                pass
    return ImageFont.load_default()


def draw_overlay(image_path: str, result: ScaleBarResult, out_path: str) -> None:
    """Render the detector's findings on top of the input image."""
    canvas, scale = _load_for_overlay(image_path)
    draw = ImageDraw.Draw(canvas)
    font = _try_default_font(22)
    small = _try_default_font(16)

    for blob in result.blobs:
        colour = CLASS_COLOURS.get(blob.classification, CLASS_COLOURS['unknown'])
        x0, y0, x1, y1 = _scaled(blob.bbox, scale)
        draw.rectangle([x0, y0, x1, y1], outline=colour, width=4)
        label = '%s  area=%d  fill=%.2f  ar=%.2f' % (
            blob.classification, blob.area_px, blob.fill_ratio, blob.aspect_ratio,
        )
        draw.text((x0 + 6, y0 + 6), label, fill=colour, font=small)

    if result.bar_bbox and result.ruler_region_px and result.bar_long_axis:
        bx0, by0, bx1, by1 = result.bar_bbox
        r0, r1 = result.ruler_region_px
        if result.bar_long_axis == 'x':
            rx0, rx1 = r0, r1
            ry0, ry1 = by0, by1
        else:
            rx0, rx1 = bx0, bx1
            ry0, ry1 = r0, r1
        rs = _scaled((rx0, ry0, rx1, ry1), scale)
        draw.rectangle([rs[0], rs[1], rs[2], rs[3]], outline=(240, 40, 40), width=4)
        draw.text((rs[0] + 6, rs[3] + 8), 'ruler region', fill=(240, 40, 40), font=small)

        # Draw each detected tick as a short perpendicular line so reviewers
        # can verify the algorithm is locked onto the real printed ticks.
        for tick in result.tick_positions_px:
            if result.bar_long_axis == 'x':
                x = int(tick * scale)
                yA = int(by0 * scale)
                yB = int(by1 * scale)
                draw.line([(x, yA), (x, yB)], fill=(255, 40, 40), width=2)
            else:
                y = int(tick * scale)
                xA = int(bx0 * scale)
                xB = int(bx1 * scale)
                draw.line([(xA, y), (xB, y)], fill=(255, 40, 40), width=2)

    lines = [
        'image:        ' + os.path.basename(image_path),
        'size:         %dx%d  scale=%.3f' % (result.image_size[0], result.image_size[1], scale),
        'foreground:   ' + result.foreground_source,
        'blobs:        ' + str(len(result.blobs)),
    ]
    if result.bar_bbox:
        lines.append('bar bbox:     %s  axis=%s  length_px=%s' % (
            result.bar_bbox, result.bar_long_axis, result.bar_bbox_length_px,
        ))
    if result.ruler_region_px:
        lines.append('ruler region: %s  length_px=%s  ticks=%d' % (
            result.ruler_region_px, result.ruler_region_length_px, result.tick_count,
        ))
        if result.median_tick_spacing_px is not None:
            lines.append('median spacing: %.1f px between ticks' % result.median_tick_spacing_px)
    if result.mm_per_pixel is not None:
        lines.append('ASSUMED %.2f mm/tick  =>  mm/px = %.5f  (conf=%.2f)' % (
            result.assumed_tick_spacing_mm,
            result.mm_per_pixel,
            result.confidence,
        ))
    else:
        lines.append('mm/px:        NOT DETERMINED')

    box_h = 28 * len(lines) + 16
    box_w = 720
    draw.rectangle([10, 10, 10 + box_w, 10 + box_h], fill=(0, 0, 0))
    for i, line in enumerate(lines):
        draw.text((20, 18 + i * 28), line, fill=(255, 255, 255), font=font)

    canvas.save(out_path, 'PNG', optimize=True)


def main(image_paths: List[str], out_dir: str) -> int:
    os.makedirs(out_dir, exist_ok=True)
    rc = 0
    summary = []
    for path in image_paths:
        if not os.path.exists(path):
            print('MISSING %s' % path)
            rc = 1
            continue
        result = detect_scale_bar(path)
        base = os.path.splitext(os.path.basename(path))[0]
        overlay_path = os.path.join(out_dir, 'overlay_' + base + '.png')
        json_path = os.path.join(out_dir, 'result_' + base + '.json')
        draw_overlay(path, result, overlay_path)
        # Strip the heavy blob list in the JSON output so it stays readable;
        # blobs are visible in the overlay anyway.
        data = result.to_dict()
        data['blobs'] = [
            {'classification': b['classification'], 'bbox': b['bbox'], 'area_px': b['area_px'],
             'fill_ratio': b['fill_ratio'], 'aspect_ratio': b['aspect_ratio']}
            for b in data['blobs']
        ]
        with open(json_path, 'w') as f:
            json.dump(data, f, indent=2)
        print('%s' % path)
        print('  overlay:   %s' % overlay_path)
        print('  result:    %s' % json_path)
        print('  mm/px:     %s' % (
            ('%.5f (conf=%.2f)' % (result.mm_per_pixel, result.confidence))
            if result.mm_per_pixel is not None else 'NOT DETERMINED'
        ))
        summary.append({
            'image': path,
            'mm_per_pixel': result.mm_per_pixel,
            'confidence': result.confidence,
            'notes': result.notes,
        })

    print('\nSummary:')
    print(json.dumps(summary, indent=2))
    return rc


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('usage: scale_calibration_test.py <out_dir> <image_path> [<image_path> ...]')
        sys.exit(2)
    out_dir = sys.argv[1]
    images = sys.argv[2:]
    sys.exit(main(images, out_dir))
