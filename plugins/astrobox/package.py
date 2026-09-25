import json
import shutil
import subprocess
from pathlib import Path

import zipfile

root = Path(__file__).resolve().parent
target = root / "target" / "wasm32-wasip2" / "release" / "kovela_astrobox.wasm"
dist = root / "dist"
base = json.loads((root / "manifest.json").read_text(encoding="utf-8"))


def build(features):
    command = ["cargo", "build", "--release", "--target", "wasm32-wasip2", "--locked"]
    if features:
        command.extend(["--features", features])
    subprocess.run(command, cwd=root, check=True)


def pack(filename, **overrides):
    manifest = {**base, **overrides}
    dist.mkdir(exist_ok=True)
    entry = dist / manifest["entry"]
    shutil.copy2(target, entry)
    (dist / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    shutil.copy2(root / manifest["icon"], dist / manifest["icon"])
    archive_path = dist / filename
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in ["manifest.json", manifest["icon"], manifest["entry"]]:
            archive.write(dist / name, name)
    print("Built", archive_path)


build("")
pack("Kovela.abp")
build("api4")
pack(
    "Kovela-v4.abp",
    wasi_version=3,
    api_level=4,
    permissions=[*base["permissions"], "notification"],
)
