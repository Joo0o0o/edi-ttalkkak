#!/usr/bin/env python3
"""아이밸런스 EDI 차트생성기 빌드.

src/ 하나에서 두 가지를 만든다.
- Chrome 확장(사이드 패널): dist/edi-ttalkkak-v<버전>/ 과 같은 이름의 .zip (릴리스에 올리는 파일)
- 단독 HTML(시험용 하네스, 배포하지 않음): --standalone 경로로만 만든다

사용:  python3 build.py                   확장 폴더와 ZIP을 다시 만든다
       python3 build.py --check           dist/의 확장 폴더·ZIP이 현재 소스 빌드와 같은지만 확인(쓰지 않음)
       python3 build.py --standalone OUT  시험용 단독 HTML을 OUT에 쓴다
"""
import hashlib
import io
import json
import pathlib
import struct
import sys
import zipfile
import zlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "src"
MANIFEST = json.loads((SRC / "manifest.json").read_text("utf-8"))
VERSION = MANIFEST["version"]
OUT_DIR = HERE / "dist"
EXT_NAME = f"edi-ttalkkak-v{VERSION}"
EXT_DIR = OUT_DIR / EXT_NAME
EXT_ZIP = OUT_DIR / f"{EXT_NAME}.zip"
PANEL_SCRIPTS = ["edi-core.js", "app.js", "capture.js", "panel.js"]
CSP_META = '<meta http-equiv="Content-Security-Policy"'


def read(name: str) -> str:
    return (SRC / name).read_text("utf-8")


def template() -> str:
    return read("index.html").replace("__VERSION__", VERSION)


def standalone_html() -> bytes:
    html = template()
    css = read("styles.css")
    js = "\n".join(read(name) for name in ["edi-core.js", "app.js"])
    if "</style" in css.lower():
        raise SystemExit("styles.css must not contain </style")
    if "</script" in js.lower() or "<!--" in js:
        raise SystemExit("scripts must not contain </script or <!--")
    for marker, payload in (("/*__STYLE__*/", css), ("/*__SCRIPT__*/", js)):
        if html.count(marker) != 1:
            raise SystemExit(f"marker {marker} must appear exactly once")
        html = html.replace(marker, payload)
    return html.encode("utf-8")


def panel_html() -> bytes:
    lines = [line for line in template().splitlines() if CSP_META not in line]
    html = "\n".join(lines) + "\n"
    style = '<link rel="stylesheet" href="styles.css">'
    scripts = "\n".join(f'<script src="{name}"></script>' for name in PANEL_SCRIPTS)
    for marker, payload in (("<style>/*__STYLE__*/</style>", style), ("<script>/*__SCRIPT__*/</script>", scripts)):
        if html.count(marker) != 1:
            raise SystemExit(f"marker {marker} must appear exactly once")
        html = html.replace(marker, payload)
    return html.encode("utf-8")


def png_icon(size: int) -> bytes:
    """브랜드 갈색 바탕의 문서 아이콘(외부 도구 없이 직접 그림)."""
    bg, page, ink = (0x55, 0x44, 0x3A, 255), (0xFC, 0xFA, 0xF7, 255), (0xB8, 0x9F, 0x81, 255)
    radius = size * 0.22
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            cx, cy = x + 0.5, y + 0.5
            dx = max(radius - cx, 0, cx - (size - radius))
            dy = max(radius - cy, 0, cy - (size - radius))
            inside = dx * dx + dy * dy <= radius * radius
            color = (0, 0, 0, 0)
            if inside:
                color = bg
                if 0.27 * size <= cx <= 0.73 * size and 0.17 * size <= cy <= 0.83 * size:
                    color = page
                    thick = max(1.0, size * 0.065)
                    for line_y, right in ((0.33, 0.64), (0.47, 0.64), (0.61, 0.56)):
                        if 0.36 * size <= cx <= right * size and abs(cy - line_y * size - thick / 2) <= thick / 2:
                            color = ink
            row.extend(color)
        rows.append(bytes(row))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")


def extension_files() -> dict:
    files = {
        "manifest.json": (json.dumps(MANIFEST, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        "sw.js": read("sw.js").encode("utf-8"),
        "sidepanel.html": panel_html(),
        "styles.css": read("styles.css").encode("utf-8"),
    }
    for name in PANEL_SCRIPTS:
        files[name] = read(name).encode("utf-8")
    for size in (16, 32, 48, 128):
        files[f"icons/icon-{size}.png"] = png_icon(size)
    return files


def zip_bytes(files: dict) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(f"{EXT_NAME}/{name}", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, files[name])
    return buffer.getvalue()


def write_extension(files: dict) -> None:
    EXT_DIR.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        target = EXT_DIR / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    # 이 빌드가 만든 폴더 안에서만, 소스에 없는 옛 파일을 지운다.
    for path in sorted(EXT_DIR.rglob("*"), reverse=True):
        rel = path.relative_to(EXT_DIR).as_posix()
        if path.is_file() and rel not in files:
            path.unlink()
        elif path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    EXT_ZIP.write_bytes(zip_bytes(files))


def check(files: dict) -> bool:
    if not EXT_DIR.is_dir() or not EXT_ZIP.is_file():
        return False
    on_disk = {p.relative_to(EXT_DIR).as_posix() for p in EXT_DIR.rglob("*") if p.is_file()}
    if on_disk != set(files):
        return False
    if any((EXT_DIR / name).read_bytes() != data for name, data in files.items()):
        return False
    return EXT_ZIP.read_bytes() == zip_bytes(files)


def main() -> None:
    args = sys.argv[1:]
    if args[:1] == ["--standalone"]:
        if len(args) != 2:
            raise SystemExit("usage: build.py --standalone OUT")
        out = pathlib.Path(args[1])
        out.write_bytes(standalone_html())
        print(f"wrote standalone test harness {out}")
        return
    files = extension_files()
    digest = hashlib.sha256(zip_bytes(files)).hexdigest()
    if args == ["--check"]:
        same = check(files)
        print(f"{'SAME' if same else 'DIFFERENT'} {EXT_ZIP} sha256={digest} files={len(files)}")
        raise SystemExit(0 if same else 1)
    if args:
        raise SystemExit(__doc__)
    write_extension(files)
    print(f"wrote {EXT_DIR} ({len(files)} files) and {EXT_ZIP} sha256={digest}")


if __name__ == "__main__":
    main()
