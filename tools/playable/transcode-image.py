#!/usr/bin/env python
import argparse
import sys
from io import BytesIO

from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser(description="Transcode an image for playable packaging.")
    parser.add_argument("--input", required=True, help="Path to the source image file.")
    parser.add_argument(
        "--format",
        default="webp",
        choices=("webp", "jpeg"),
        help="Output image format.",
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


def normalize_mode(image: Image.Image) -> Image.Image:
    if image.mode in ("RGB", "RGBA"):
        return image

    if "A" in image.getbands() or image.info.get("transparency") is not None:
        return image.convert("RGBA")

    return image.convert("RGB")


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
    output = BytesIO()
    image.save(output, format="WEBP", quality=quality, method=6)
    return output.getvalue()


def encode_jpeg(image: Image.Image, quality: int) -> bytes:
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


def main():
    args = parse_args()

    with Image.open(args.input) as image:
        image.load()
        image = normalize_mode(image)
        image = maybe_resize(image, args.max_dimension)

        if args.format == "jpeg":
            data = encode_jpeg(image, args.quality)
        else:
            data = encode_webp(image, args.quality)

    sys.stdout.buffer.write(data)


if __name__ == "__main__":
    main()
