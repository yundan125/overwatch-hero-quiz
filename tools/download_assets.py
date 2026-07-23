#!/usr/bin/env python3
"""下载、筛选并校验《守望先锋》英雄图标与全身图。

数据发现依赖 Overwatch Fandom 的 MediaWiki API；网页游戏运行时不联网。
脚本不会把英雄名写入本地图片文件名。执行完成后会重写 heroes.js。

用法：
    python tools/download_assets.py
    python tools/download_assets.py --force --workers 6
    python tools/download_assets.py --strict

可选：安装 Pillow 后，脚本会把图片压缩为 WebP；未安装时保留原始格式。
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import html
import io
import json
import os
import re
import shutil
import struct
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
HEROES_JS = ROOT / "heroes.js"
ICON_DIR = ROOT / "assets" / "icons"
FULLBODY_DIR = ROOT / "assets" / "fullbody"
REPORT_PATH = ROOT / "asset_report.json"
FANDOM_API = "https://overwatch.fandom.com/api.php"
USER_AGENT = "OverwatchHeroQuizAssetBuilder/1.0 (personal non-commercial project)"
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif")

try:
    from PIL import Image  # type: ignore
except Exception:
    Image = None


@dataclass
class ImageInfo:
    title: str
    url: str
    width: int
    height: int
    size: int
    mime: str
    sha1: str = ""
    score: float = 0.0


@dataclass
class AssetResult:
    hero_id: str
    kind: str
    status: str
    path: str = ""
    source_url: str = ""
    source_title: str = ""
    width: int = 0
    height: int = 0
    size: int = 0
    sha256: str = ""
    note: str = ""


class InfoboxImageParser(HTMLParser):
    """提取 Fandom portable infobox 内的图片文件名和 URL。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.in_infobox = False
        self.items: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {k: (v or "") for k, v in attrs}
        classes = data.get("class", "").split()
        if tag == "aside" and ("portable-infobox" in classes or "pi-item" in classes):
            self.in_infobox = True
            self.depth = 1
        elif self.in_infobox:
            self.depth += 1

        if not self.in_infobox:
            return
        key = data.get("data-image-key", "")
        if key:
            self.items.append(key)
        if tag == "img":
            for attr in ("data-src", "src", "data-original"):
                value = data.get(attr, "")
                if value:
                    self.items.append(value)

    def handle_endtag(self, tag: str) -> None:
        if self.in_infobox:
            self.depth -= 1
            if self.depth <= 0:
                self.in_infobox = False
                self.depth = 0


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def unique(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        item = html.unescape(item).strip()
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def read_heroes() -> list[dict[str, Any]]:
    text = HEROES_JS.read_text("utf-8")
    match = re.search(r"window\.HEROES\s*=\s*(\[.*\])\s*;", text, flags=re.S)
    if not match:
        raise RuntimeError("无法从 heroes.js 读取 window.HEROES 数组。")
    data = json.loads(match.group(1))
    if not isinstance(data, list):
        raise RuntimeError("heroes.js 中的英雄数据不是数组。")
    return data


def request_bytes(url: str, timeout: float, retries: int = 3) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                    "Referer": "https://overwatch.fandom.com/",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"下载失败：{url}（{last_error}）")


def api_json(params: dict[str, Any], timeout: float) -> dict[str, Any]:
    query = {"format": "json", "formatversion": "2", "origin": "*", **params}
    url = FANDOM_API + "?" + urllib.parse.urlencode(query)
    raw = request_bytes(url, timeout)
    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Fandom API 返回了无法解析的数据：{url}") from exc
    if "error" in result:
        raise RuntimeError(f"Fandom API 错误：{result['error']}")
    return result


def image_info(file_name_or_title: str, timeout: float) -> ImageInfo | None:
    title = file_name_or_title.strip()
    if title.startswith("http://") or title.startswith("https://"):
        return None
    if not title.lower().startswith("file:"):
        title = "File:" + title.replace("_", " ")
    result = api_json(
        {
            "action": "query",
            "titles": title,
            "redirects": 1,
            "prop": "imageinfo",
            "iiprop": "url|size|mime|sha1",
        },
        timeout,
    )
    pages = result.get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing"):
        return None
    infos = pages[0].get("imageinfo") or []
    if not infos:
        return None
    info = infos[0]
    return ImageInfo(
        title=pages[0].get("title", title),
        url=info.get("url", ""),
        width=int(info.get("width") or 0),
        height=int(info.get("height") or 0),
        size=int(info.get("size") or 0),
        mime=info.get("mime", ""),
        sha1=info.get("sha1", ""),
    )


