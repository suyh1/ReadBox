"""Create Chinese release notes and verify the complete set of platform packages."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
CATEGORIES = ("新增", "改进", "修复", "兼容性")


def notes():
    groups = {key: [] for key in CATEGORIES}
    for file in sorted((ROOT / "notes" / VERSION).glob("*.json")):
        fragment = json.loads(file.read_text(encoding="utf-8"))
        for group, entries in fragment.items():
            if group not in groups or not isinstance(entries, list):
                raise ValueError(f"无效的分类或条目：{file}")
            for entry in entries:
                if not isinstance(entry, str) or "\n" in entry or not re.search(r"[\u3400-\u9fff]", entry):
                    raise ValueError(f"条目需要单行中文说明：{file}")
                groups[group].append(entry)
    if not any(groups.values()):
        raise ValueError(f"缺少 notes/{VERSION} 下的中文更新说明")
    lines = [f"## ReadBox {VERSION} 更新内容"]
    for group, entries in groups.items():
        if entries:
            lines.extend(["", f"### {group}", ""] + [f"- {entry}" for entry in entries])
    return "\n".join(lines)


def checksums(directory):
    suffixes = ["windows-x64.exe", "linux-amd64.deb", "linux-arm64.deb"]
    suffixes.extend(f"android-{abi}.apk" for abi in ("arm64-v8a", "armeabi-v7a", "x86_64"))
    files = [directory / f"ReadBox-{VERSION}-{suffix}" for suffix in suffixes]
    if sorted(directory.iterdir()) != sorted(files):
        raise ValueError("发布目录必须包含与版本匹配的桌面安装包和三种架构的 APK")
    lines = []
    for file in files:
        if not file.is_file() or not file.stat().st_size:
            raise ValueError(f"安装包为空或缺失：{file}")
        with file.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        lines.append(f"{digest}  {file.name}")
    (directory / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")


parser = argparse.ArgumentParser()
parser.add_argument("action", choices=["notes", "prepare"])
parser.add_argument("--tag")
parser.add_argument("--assets", type=Path)
args = parser.parse_args()
if args.tag and args.tag != "v" + VERSION:
    parser.error("标签与 package.json 的版本不一致")
body = notes()
if args.action == "prepare":
    if not args.assets or not args.tag:
        parser.error("发布必须提供标签和产物目录")
    checksums(args.assets)
print(body)
