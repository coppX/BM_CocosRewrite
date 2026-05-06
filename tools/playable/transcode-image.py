#!/usr/bin/env python
import argparse
import sys
from io import BytesIO
from typing import Optional

from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser(description="Transcode an image for playable packaging.")
    parser.add_argument("--input", required=True, help="Path to the source image file.")
    parser.add_argument(
        "--format",
        default=None,
        choices=("webp", "jpeg", "png", "smart"),
        help="Output image format. Omit to preserve the source format.",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=30,
        help="Lossy quality for the encoded image.",
    )
    parser.add_argument(
        "--max-dimension",
        type=int,
        default=0,
        help="Clamp the image so its largest side does not exceed this value. 0 disables resizing.",
    )
    return parser.parse_args()


def normalize_lossy_mode(image: Image.Image) -> Image.Image:
    if image.mode in ("RGB", "RGBA"):
        return image

    if "A" in image.getbands() or image.info.get("transparency") is not None:
        return image.convert("RGBA")

    return image.convert("RGB")


def normalize_png_mode(image: Image.Image) -> Image.Image:
    if image.mode in ("1", "L", "LA", "P", "RGB", "RGBA"):
        return image

    if "A" in image.getbands() or image.info.get("transparency") is not None:
        return image.convert("RGBA")

    return image.convert("RGB")


def uses_transparency(image: Image.Image) -> bool:
    if image.info.get("transparency") is not None:
        return True

    if "A" not in image.getbands():
        return False

    alpha = image.getchannel("A")
    minimum, _maximum = alpha.getextrema()
    return minimum < 255


def maybe_resize(image: Image.Image, max_dimension: int) -> Image.Image:
    if max_dimension <= 0:
        return image

    width, height = image.size
    largest = max(width, height)
    if largest <= 0 or largest <= max_dimension:
        return image

    scale = max_dimension / largest
    resized = (
        max(1, int(round(width * scale))),
        max(1, int(round(height * scale))),
    )
    return image.resize(resized, Image.Resampling.LANCZOS)


def encode_webp(image: Image.Image, quality: int) -> bytes:
    image = normalize_lossy_mode(image)
    output = BytesIO()
    image.save(output, format="WEBP", quality=quality, method=6)
    return output.getvalue()


def encode_jpeg(image: Image.Image, quality: int) -> bytes:
    image = normalize_lossy_mode(image)
    if "A" in image.getbands():
        flattened = Image.new("RGB", image.size, (0, 0, 0))
        flattened.paste(image, mask=image.getchannel("A"))
        image = flattened
    elif image.mode != "RGB":
        image = image.convert("RGB")

    output = BytesIO()
    image.save(
        output,
        format="JPEG",
        quality=quality,
        optimize=True,
        progressive=True,
    )
    return output.getvalue()


def encode_png(image: Image.Image) -> bytes:
    image = normalize_png_mode(image)
    output = BytesIO()
    image.save(
        output,
        format="PNG",
        optimize=True,
        compress_level=9,
    )
    return output.getvalue()


def encode_png_quantized(image: Image.Image, colors: int = 256) -> bytes:
    if uses_transparency(image):
        working = image.convert("RGBA")
        quantized = working.quantize(
            colors=max(2, min(256, int(colors))),
            method=Image.Quantize.FASTOCTREE,
            dither=Image.Dither.NONE,
        )
    else:
        working = image.convert("RGB")
        quantized = working.quantize(
            colors=max(2, min(256, int(colors))),
            method=Image.Quantize.MEDIANCUT,
            dither=Image.Dither.NONE,
        )

    output = BytesIO()
    quantized.save(
        output,
        format="PNG",
        optimize=True,
        compress_level=9,
    )
    return output.getvalue()


def encode_smart(image: Image.Image, quality: int) -> bytes:
    png_bytes = encode_png(image)

    if uses_transparency(image):
        quantized_png = encode_png_quantized(image, colors=256)
        return quantized_png if len(quantized_png) < len(png_bytes) else png_bytes

    jpeg_bytes = encode_jpeg(image, quality)
    return jpeg_bytes if len(jpeg_bytes) < len(png_bytes) else png_bytes


def resolve_output_format(requested_format: Optional[str], input_path: str, source_format: Optional[str]) -> str:
    if requested_format:
        return requested_format

    normalized_source = (source_format or "").strip().lower()
    if normalized_source in ("webp", "jpeg", "png"):
        return normalized_source
    if normalized_source == "jpg":
        return "jpeg"

    lowered_path = input_path.lower()
    if lowered_path.endswith(".jpg") or lowered_path.endswith(".jpeg"):
        return "jpeg"
    if lowered_path.endswith(".webp"):
        return "webp"
    return "png"


def main():
    args = parse_args()

    with Image.open(args.input) as image:
        image.load()
        output_format = resolve_output_format(args.format, args.input, image.format)
        image = maybe_resize(image, args.max_dimension)

        if output_format == "smart":
            data = encode_smart(image, args.quality)
        elif output_format == "jpeg":
            data = encode_jpeg(image, args.quality)
        elif output_format == "png":
            data = encode_png(image)
        else:
            data = encode_webp(image, args.quality)

    sys.stdout.buffer.write(data)


if __name__ == "__main__":
    main()
