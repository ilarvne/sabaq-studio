#!/usr/bin/python3
"""Place an opaque export ID in the reserved banner using chroma only."""

from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory

from video_watermark_verify import ASPECTS, CELLS_PER_ROW, ROWS, layout, payload, video_dimensions


CHROMA_STEP = 2


def pattern(export_id, cell_width, cell_height):
    width, height = CELLS_PER_ROW * cell_width, ROWS * cell_height
    bits = [1 if byte & (1 << (7 - shift)) else -1 for byte in payload(export_id) for shift in range(8)] * 3
    u = bytearray()
    v = bytearray()
    for row in range(ROWS):
        line = bits[row * CELLS_PER_ROW // 2:(row + 1) * CELLS_PER_ROW // 2]
        samples = [sample for bit in line for sample in [bit] * (cell_width // 2) + [-bit] * (cell_width // 2)]
        u.extend(bytes(128 + CHROMA_STEP * sample for sample in samples) * (cell_height // 2))
        v.extend(bytes(128 - CHROMA_STEP * sample for sample in samples) * (cell_height // 2))
    return width, height, bytes([128]) * (width * height) + u + v


def embed(source, output, export_id):
    width, height = video_dimensions(source)
    if (width, height) not in ASPECTS:
        raise ValueError("Unsupported lecture dimensions.")
    band_height, cell_width, cell_height = layout(width, height)
    label_x = width - width * 16 // 100
    mark_width, mark_height, contents = pattern(export_id, cell_width, cell_height)
    with TemporaryDirectory(dir=Path(output).resolve().parent) as work:
        mask = Path(work) / "chroma.bin"
        mask.write_bytes(contents)
        filters = (
            # Keep the subtle chroma signal on the same matte as the visible AI label.
            f"[0:v]drawbox=x=0:y=0:w={label_x}:h={band_height}:color=0x10131d:t=fill,split[background][crop];"
            f"[crop]crop={mark_width}:{mark_height}:8:4[area];"
            "[area][1:v]blend=c0_expr=A:c1_expr='clip(A+B-128,16,240)':"
            "c2_expr='clip(A+B-128,16,240)'[signal];"
            "[background][signal]overlay=8:4[out]"
        )
        subprocess.run([
            "ffmpeg", "-nostdin", "-v", "error", "-xerror", "-n",
            "-threads", "2", "-protocol_whitelist", "file", "-i", source,
            "-f", "rawvideo", "-pix_fmt", "yuv420p", "-video_size", f"{mark_width}x{mark_height}",
            "-framerate", "25", "-protocol_whitelist", "file", "-i", str(mask),
            "-filter_complex_threads", "2", "-filter_complex", filters,
            "-map", "[out]", "-map", "0:a?", "-map", "0:s?",
            "-map_metadata", "-1", "-map_chapters", "-1", "-c:v", "libx264", "-crf", "16",
            "-preset", "veryfast", "-pix_fmt", "yuv420p", "-threads", "4",
            "-c:a", "copy", "-c:s", "copy", "-movflags", "+faststart", output,
        ], check=True)


if __name__ == "__main__":
    if len(sys.argv) != 4 or not re.fullmatch("[0-9a-f]{32}", sys.argv[3]):
        sys.exit("Usage: video_watermark_embed.py SOURCE OUTPUT EXPORT_ID")
    embed(*sys.argv[1:3], bytes.fromhex(sys.argv[3]))