def page_material(page_title: str, timeout: float) -> tuple[str, list[str], str]:
    """返回解析后 HTML、页面图片名列表、原始 wikitext。"""
    parsed = api_json(
        {"action": "parse", "page": page_title, "prop": "text|images", "disablelimitreport": 1},
        timeout,
    ).get("parse", {})
    html_text = parsed.get("text", "")
    image_names = parsed.get("images", []) or []

    wikitext = ""
    try:
        raw_result = api_json(
            {
                "action": "query",
                "titles": page_title,
                "prop": "revisions",
                "rvprop": "content",
                "rvslots": "main",
            },
            timeout,
        )
        pages = raw_result.get("query", {}).get("pages", [])
        if pages and not pages[0].get("missing"):
            revisions = pages[0].get("revisions") or []
            if revisions:
                slots = revisions[0].get("slots") or {}
                wikitext = (slots.get("main") or {}).get("content", "") or revisions[0].get("content", "") or ""
    except Exception:
        # 部分 Fandom 实例会限制 revision 内容接口；parse.images 和 infobox HTML 仍可使用。
        pass
    return html_text, image_names, wikitext


def extract_file_name(value: str) -> str:
    value = html.unescape(value)
    if value.startswith("http://") or value.startswith("https://"):
        parsed = urllib.parse.urlparse(value)
        name = urllib.parse.unquote(Path(parsed.path).name)
        # Fandom 缩略图 URL 可能以 /revision/... 结尾，文件名在 static 路径较前位置。
        match = re.search(r"/images/(?:thumb/)?(?:[^/]+/){2}([^/]+?\.(?:png|jpe?g|webp|gif))(?:/|$)", parsed.path, re.I)
        if match:
            return match.group(1)
        return name
    value = value.removeprefix("File:").removeprefix("Image:")
    value = value.split("|")[0].split("]]")[0].strip()
    return value


def wikitext_image_candidates(wikitext: str) -> list[str]:
    candidates: list[str] = []
    patterns = [
        r"\|\s*(?:image|image1|image2|image_?ow2|portrait|render)\s*=\s*(?:\[\[(?:File|Image):)?([^\]\n|]+?\.(?:png|jpe?g|webp|gif))",
        r"\[\[(?:File|Image):([^\]|]+?\.(?:png|jpe?g|webp|gif))",
    ]
    for pattern in patterns:
        candidates.extend(re.findall(pattern, wikitext, flags=re.I))
    return unique(extract_file_name(item) for item in candidates)


def score_fullbody_name(file_name: str, hero: dict[str, Any], infobox_rank: int | None) -> float:
    base = Path(file_name).name.lower()
    normalized = normalize_text(base)
    hero_tokens = [normalize_text(hero.get("nameEn", "")), normalize_text(hero.get("download", {}).get("fandomTitle", ""))]
    score = 0.0

    hard_reject = (
        "ability", "skill", "spray", "playericon", "avatar", "achievement", "map", "logo",
        "banner", "wallpaper", "cinematic", "comic", "story", "trailer", "weapon", "emote",
        "highlightintro", "voice", "crosshair", "hud", "screenshot", "gallery", "concept",
    )
    if any(token in normalized for token in hard_reject):
        return -1000.0
    if normalized.startswith("icon") or "heroselect" in normalized:
        return -1000.0

    if any(token and token in normalized for token in hero_tokens):
        score += 90
    if "ow2" in normalized or "overwatch2" in normalized:
        score += 45
    elif "ow1" in normalized or "overwatch1" in normalized:
        score += 12
    for token, weight in (("render", 38), ("full", 32), ("default", 28), ("classic", 18), ("hero", 12), ("portrait", 8)):
        if token in normalized:
            score += weight
    if "skin" in normalized:
        score -= 55
    if infobox_rank is not None:
        score += max(70 - infobox_rank * 10, 20)
    if base.endswith(".png") or base.endswith(".webp"):
        score += 8
    return score


def score_fullbody_info(info: ImageInfo, name_score: float) -> float:
    if name_score <= -900:
        return name_score
    if info.width < 320 or info.height < 320:
        return -900
    ratio = info.height / max(info.width, 1)
    score = name_score
    if ratio >= 1.25:
        score += 60
    elif ratio >= 0.9:
        score += 36
    elif ratio >= 0.68:
        score += 10
    else:
        score -= 90
    if info.height >= 900:
        score += 22
    elif info.height >= 600:
        score += 12
    if info.width * info.height >= 1_000_000:
        score += 12
    if info.mime in ("image/png", "image/webp"):
        score += 8
    if info.size < 4_000:
        score -= 200
    return score


