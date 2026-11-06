"""精简 JSONL 素材库，只保留标题、正文和图片。

源文件是 ``data/posts.jsonl``，输出是可随时删除并按以下命令重建的派生文件：

    PYTHONPATH=scripts scratch/.venv/bin/python3 scripts/build.py compact-posts

默认输出 ``data/posts-clean.jsonl``。处理过程中不会修改源文件；输出先写入同目录
临时文件，成功后再原子替换目标文件，避免中途失败留下半成品。
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tempfile


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = ROOT / "data/posts.jsonl"
DEFAULT_OUTPUT = ROOT / "data/posts-clean.jsonl"


def _required_text(record: dict, field: str, line_number: int) -> str:
    """读取必须为字符串的文本字段，不对内容做 trim 或其他改写。"""
    value = record.get(field)
    if not isinstance(value, str):
        raise ValueError(
            f"第 {line_number} 行的 {field!r} 必须是字符串，实际为 {type(value).__name__}"
        )
    return value


def _images(record: dict, line_number: int) -> list:
    """按 images -> image_urls 的优先级选取非空图片列表。"""
    for field in ("images", "image_urls"):
        value = record.get(field)
        if value is None:
            continue
        if not isinstance(value, list):
            raise ValueError(
                f"第 {line_number} 行的 {field!r} 必须是图片列表，实际为 {type(value).__name__}"
            )
        if value:
            return value
    raise ValueError(f"第 {line_number} 行没有可用图片：'images' 和 'image_urls' 都为空")


def compact_record(record: dict, line_number: int) -> dict:
    """把一条原始记录投影为固定的三字段结构。"""
    if not isinstance(record, dict):
        raise ValueError(f"第 {line_number} 行必须是 JSON 对象，实际为 {type(record).__name__}")
    return {
        "title": _required_text(record, "title", line_number),
        "body": _required_text(record, "body", line_number),
        "images": _images(record, line_number),
    }


def compact_posts(source: Path, target: Path) -> int:
    """流式精简 source，并将结果原子写入 target，返回输出记录数。"""
    source = source.expanduser().resolve()
    target = target.expanduser().resolve()
    if source == target:
        raise ValueError("输入文件和输出文件不能是同一个路径")
    if not source.is_file():
        raise FileNotFoundError(f"输入文件不存在：{source}")

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    count = 0
    try:
        descriptor, temporary_path = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".tmp", dir=target.parent
        )
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as output:
            with source.open("r", encoding="utf-8", newline="") as input_file:
                for line_number, raw_line in enumerate(input_file, 1):
                    if not raw_line.strip():
                        continue
                    try:
                        record = json.loads(raw_line)
                    except json.JSONDecodeError as exc:
                        raise ValueError(f"第 {line_number} 行不是合法 JSON：{exc.msg}") from exc
                    output.write(
                        json.dumps(
                            compact_record(record, line_number),
                            ensure_ascii=False,
                            separators=(",", ":"),
                        )
                    )
                    output.write("\n")
                    count += 1
        os.replace(temporary_path, target)
        temporary_path = None
    finally:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
    return count


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="从 JSONL 素材库中只保留 title、body、images 三个字段"
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"输入 JSONL，默认：{DEFAULT_INPUT}",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"输出 JSONL，默认：{DEFAULT_OUTPUT}",
    )
    args = parser.parse_args(argv)
    try:
        count = compact_posts(args.input, args.output)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(f"已精简 {count} 条记录：{args.output.expanduser().resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
