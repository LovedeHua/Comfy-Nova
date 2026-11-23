"""A1111 / Civitai 元数据解析测试

覆盖三种常见载体：PNG 文本块 parameters、JPEG EXIF UserComment、
WebP EXIF UserComment。Civitai 导出的图片多为后两者，此前完全提取不到。
"""

import json
from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin

from backend.src.gallery.scanner import GalleryScanner

A1111_BLOCK = """masterpiece, best quality, 1girl, solo, long hair, cherry blossoms
Negative prompt: lowres, bad anatomy, bad hands, text, watermark
Steps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 1234567890, Size: 832x1216, Model: someModel_v10"""


@pytest.fixture()
def scanner() -> GalleryScanner:
    return GalleryScanner()


def _make_png(path: Path) -> Path:
    png_info = PngImagePlugin.PngInfo()
    png_info.add_text("parameters", A1111_BLOCK)
    Image.new("RGB", (32, 32), (10, 20, 30)).save(path, pnginfo=png_info)
    return path


def _make_with_exif(path: Path, prefix: bytes) -> Path:
    exif = Image.Exif()
    exif[0x9286] = prefix.decode("latin-1") + A1111_BLOCK
    Image.new("RGB", (32, 32), (10, 20, 30)).save(path, exif=exif, quality=90)
    return path


def _assert_parsed(metadata: dict) -> None:
    assert metadata.get("prompt", "").startswith("masterpiece")
    assert "lowres" in metadata.get("negative_prompt", "")
    assert metadata.get("steps") == 28
    assert metadata.get("cfg") == 7.0
    assert metadata.get("seed") == 1234567890
    assert metadata.get("width") == 832
    assert metadata.get("height") == 1216
    assert metadata.get("model") == "someModel_v10"


def test_png_parameters_block(scanner: GalleryScanner, tmp_path: Path) -> None:
    _assert_parsed(scanner._extract_metadata(_make_png(tmp_path / "a.png"), "image"))


def test_jpeg_exif_unicode_prefix(scanner: GalleryScanner, tmp_path: Path) -> None:
    path = _make_with_exif(tmp_path / "a.jpg", b"UNICODE\x00")
    _assert_parsed(scanner._extract_metadata(path, "image"))


def test_webp_exif_unicode_prefix(scanner: GalleryScanner, tmp_path: Path) -> None:
    path = _make_with_exif(tmp_path / "a.webp", b"UNICODE\x00")
    _assert_parsed(scanner._extract_metadata(path, "image"))


def test_jpeg_exif_ascii_prefix(scanner: GalleryScanner, tmp_path: Path) -> None:
    path = _make_with_exif(tmp_path / "b.jpg", b"ASCII\x00\x00\x00")
    _assert_parsed(scanner._extract_metadata(path, "image"))


def test_prompt_prefix_is_stripped(scanner: GalleryScanner, tmp_path: Path) -> None:
    """字符集前缀不能残留在提示词开头。"""
    path = _make_with_exif(tmp_path / "c.jpg", b"UNICODE\x00")
    prompt = scanner._extract_metadata(path, "image").get("prompt", "")
    assert not prompt.startswith("UNICODE")
    assert not prompt.startswith("ASCII")


def test_plain_image_returns_empty(scanner: GalleryScanner, tmp_path: Path) -> None:
    path = tmp_path / "plain.png"
    Image.new("RGB", (16, 16), (0, 0, 0)).save(path)
    assert not scanner._extract_metadata(path, "image").get("prompt")


def test_comfyui_format_not_regressed(scanner: GalleryScanner, tmp_path: Path) -> None:
    """ComfyUI 的 prompt JSON 仍能被正确解析（本次改动的回归保护）。"""
    prompt_data = {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 12345, "steps": 20, "cfg": 7.0,
                "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0,
                "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 768, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a cat on a chair", "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry, low quality", "clip": ["4", 1]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "x", "images": ["8", 0]}},
    }
    png_info = PngImagePlugin.PngInfo()
    png_info.add_text("prompt", json.dumps(prompt_data))
    path = tmp_path / "comfy.png"
    Image.new("RGB", (32, 32), (10, 20, 30)).save(path, pnginfo=png_info)

    metadata = scanner._extract_metadata(path, "image")
    assert "cat" in metadata.get("prompt", "")
    assert "blurry" in metadata.get("negative_prompt", "")
    assert metadata.get("steps") == 20
