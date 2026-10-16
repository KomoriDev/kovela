import json
import shutil
import subprocess
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent
dist = root / "dist"
target = root / "target" / "wasm32-wasip2" / "release" / "kovela_astrobox.wasm"
base = json.loads((root / "manifest.json").read_text(encoding="utf-8"))

# manifest.json 是主版本（Level 4 / WASI 3，AstroBox 2.2+）。下面这些权限只有
# Level 4 认识，兼容构建必须去掉，否则旧宿主会因未知权限拒绝安装。
LEVEL4_PERMISSIONS = ("notification", "account.profile", "os.device-id")


def build(features):
    command = ["cargo", "build", "--release", "--target", "wasm32-wasip2", "--locked"]
    if features:
        command.extend(["--features", features])
    subprocess.run(command, cwd=root, check=True)


def pack(folder, archive_name, manifest):
    """整理出一份 AstroBox 商店可直接抓取的产物目录：manifest.json + entry + icon。

    目录名会写进仓库根目录的 index.txt，别改。`.abp` 也放进来，
    别人从仓库下载后可以直接在 AstroBox 里本地导入。
    """
    payload = dist / folder
    payload.mkdir(parents=True, exist_ok=True)
    (payload / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    shutil.copy2(target, payload / manifest["entry"])
    shutil.copy2(root / manifest["icon"], payload / manifest["icon"])
    archive_path = payload / archive_name
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in ["manifest.json", manifest["icon"], manifest["entry"]]:
            archive.write(payload / name, name)
    print("Built", payload, "and", archive_path)


# 旧布局把产物平铺在 dist/ 根目录，改布局后清掉这几个残留，避免误提交。
# Kovela-local-debug.abp 是本地调试包，不在此列。
for legacy in (
    "manifest.json",
    "kovela_astrobox.wasm",
    "icon.png",
    "Kovela.abp",
    "Kovela-v4.abp",
):
    (dist / legacy).unlink(missing_ok=True)

# 兼容构建：Level 2/3 宿主（WASI 2 / api_level 3）仍能安装，但没有账号与设备
# 通知能力。上架入口只列主版本，这份留给用户本地导入。
build("")
pack(
    "kovela",
    "Kovela.abp",
    {
        **base,
        "wasi_version": 2,
        "api_level": 3,
        "permissions": [
            permission
            for permission in base["permissions"]
            if permission not in LEVEL4_PERMISSIONS
        ],
    },
)
# 主版本：Level 4（WASI 3 / api_level 4），账号资料、设备通知与实时活动都在这里。
build("api4")
pack(
    "kovela-v4",
    "Kovela-v4.abp",
    base,
)