def discover_fullbody(hero: dict[str, Any], timeout: float) -> list[ImageInfo]:
    page_title = hero["download"]["fandomTitle"]
    html_text, page_images, wikitext = page_material(page_title, timeout)
    parser = InfoboxImageParser()
    try:
        parser.feed(html_text)
    except Exception:
        pass

    infobox_files = unique(extract_file_name(item) for item in parser.items)
    raw_files = wikitext_image_candidates(wikitext)
    candidates = unique([*infobox_files, *raw_files, *page_images])
    infobox_rank = {name: rank for rank, name in enumerate(infobox_files)}

    prescored: list[tuple[float, str]] = []
    for file_name in candidates:
        if not file_name.lower().endswith(IMAGE_EXTENSIONS):
            continue
        score = score_fullbody_name(file_name, hero, infobox_rank.get(file_name))
        if score > -900:
            prescored.append((score, file_name))
    prescored.sort(reverse=True)

    found: list[ImageInfo] = []
    # 限制 API 请求数量；高分候选通常集中在前部。
    for name_score, file_name in prescored[:32]:
        try:
            info = image_info(file_name, timeout)
        except Exception:
            continue
        if not info or not info.url:
            continue
        info.score = score_fullbody_info(info, name_score)
        if info.score > -800:
            found.append(info)
    found.sort(key=lambda item: item.score, reverse=True)
    return found


def discover_icon(hero: dict[str, Any], timeout: float) -> list[ImageInfo]:
    exact = hero["download"]["iconFile"]
    title = hero["download"]["fandomTitle"]
    candidates = unique([
        exact,
        f"Icon-{title}.png",
        f"{title} Hero.png",
        f"{title} hero select.png",
        f"{title} portrait.png",
    ])
    found: list[ImageInfo] = []
    for rank, candidate in enumerate(candidates):
        try:
            info = image_info(candidate, timeout)
        except Exception:
            continue
        if not info or not info.url:
            continue
        ratio = info.width / max(info.height, 1)
        score = 100 - rank * 12
        if 0.82 <= ratio <= 1.22:
            score += 45
        else:
            score -= 80
        if info.width >= 256 and info.height >= 256:
            score += 20
        if "icon-" in info.title.lower():
            score += 25
        if info.size < 2_000:
            score -= 150
        info.score = score
        found.append(info)
    found.sort(key=lambda item: item.score, reverse=True)
    return found


def sniff_dimensions(data: bytes) -> tuple[str, int, int]:
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        width, height = struct.unpack(">II", data[16:24])
        return "png", width, height
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X" and len(data) >= 30:
            width = 1 + int.from_bytes(data[24:27], "little")
            height = 1 + int.from_bytes(data[27:30], "little")
            return "webp", width, height
        if chunk == b"VP8 " and len(data) >= 30:
            start = data.find(b"\x9d\x01\x2a", 20, 40)
            if start >= 0 and len(data) >= start + 7:
                width, height = struct.unpack("<HH", data[start + 3:start + 7])
                return "webp", width & 0x3FFF, height & 0x3FFF
        if chunk == b"VP8L" and len(data) >= 25:
            bits = int.from_bytes(data[21:25], "little")
            width = (bits & 0x3FFF) + 1
            height = ((bits >> 14) & 0x3FFF) + 1
            return "webp", width, height
        return "webp", 0, 0
    if data.startswith(b"\xff\xd8"):
        index = 2
        while index + 9 < len(data):
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            index += 2
            if marker in (0xD8, 0xD9):
                continue
            if index + 2 > len(data):
                break
            length = int.from_bytes(data[index:index + 2], "big")
            if marker in range(0xC0, 0xC4) and index + 7 < len(data):
                height = int.from_bytes(data[index + 3:index + 5], "big")
                width = int.from_bytes(data[index + 5:index + 7], "big")
                return "jpg", width, height
            index += max(length, 2)
    if data.startswith((b"GIF87a", b"GIF89a")) and len(data) >= 10:
        width, height = struct.unpack("<HH", data[6:10])
        return "gif", width, height
    raise RuntimeError("文件不是受支持的 PNG/JPEG/WebP/GIF 图片。")


def encode_for_web(data: bytes, kind: str) -> tuple[bytes, str, int, int]:
    original_ext, width, height = sniff_dimensions(data)
    if Image is None:
        return data, original_ext, width, height
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            max_size = (512, 512) if kind == "icon" else (1400, 1600)
            image.thumbnail(max_size, Image.Resampling.LANCZOS)
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            output = io.BytesIO()
            image.save(output, "WEBP", quality=88, method=6, lossless=(kind == "icon"))
            return output.getvalue(), "webp", image.width, image.height
    except Exception:
        return data, original_ext, width, height


