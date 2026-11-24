"""Build a local-only Debian package from a staged official Electron runtime."""
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

runtime, node_arch, version, output = sys.argv[1:]
arch, machine = {"x64": ("amd64", 62), "arm64": ("arm64", 183)}[node_arch]
if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
    raise ValueError("Invalid package version")


def scan_runtime(directory):
    requirements = []
    for file in directory.rglob("*"):
        if not file.is_file():
            continue
        with file.open("rb") as binary:
            header = binary.read(20)
        if not header.startswith(b"\x7fELF"):
            continue
        if header[4:6] != b"\x02\x01" or struct.unpack_from("<H", header, 18)[0] != machine:
            raise ValueError(f"Incorrect ELF architecture: {file}")
        info = subprocess.check_output(["readelf", "-W", "-V", file], text=True)
        requirements.extend(tuple(map(int, match.split(".")))
                            for match in re.findall(r"Name: GLIBC_(\d+(?:\.\d+)+)", info))
    minimum = max(requirements)
    if arch == "arm64" and minimum > (2, 31):
        raise ValueError(f"Runtime exceeds Kylin V10 glibc 2.31 baseline: {minimum}")
    return ".".join(map(str, minimum))


def put(root, name, data, mode=0o644):
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(data.rstrip() + "\n", encoding="utf-8")
    target.chmod(mode)


os.umask(0o022)
with tempfile.TemporaryDirectory(dir=output) as temp:
    root = Path(temp)
    install = root / "opt/readbox"
    shutil.copytree(runtime, install, symlinks=True)
    minimum = scan_runtime(install)
    for file in install.rglob("*"):
        if not file.is_symlink():
            file.chmod(0o755 if file.is_dir() or os.access(file, os.X_OK) else 0o644)
    install.chmod(0o755)
    (install / "chrome-sandbox").chmod(0o4755)
    put(root, "opt/readbox/runtime-report.json", json.dumps({
        "architecture": arch, "minimumGlibc": minimum, "systemWebViewRequired": False
    }, indent=2))
    put(root, "usr/share/applications/io.github.suyh1.readbox.desktop", """
[Desktop Entry]
Type=Application
Name=ReadBox
Comment=EPUB 阅读器
Exec=/opt/readbox/readbox
Terminal=false
Categories=Office;Viewer;
""".strip())
    (root / "usr/bin").mkdir(parents=True)
    (root / "usr/bin/readbox").symlink_to("/opt/readbox/readbox")
    depends = (f"libc6 (>= {minimum}), libgtk-3-0 (>= 3.24), libnss3, libnspr4, "
               "libatk1.0-0, libatk-bridge2.0-0, libatspi2.0-0, libcups2, libdrm2, "
               "libdbus-1-3, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, "
               "libxfixes3, libxrandr2, libgbm1, libexpat1, libxkbcommon0, libasound2, "
               "libpango-1.0-0, libcairo2, libglib2.0-0")
    put(root, "DEBIAN/control", f"""Package: readbox
Version: {version}-1
Section: text
Priority: optional
Architecture: {arch}
Maintainer: ReadBox <suyh1@users.noreply.github.com>
Depends: {depends}
Description: ReadBox offline EPUB reader framework with bundled Chromium
""")
    package = Path(output) / f"ReadBox-{version}-linux-{arch}.deb"
    # TemporaryDirectory uses mode 0700. The archive's root must be traversable.
    root.chmod(0o755)
    subprocess.run(["dpkg-deb", "--root-owner-group", "-Zgzip", "-z6", "--build", root, package], check=True)
