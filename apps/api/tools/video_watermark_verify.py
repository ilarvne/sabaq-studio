#!/usr/bin/python3
"""Decode the pixel watermark and check the visible label without an expected export ID."""

import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import zlib


ASPECTS = ((1920, 1080), (1080, 1920), (1080, 1080))
CELLS_PER_ROW = 80
ROWS = 12
SIGNAL_BITS = 160
DOMAIN = b"Sabaq lecture watermark v1\x00"
SCHEME = "sabaq-chroma-v1"


def video_dimensions(path):
    probe = subprocess.check_output([
        "ffprobe", "-v", "error", "-protocol_whitelist", "file", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", path,
    ])
    stream, = json.loads(probe)["streams"]
    return stream["width"], stream["height"]


def layout(width, height):
    band_height = height * 8 // 100
    cell_width = width * 64 // 100 // (CELLS_PER_ROW * 2) * 2
    cell_height = (band_height - 12) // (ROWS * 2) * 2
    return band_height, cell_width, cell_height


def payload(export_id):
    return export_id + struct.pack(">I", zlib.crc32(DOMAIN + export_id))


def label_masks(width, band_height):
    # Render the same glyphs as the compositor. Require both the strokes and
    # their surrounding negative space to distinguish the label from a white box.
    label_width = width * 16 // 100
    x = width - label_width
    font = next((candidate for candidate in (
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ) if Path(candidate).is_file()), None)
    if not font:
        raise ValueError("The DejaVu Sans label font is unavailable.")
    template = subprocess.check_output([
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i",
        f"color=c=0x10131d:s={width}x{band_height // 2 * 2}",
        "-vf", f"drawtext=fontfile={font}:text=ИИ:fontcolor=white:"
        f"fontsize={int(band_height * .45)}:x={x}+({label_width}-text_w)/2:y=({band_height}-text_h)/2,extractplanes=y",
        "-frames:v", "1", "-f", "rawvideo", "-threads", "1", "pipe:1",
    ])
    area = [y * width + px for y in range(6, band_height - 6, 2)
            for px in range(x + label_width // 4, width - label_width // 4, 2)]
    light = [offset for offset in area if template[offset] >= 206]
    dark = [offset for offset in area if template[offset] < 50]
    if not light or not dark:
        raise ValueError("The expected AI label could not be rendered.")
    return light, dark


def sample_pairs(width, band_height, cell_width, cell_height):
    # One chroma sample per cell. The two opposing color-plane shifts
    # cancel the unmarked banner color and reduce transcode noise.
    uv_width = width // 2
    y_bytes = width * (band_height // 2 * 2)
    pairs = []
    for pair in range(SIGNAL_BITS * 3):
        row, col = divmod(pair * 2, CELLS_PER_ROW)
        u = y_bytes + (4 + row * cell_height + cell_height // 2) // 2 * uv_width
        u += (8 + col * cell_width + cell_width // 2) // 2
        pairs.append((u, u + cell_width // 2))
    return pairs, y_bytes // 4


def recover_id(frame, pairs, plane_size):
    bits = bytearray(20)
    for bit in range(SIGNAL_BITS):
        total = 0
        for copy in range(3):
            left, right = pairs[bit + copy * SIGNAL_BITS]
            total += frame[left] - frame[right] - frame[left + plane_size] + frame[right + plane_size]
        # Combine the three measurements before deciding. A resize can attenuate any replica.
        if not total:
            return None
        bits[bit // 8] |= (total > 0) << (7 - bit % 8)
    return bytes(bits[:16]) if bits == payload(bits[:16]) else None


def verify(path):
    actual_width, actual_height = video_dimensions(path)
    width, height = min(ASPECTS, key=lambda dimensions: abs(dimensions[0] / dimensions[1] - actual_width / actual_height))
    if abs(actual_width / actual_height - width / height) > .01:
        raise ValueError("Unexpected lecture aspect ratio.")
    band, cell_width, cell_height = layout(width, height)
    band_even = band // 2 * 2
    frame_bytes = width * band_even * 3 // 2
    light, dark = label_masks(width, band)
    pairs, plane_size = sample_pairs(width, band, cell_width, cell_height)
    frames = labels = marked = 0
    found = None
    resized = (width, height) != (actual_width, actual_height)
    scale = f"scale={width}:{height}," if resized else ""
    stroke_coverage = .85 if resized else .90
    decode = [
        "ffmpeg", "-nostdin", "-v", "error", "-xerror", "-threads", "2", "-filter_threads", "1",
        "-protocol_whitelist", "file", "-i", path, "-map", "0:v:0",
        "-vf", f"{scale}crop={width}:{band_even}:0:0,format=yuv420p",
        "-fps_mode", "passthrough", "-threads", "1", "-f", "rawvideo", "pipe:1",
    ]
    with subprocess.Popen(decode, stdout=subprocess.PIPE) as process:
        while frame := process.stdout.read(frame_bytes):
            if len(frame) != frame_bytes:
                raise ValueError("Truncated decoded frame.")
            frames += 1
            if (sum(frame[i] >= 185 for i in light) >= stroke_coverage * len(light)
                    and sum(frame[i] >= 115 for i in dark) <= .06 * len(dark)):
                labels += 1
            recovered = recover_id(frame, pairs, plane_size)
            if recovered:
                if found is not None and recovered != found:
                    raise ValueError("Conflicting watermark IDs in decoded frames.")
                found = recovered
                marked += 1
        if process.wait() != 0 or not frames:
            raise ValueError("Unable to decode lecture video.")
    with open(path, "rb") as media:
        checksum = hashlib.file_digest(media, "sha256").hexdigest()
    return {
        "sha256": checksum,
        "decodedFrames": frames,
        "visibleLabel": "ИИ" if labels == frames else "",
        "visibleLabelFrames": labels,
        "watermarkScheme": SCHEME,
        "watermarkFrames": marked,
        "watermarkId": found.hex() if found else None,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: video_watermark_verify.py VIDEO")
    print(json.dumps(verify(sys.argv[1])))
