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
    shortcut_ps1 = r'''param([switch]$Silent)

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pngPath = Join-Path $root "icons\\icon-192.png"
$iconPath = Join-Path $root "app.ico"

if (-not (Test-Path $iconPath) -and (Test-Path $pngPath)) {
    try {
        Add-Type -AssemblyName System.Drawing
        $bmp = [System.Drawing.Bitmap]::FromFile($pngPath)
        $hIcon = $bmp.GetHicon()
        $icon = [System.Drawing.Icon]::FromHandle($hIcon)
        $stream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
        $icon.Save($stream)
        $stream.Close()
        $icon.Dispose()
        $bmp.Dispose()
    } catch {
        # Shortcut is still created with the default Windows icon.
    }
}

$desktop = [Environment]::GetFolderPath("Desktop")
if ([string]::IsNullOrWhiteSpace($desktop)) {
    $desktop = Join-Path $env:USERPROFILE "Desktop"
}
if (-not (Test-Path $desktop)) {
    New-Item -ItemType Directory -Path $desktop -Force | Out-Null
}
$linkPath = Join-Path $desktop "개인출장 여비정산.lnk"
$runPath = Join-Path $root "RUN.cmd"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($linkPath)
$shortcut.TargetPath = $runPath
$shortcut.WorkingDirectory = $root
if (Test-Path $iconPath) {
    $shortcut.IconLocation = $iconPath + ",0"
}
$shortcut.Description = "개인출장 여비정산 관리 프로그램"
$shortcut.Save()

if (-not $Silent) {
    Write-Host "Desktop shortcut created:"
    Write-Host $linkPath
    Start-Sleep -Seconds 2
}
'''
    (target / "create_desktop_shortcut.ps1").write_text(
        shortcut_ps1,
        encoding="utf-8-sig",
    )

    run_content = (
        '@echo off\r\n'
        'setlocal\r\n'
        'pushd "%~dp0"\r\n'
        'if errorlevel 1 goto :folder_error\r\n'
        '\r\n'
        'if exist "%~dp0create_desktop_shortcut.ps1" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create_desktop_shortcut.ps1" -Silent >nul 2>nul\r\n'
        'if not exist "%~dp0runtime\\python.exe" goto :runtime_error\r\n'
        'if not exist "%~dp0launcher.py" goto :launcher_error\r\n'
        '\r\n'
        '"%~dp0runtime\\python.exe" "%~dp0launcher.py"\r\n'
        'set "RC=%ERRORLEVEL%"\r\n'
        'popd\r\n'
        'if "%RC%"=="0" exit /b 0\r\n'
        '\r\n'
        'echo.\r\n'
        'echo ERROR: Program stopped with exit code %RC%.\r\n'
        'echo Check the logs folder.\r\n'
        'pause\r\n'
        'exit /b %RC%\r\n'
        '\r\n'
        ':folder_error\r\n'
        'echo ERROR: Cannot open the program folder.\r\n'
        'pause\r\n'
        'exit /b 1\r\n'
        '\r\n'
        ':runtime_error\r\n'
        'echo ERROR: runtime\\python.exe was not found.\r\n'
        'echo Re-extract the entire ZIP before running this file.\r\n'
        'pause\r\n'
        'exit /b 1\r\n'
        '\r\n'
        ':launcher_error\r\n'
        'echo ERROR: launcher.py was not found.\r\n'
        'echo Re-extract the entire ZIP before running this file.\r\n'
        'pause\r\n'
        'exit /b 1\r\n'
    )
    (target / "RUN.cmd").write_text(run_content, encoding="ascii", newline="")
    (target / "start_windows.bat").write_text(
        '@echo off\r\ncall "%~dp0RUN.cmd"\r\n',
        encoding="ascii",
        newline="",
    )
    (target / "실행_개인출장여비정산.bat").write_text(
        '@echo off\r\ncall "%~dp0RUN.cmd"\r\n',
        encoding="ascii",
        newline="",
    )
    (target / "바탕화면_바로가기_만들기.cmd").write_text(
        '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create_desktop_shortcut.ps1"\r\n',
        encoding="ascii",
        newline="",
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
    parser.add_argument("--allow-missing-template", action="store_true")
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
    if args.allow_missing_template:
        (target / "template").mkdir(parents=True, exist_ok=True)
        template = target / "template" / "여비정산서(양식).hwpx"
        if not template.is_file():
            (target / "template" / "README_TEMPLATE_REQUIRED.txt").write_text(
                "최종 배포 전에 여비정산서(양식).hwpx를 이 폴더에 넣어야 합니다.\n",
                encoding="utf-8",
            )
    else:
        verify_template(target)
    install_vendor(target)
    install_runtime(target, embed_zip)
    write_windows_launcher(target)

    (target / "먼저읽기.txt").write_text(
        "개인출장·여비정산 Hybrid v2.0-RC1.2\n\n"
        "1. 압축을 완전히 해제합니다.\n"
        "2. RUN.cmd를 더블클릭합니다.\n"
        "3. 첫 실행 때 바탕화면에 '개인출장 여비정산' 바로가기를 자동 생성합니다.\n"
        "   자동 생성되지 않으면 '바탕화면_바로가기_만들기.cmd'를 실행합니다.\n"
        "4. 개인 설정에서 여비정산서(양식).hwpx를 기준양식으로 등록합니다.\n\n"
        "업무기준\n"
        "- 관내출장: 특별한 사유가 없는 경우 기본 정산불요\n"
        "- 관외출장: 정산대상 중심\n"
        "- 관내를 예외적으로 정산하는 경우 예외 정산 사유 입력\n"
        "- 여비부지급/정산불요 출장: 관내·관외와 관계없이 정산불요\n\n"
        "Copyright 2026@박주가리교감 All rights reserved.\n",
        encoding="utf-8-sig",
    )

    zip_path = make_zip(target)
    print("PORTABLE_BUILD_OK")
    print(f"ZIP_SIZE={zip_path.stat().st_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# Copyright 2026@박주가리교감 All rights reserved.
