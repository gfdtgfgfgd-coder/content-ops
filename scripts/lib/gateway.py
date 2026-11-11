#!/usr/bin/env python3
"""Generate one image through the configured company Images API.

Credentials stay in environment variables or an ignored local env file. The
script prints a small JSON result for other scripts and never prints the key.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import re
import struct
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import zlib

TRANSIENT_GATEWAY_MARKERS = (
    'remote end closed', 'connection reset', 'broken pipe', 'timed out', 'timeout',
    'temporarily unavailable', 'connection aborted', 'incomplete read', 'errno 54',
    'errno 104', 'connection refused', 'network is unreachable',
)


ROOT = Path(__file__).resolve().parents[2]


class ImageGenerationError(RuntimeError):
    pass


def read_env_file(path: Path | None) -> dict[str, str]:
    """Read simple KEY=value settings without executing a shell."""
    settings: dict[str, str] = {}
    if path and path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                raise ImageGenerationError(f"Invalid config line in {path.name}")
            name, value = line.split("=", 1)
            name, value = name.strip(), value.strip()
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
                raise ImageGenerationError(f"Invalid setting name in {path.name}")
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            settings[name] = value
    return settings


MODEL_DEFAULTS = {name: value for name, value in read_env_file(ROOT / 'config/gateway.env.example').items()
                  if name.startswith('CONTENT_OPS_') and name.endswith('_MODEL')}


def load_config(path: Path | None) -> dict[str, str]:
    file_settings = read_env_file(path)
    settings = {**MODEL_DEFAULTS, **file_settings}
    settings.update(os.environ)
    for name in ('CONTENT_OPS_BASE_URL', 'CONTENT_OPS_API_KEY', *MODEL_DEFAULTS):
        if name in file_settings:
            settings[name] = file_settings[name]
    return settings


def safe_error(text: str, key: str) -> str:
    text = text.replace(key, "[REDACTED]") if key else text
    text = re.sub(r"sk-[A-Za-z0-9_-]+", "[REDACTED]", text)
    return text[:1000]


def transient_gateway_error(error: BaseException) -> bool:
    if isinstance(error, (TimeoutError, ConnectionError, BrokenPipeError, http.client.IncompleteRead, http.client.RemoteDisconnected)):
        return True
    if isinstance(error, URLError):
        reason = error.reason
        if isinstance(reason, BaseException) and transient_gateway_error(reason):
            return True
        text = str(reason or error).lower()
    else:
        text = str(error).lower()
    return any(marker in text for marker in TRANSIENT_GATEWAY_MARKERS)


def friendly_connection_error(error: BaseException, key: str) -> str:
    text = safe_error(str(error), key)
    lowered = text.lower()
    if isinstance(error, TimeoutError) or any(marker in lowered for marker in ('timed out', 'timeout', '超时')):
        return '网关连接超时，请稍后重试'
    if any(marker in lowered for marker in (
        'remote end closed', 'connection reset', 'broken pipe', 'connection aborted',
        'incomplete read', '连接中断', 'connection refused',
    )):
        return '网关连接中断，请稍后重试'
    return '网关连接失败：' + text


def request_json(url: str, payload: dict, key: str, timeout: float, *, retries: int = 2) -> dict:
    """POST JSON; brief-disconnect retries share the caller's timeout budget."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    attempts = max(1, int(retries) + 1)
    deadline = time.monotonic() + timeout
    last_error: BaseException | None = None
    for attempt in range(attempts):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ImageGenerationError(friendly_connection_error(TimeoutError(), key))
        request = Request(
            url,
            data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=remaining) as response:
                result = json.load(response)
            break
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise ImageGenerationError(f"Gateway HTTP {error.code}: {safe_error(detail, key)}") from None
        except (URLError, TimeoutError, ConnectionError, BrokenPipeError, http.client.HTTPException) as error:
            last_error = error
            if attempt + 1 < attempts and transient_gateway_error(error):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ImageGenerationError(friendly_connection_error(TimeoutError(), key)) from None
                time.sleep(min(1.5 * (attempt + 1), 4.0, remaining / 2))
                continue
            raise ImageGenerationError(friendly_connection_error(error, key)) from None
        except (ValueError, UnicodeError):
            raise ImageGenerationError("Gateway returned invalid JSON") from None
    else:
        raise ImageGenerationError(friendly_connection_error(last_error or RuntimeError('网关无响应'), key))
    if not isinstance(result, dict):
        raise ImageGenerationError("Gateway response must be a JSON object")
    if result.get("error"):
        raise ImageGenerationError("Gateway error: " + safe_error(json.dumps(result["error"], ensure_ascii=False), key))
    return result


def image_reference(response: dict) -> tuple[str, str]:
    for item in response.get("data", []):
        if item.get("b64_json"):
            return "base64", item["b64_json"]
        if item.get("url"):
            return "url", item["url"]
    # Qwen retains the upstream image in metadata if data is empty.
    choices = response.get("metadata", {}).get("output", {}).get("choices", [])
    for choice in choices:
        for part in choice.get("message", {}).get("content", []):
            if part.get("image"):
                return "url", part["image"]
    raise ImageGenerationError("Gateway returned no image in data or metadata.output")