def clean_existing(prefix: str, directory: Path) -> None:
    for path in directory.glob(prefix + ".*"):
        if path.is_file():
            path.unlink()
    for path in directory.glob(prefix + "_b.*"):
        if path.is_file():
            path.unlink()


def download_candidate(hero: dict[str, Any], kind: str, info: ImageInfo, suffix: str, timeout: float, force: bool) -> AssetResult:
    directory = ICON_DIR if kind == "icon" else FULLBODY_DIR
    prefix = hero["id"] + suffix
    try:
        raw = request_bytes(info.url, timeout)
        if len(raw) < 2_000:
            raise RuntimeError(f"文件过小（{len(raw)} 字节）")
        if len(raw) > 60 * 1024 * 1024:
            raise RuntimeError(f"文件过大（{len(raw)} 字节）")
        encoded, extension, width, height = encode_for_web(raw, kind)
        if not width or not height:
            _, width, height = sniff_dimensions(raw)
        if kind == "icon" and not (0.72 <= width / max(height, 1) <= 1.38):
            raise RuntimeError(f"图标宽高比异常：{width}×{height}")
        if kind == "fullbody" and (width < 280 or height < 320 or width / max(height, 1) > 2.2):
            raise RuntimeError(f"全身图尺寸或宽高比异常：{width}×{height}")
        directory.mkdir(parents=True, exist_ok=True)
        clean_existing(prefix, directory)
        target = directory / f"{prefix}.{extension}"
        temp = target.with_suffix(target.suffix + ".part")
        temp.write_bytes(encoded)
        temp.replace(target)
        digest = hashlib.sha256(encoded).hexdigest()
        return AssetResult(
            hero_id=hero["id"], kind=kind, status="ok",
            path=target.relative_to(ROOT).as_posix(), source_url=info.url,
            source_title=info.title, width=width, height=height,
            size=len(encoded), sha256=digest,
            note=f"候选评分 {info.score:.1f}" + ("；已转 WebP" if extension == "webp" and Image is not None else ""),
        )
    except Exception as exc:
        return AssetResult(hero_id=hero["id"], kind=kind, status="error", source_url=info.url, source_title=info.title, note=str(exc))


def process_hero(hero: dict[str, Any], timeout: float, force: bool) -> tuple[dict[str, Any], list[AssetResult]]:
    updated = json.loads(json.dumps(hero, ensure_ascii=False))
    results: list[AssetResult] = []
    try:
        icons = discover_icon(hero, timeout)
    except Exception as exc:
        icons = []
        results.append(AssetResult(hero["id"], "icon", "error", note=f"发现图标失败：{exc}"))
    try:
        fullbodies = discover_fullbody(hero, timeout)
    except Exception as exc:
        fullbodies = []
        results.append(AssetResult(hero["id"], "fullbody", "error", note=f"发现全身图失败：{exc}"))

    for kind, candidates in (("icon", icons), ("fullbody", fullbodies)):
        successful: list[AssetResult] = []
        attempted_urls: set[str] = set()
        for candidate in candidates:
            if candidate.url in attempted_urls:
                continue
            attempted_urls.add(candidate.url)
            suffix = "" if not successful else "_b"
            result = download_candidate(hero, kind, candidate, suffix, timeout, force)
            results.append(result)
            if result.status == "ok":
                successful.append(result)
            if len(successful) >= 2:
                break
        if not successful:
            results.append(AssetResult(hero["id"], kind, "missing", note="没有找到通过校验的候选图片"))
            continue
        updated[kind] = successful[0].path
        updated[kind + "Fallbacks"] = [item.path for item in successful[1:]]
        source_key = "iconImage" if kind == "icon" else "fullbodyImage"
        updated.setdefault("sources", {})[source_key] = successful[0].source_url
        updated["sources"][source_key.replace("Image", "File")] = successful[0].source_title
    return updated, results


