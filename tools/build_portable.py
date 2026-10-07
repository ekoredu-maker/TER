from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NAME = "개인출장_여비정산_Hybrid_v2"


def copy_app_tree(target: Path) -> None:
    excludes = {
        ".git", ".github", "__pycache__", "dist", "runtime", "vendor",
        "data", "output", "backup", "logs",
    }

    for source in ROOT.iterdir():
        if source.name in excludes:
            continue
        if source.name == "tools":
            continue
        dest = target / source.name
        if source.is_dir():
            shutil.copytree(
                source,
                dest,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
            )
        elif source.is_file():
            shutil.copy2(source, dest)

    for name in ("data/receipts", "data/signature", "output", "backup", "logs"):
        (target / name).mkdir(parents=True, exist_ok=True)


def install_vendor(target: Path) -> None:
    vendor = target / "vendor"
    vendor.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-compile",
            "--target",
            str(vendor),
            "-r",
            str(ROOT / "requirements.txt"),
        ],
        check=True,
    )


def install_runtime(target: Path, embed_zip: Path) -> None:
    runtime = target / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(embed_zip, "r") as zf:
        zf.extractall(runtime)

    pth_files = sorted(runtime.glob("python*._pth"))
    if not pth_files:
        raise RuntimeError("Python embeddable runtime의 ._pth 파일을 찾지 못했습니다.")

    pth = pth_files[0]
    original = pth.read_text(encoding="utf-8", errors="replace").splitlines()
    version_zip = next((line.strip() for line in original if line.strip().startswith("python") and line.strip().endswith(".zip")), "")

    lines = []
    if version_zip:
        lines.append(version_zip)
    lines.extend([
        ".",
        "..",
        "..\\vendor",
        "import site",
    ])
    pth.write_text("\n".join(lines) + "\n", encoding="utf-8")


def verify_template(target: Path) -> None:
    template = target / "template" / "여비정산서(양식).hwpx"
    if not template.is_file():
        raise RuntimeError(
            "template/여비정산서(양식).hwpx가 없습니다. "
            "사용자가 확정한 기준양식을 template 폴더에 넣은 뒤 다시 빌드해 주세요."
        )


def write_windows_launcher(target: Path) -> None:
    bat = target / "실행_개인출장여비정산.bat"
    bat.write_text(
        "@echo off\n"
        "setlocal\n"
        "cd /d \"%~dp0\"\n"
        "if not exist \"runtime\\python.exe\" (\n"
        "  echo [오류] runtime\\python.exe를 찾을 수 없습니다.\n"
        "  pause\n"
        "  exit /b 1\n"
        ")\n"
        "\"runtime\\python.exe\" launcher.py\n"
        "if errorlevel 1 (\n"
        "  echo.\n"
        "  echo 프로그램 실행 중 오류가 발생했습니다. logs 폴더를 확인해 주세요.\n"
        "  pause\n"
        ")\n"
        "endlocal\n",
        encoding="utf-8-sig",
    )


def make_zip(folder: Path) -> Path:
    zip_path = folder.with_suffix(".zip")
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in folder.rglob("*"):
            if path.is_file():
                zf.write(path, arcname=f"{folder.name}/{path.relative_to(folder)}")
    return zip_path


def main() -> int:
    parser = argparse.ArgumentParser(description="개인출장·여비정산 Windows 포터블 패키지 빌더")
    parser.add_argument(
        "--python-embed",
        type=Path,
        required=True,
        help="python.org Windows embeddable package ZIP 경로",
    )
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    args = parser.parse_args()

    embed_zip = args.python_embed.resolve()
    if not embed_zip.is_file():
        raise FileNotFoundError(embed_zip)

    dist = args.dist.resolve()
    dist.mkdir(parents=True, exist_ok=True)
    target = dist / args.name

    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)

    copy_app_tree(target)
    verify_template(target)
    install_vendor(target)
    install_runtime(target, embed_zip)
    write_windows_launcher(target)

    zip_path = make_zip(target)
    print(f"PORTABLE_FOLDER={target}")
    print(f"PORTABLE_ZIP={zip_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# Copyright 2026@박주가리교감 All rights reserved.