def read_image(kind: str, value: str, timeout: float) -> bytes:
    if kind == "base64" or value.startswith("data:image/"):
        encoded = value.split(",", 1)[1] if value.startswith("data:") else value
        try:
            return base64.b64decode(encoded, validate=True)
        except ValueError:
            raise ImageGenerationError("Gateway returned invalid image base64") from None
    if urlparse(value).scheme not in ("http", "https"):
        raise ImageGenerationError("Gateway returned an unsupported image URL")
    try:
        # Never forward the gateway credential to the image storage provider.
        with urlopen(Request(value, headers={"User-Agent": "content-ops-image/1"}), timeout=timeout) as response:
            data = response.read(40 * 1024 * 1024 + 1)
    except (HTTPError, URLError, TimeoutError):
        raise ImageGenerationError("Image download failed; the gateway request may already have been billed") from None
    if len(data) > 40 * 1024 * 1024:
        raise ImageGenerationError("Image exceeds the 40 MiB download limit")
    return data


def write_image(data: bytes, output: Path) -> dict:
    if not data:
        raise ImageGenerationError("Downloaded image is empty")
    try:
        from PIL import Image
    except ImportError:
        if output.suffix.lower() != ".png" or not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ImageGenerationError("Install Pillow to validate or convert the returned image") from None
        offset, width, height, ended = 8, 0, 0, False
        while offset + 12 <= len(data):
            length = int.from_bytes(data[offset:offset + 4], "big")
            chunk_type = data[offset + 4:offset + 8]
            end = offset + 8 + length
            if end + 4 > len(data):
                raise ImageGenerationError("Gateway returned a truncated PNG")
            if zlib.crc32(data[offset + 4:end]) != int.from_bytes(data[end:end + 4], "big"):
                raise ImageGenerationError("Gateway returned a PNG with an invalid checksum")
            if offset == 8:
                if chunk_type != b"IHDR" or length != 13:
                    raise ImageGenerationError("Gateway returned an invalid PNG header")
                width, height = struct.unpack(">II", data[offset + 8:offset + 16])
            offset = end + 4
            if chunk_type == b"IEND":
                ended = True
                break
        if not ended or not width or not height:
            raise ImageGenerationError("Gateway returned an incomplete PNG")
    else:
        try:
            with Image.open(io.BytesIO(data)) as image:
                image.load()
                width, height = image.size
                buffer = io.BytesIO()
                suffix = output.suffix.lower()
                if suffix in (".jpg", ".jpeg"):
                    image.convert("RGB").save(buffer, format="JPEG", quality=95)
                elif suffix == ".webp":
                    image.save(buffer, format="WEBP", quality=95)
                elif suffix == ".png":
                    image.save(buffer, format="PNG")
                else:
                    raise ImageGenerationError("Output extension must be .png, .jpg, .jpeg, or .webp")
                data = buffer.getvalue()
        except (OSError, ValueError):
            raise ImageGenerationError("Gateway result is not a valid image") from None
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(output)
    return {"width": width, "height": height, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def generate_image(*, prompt: str, output: Path, model: str, base_url: str,
                   api_key: str, size: str = "1080x1440", style: str | None = None,
                   timeout: float = 180) -> dict:
    if not prompt.strip():
        raise ImageGenerationError("Prompt must not be empty")
    if not model or not base_url or not api_key:
        raise ImageGenerationError("Missing CONTENT_OPS_IMAGE_MODEL, CONTENT_OPS_BASE_URL, or CONTENT_OPS_API_KEY")
    if urlparse(base_url).scheme != "https":
        raise ImageGenerationError("The company gateway base URL must use HTTPS")
    if style:
        prompt = f"{prompt}\n视觉风格：{style}。"
    endpoint = base_url.rstrip("/") + "/images/generations"
    response = request_json(endpoint, {"model": model, "prompt": prompt, "size": size, "n": 1, "watermark": False}, api_key, timeout)
    kind, value = image_reference(response)
    image_info = write_image(read_image(kind, value, timeout), output)
    result = {"output": str(output.resolve()), "model": model, "endpoint": endpoint, "requested_size": size, **image_info}
    result['usage'] = response.get('usage', {})
    request_id = response.get("metadata", {}).get("request_id") or response.get("request_id")
    if request_id:
        result["request_id"] = request_id
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    prompt_group = parser.add_mutually_exclusive_group(required=True)
    prompt_group.add_argument("--prompt")
    prompt_group.add_argument("--prompt-file", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--style", help="Optional style, for example cartoon, realistic, or flat")
    parser.add_argument("--config", type=Path, default=ROOT / "scratch" / "gateway.env")
    parser.add_argument("--model", help="Overrides CONTENT_OPS_IMAGE_MODEL")
    parser.add_argument("--base-url", help="Overrides CONTENT_OPS_BASE_URL; include /v1")
    parser.add_argument("--api-key-env", default="CONTENT_OPS_API_KEY")
    parser.add_argument("--size", default="1080x1440")
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--metadata-output", type=Path)
    args = parser.parse_args(argv)
    try:
        settings = load_config(args.config)
        prompt = args.prompt if args.prompt is not None else args.prompt_file.read_text(encoding="utf-8")
        result = generate_image(prompt=prompt, output=args.output, model=args.model or settings.get("CONTENT_OPS_IMAGE_MODEL", ""),
                                base_url=args.base_url or settings.get("CONTENT_OPS_BASE_URL", ""),
                                api_key=settings.get(args.api_key_env, ""), size=args.size, style=args.style, timeout=args.timeout)
        if args.metadata_output:
            args.metadata_output.parent.mkdir(parents=True, exist_ok=True)
            args.metadata_output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ImageGenerationError, OSError) as error:
        print(f"Image generation failed: {error}", file=sys.stderr)
        return 1


