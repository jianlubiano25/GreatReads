#!/usr/bin/env python3
"""Apply StoreTab extraction to src/App.tsx (run from repo root on refactor/app-tabs)."""
import base64, pathlib, subprocess, sys, zlib
root = pathlib.Path(__file__).resolve().parent.parent
app = root / "src" / "App.tsx"
text = app.read_text(encoding="utf-8")
if "from './components/StoreTab'" in text and "<StoreTab" in text:
    print("App.tsx already has StoreTab wired — nothing to do")
    sys.exit(0)
if "from './components/WordsTab'" not in text:
    print("ERROR: WordsTab must be wired first", file=sys.stderr)
    sys.exit(1)
z = root / "scripts" / "store-extract.patch.z64"
patch_path = root / "scripts" / "store-extract.patch"
if z.exists():
    patch_path.write_bytes(zlib.decompress(base64.b64decode(z.read_text().strip())))
elif not patch_path.exists():
    print("Missing store-extract.patch.z64", file=sys.stderr)
    sys.exit(1)
r = subprocess.run(
    ["patch", "-p1", "--forward", "--reject-file=-"],
    cwd=root,
    input=patch_path.read_text(encoding="utf-8"),
    capture_output=True,
    text=True,
)
print(r.stdout)
if r.stderr:
    print(r.stderr, file=sys.stderr)
text = app.read_text(encoding="utf-8")
ok = "from './components/StoreTab'" in text and "<StoreTab" in text and "storeSearchQuery" not in text
print("OK: StoreTab extraction applied" if ok else "WARN: patch may not have applied cleanly")
sys.exit(0 if ok else 1)
