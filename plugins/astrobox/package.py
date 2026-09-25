import json
import shutil
import subprocess
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent
subprocess.run(["cargo", "build", "--release", "--target", "wasm32-wasip2", "--locked"], cwd=root, check=True)
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
dist = root / "dist"
dist.mkdir(exist_ok=True)
shutil.copy2(root / "target/wasm32-wasip2/release/kovela_astrobox.wasm", dist / manifest["entry"])
for name in ["manifest.json", manifest["icon"]]:
    shutil.copy2(root / name, dist / name)
with zipfile.ZipFile(dist / "Kovela.abp", "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name in ["manifest.json", manifest["icon"], manifest["entry"]]:
        archive.write(dist / name, name)
print("Built", dist / "Kovela.abp")
