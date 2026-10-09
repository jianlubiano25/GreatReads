#!/usr/bin/env python3
"""Apply WordsTab extraction to src/App.tsx (run from repo root)."""
import base64, pathlib, subprocess, sys, zlib
root = pathlib.Path(__file__).resolve().parent.parent
z = root / 'scripts' / 'words-extract.patch.z64'
patch_path = root / 'scripts' / 'words-extract.patch'
if z.exists():
    patch_path.write_bytes(zlib.decompress(base64.b64decode(z.read_text().strip())))
app = root / 'src' / 'App.tsx'
text = app.read_text(encoding='utf-8')
if "from './components/WordsTab'" in text and '<WordsTab' in text:
    print('App.tsx already has WordsTab wired — nothing to do')
    sys.exit(0)
if not patch_path.exists():
    print('Missing words-extract.patch', file=sys.stderr)
    sys.exit(1)
r = subprocess.run(
    ['patch', '-p1', '--forward', '--reject-file=-'],
    cwd=root,
    input=patch_path.read_text(encoding='utf-8'),
    capture_output=True,
    text=True,
)
print(r.stdout)
if r.stderr:
    print(r.stderr, file=sys.stderr)
text = app.read_text(encoding='utf-8')
ok = "from './components/WordsTab'" in text and '<WordsTab' in text and 'wordFilter' not in text
print('OK: WordsTab extraction applied' if ok else 'WARN: patch may not have applied cleanly')
sys.exit(0 if ok else 1)