def validate_all(heroes: list[dict[str, Any]], results: list[AssetResult]) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    sha_map: dict[str, list[str]] = {}

    for hero in heroes:
        if hero.get("id") in seen_ids:
            errors.append(f"重复 ID：{hero.get('id')}")
        seen_ids.add(hero.get("id", ""))
        if hero.get("nameZh") in seen_names:
            errors.append(f"重复中文名：{hero.get('nameZh')}")
        seen_names.add(hero.get("nameZh", ""))
        for kind in ("icon", "fullbody"):
            value = hero.get(kind, "")
            if not value:
                errors.append(f"{hero.get('id')} 缺少 {kind} 路径")
            elif hero.get("nameEn", "").lower().replace(" ", "") in Path(value).name.lower():
                errors.append(f"{hero.get('id')} 的文件名可能泄露答案：{value}")

    for result in results:
        if result.status == "ok":
            sha_map.setdefault(result.sha256, []).append(f"{result.hero_id}/{result.kind}/{result.path}")
        elif result.status in ("missing", "error"):
            warnings.append(f"{result.hero_id}/{result.kind}: {result.note}")
    duplicates = [items for items in sha_map.values() if len(items) > 1]
    for items in duplicates:
        errors.append("重复图片：" + "；".join(items))

    primary_ok = {(item.hero_id, item.kind) for item in results if item.status == "ok" and "_b." not in item.path}
    for hero in heroes:
        for kind in ("icon", "fullbody"):
            if (hero["id"], kind) not in primary_ok:
                errors.append(f"{hero['id']} 缺少通过校验的主 {kind} 图片")

    return {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "heroCount": len(heroes),
        "roleCounts": {
            "tank": sum(1 for h in heroes if h.get("role") == "tank"),
            "damage": sum(1 for h in heroes if h.get("role") == "damage"),
            "support": sum(1 for h in heroes if h.get("role") == "support"),
        },
        "pillowEnabled": Image is not None,
        "okAssets": sum(1 for item in results if item.status == "ok"),
        "errors": errors,
        "warnings": warnings,
        "duplicates": duplicates,
        "assetsReady": not errors,
        "results": [asdict(item) for item in results],
    }


def write_heroes(heroes: list[dict[str, Any]], assets_ready: bool) -> None:
    header = "/* 由 tools/download_assets.py 更新图片路径与来源。不要手动把答案写入文件名。 */\n"
    body = json.dumps(heroes, ensure_ascii=False, separators=(",", ":"), indent=2)
    HEROES_JS.write_text(
        header + f"window.ASSETS_READY = {'true' if assets_ready else 'false'};\nwindow.HEROES = {body};\n",
        "utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="下载并校验守望先锋英雄图标和全身图")
    parser.add_argument("--workers", type=int, default=4, help="并发英雄数，默认 4")
    parser.add_argument("--timeout", type=float, default=30.0, help="单次网络请求超时秒数，默认 30")
    parser.add_argument("--force", action="store_true", help="覆盖已有图片")
    parser.add_argument("--strict", action="store_true", help="存在任何缺失或重复资源时返回非零状态")
    args = parser.parse_args()

    heroes = read_heroes()
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    FULLBODY_DIR.mkdir(parents=True, exist_ok=True)
    print(f"准备处理 {len(heroes)} 名英雄；并发数 {max(1, args.workers)}。")
    if Image is None:
        print("提示：未检测到 Pillow，将保留原始图片格式。安装 Pillow 可自动压缩为 WebP。")

    indexed_results: dict[int, tuple[dict[str, Any], list[AssetResult]]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(process_hero, hero, args.timeout, args.force): index
            for index, hero in enumerate(heroes)
        }
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            index = futures[future]
            hero = heroes[index]
            try:
                indexed_results[index] = future.result()
                completed += 1
                print(f"[{completed:02d}/{len(heroes)}] {hero['id']} {hero['nameZh']}：完成")
            except Exception as exc:
                indexed_results[index] = (hero, [AssetResult(hero["id"], "all", "error", note=str(exc))])
                completed += 1
                eprint(f"[{completed:02d}/{len(heroes)}] {hero['id']} {hero['nameZh']}：失败：{exc}")

    updated_heroes: list[dict[str, Any]] = []
    all_results: list[AssetResult] = []
    for index in range(len(heroes)):
        updated, results = indexed_results[index]
        updated_heroes.append(updated)
        all_results.extend(results)

    report = validate_all(updated_heroes, all_results)
    write_heroes(updated_heroes, bool(report["assetsReady"]))
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")

    print(f"完成：{report['okAssets']} 个图片文件通过校验。")
    print(f"校验错误：{len(report['errors'])}；警告：{len(report['warnings'])}。")
    print(f"报告：{REPORT_PATH.relative_to(ROOT)}")
    if report["errors"]:
        for message in report["errors"][:20]:
            eprint("错误：", message)
        if len(report["errors"]) > 20:
            eprint(f"其余 {len(report['errors']) - 20} 项见 asset_report.json。")
    return 1 if args.strict and report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
