#!/usr/bin/env python3
"""Restore src/App.tsx from compressed parts on this branch."""
import base64, pathlib, zlib, sys
root = pathlib.Path(__file__).resolve().parents[1]
parts = sorted(root.glob('src/App.tsx.z64.*'))
if not parts:
    # single file fallback
    single = root / 'src' / 'App.tsx.z64'
    if single.exists():
        z64 = single.read_text().strip()
    else:
        print('No App.tsx.z64 parts found', file=sys.stderr)
        sys.exit(1)
else:
    z64 = ''.join(p.read_text().strip() for p in parts)
out = root / 'src' / 'App.tsx'
out.write_bytes(zlib.decompress(base64.b64decode(z64)))
print(f'Wrote {out} ({out.stat().st_size} bytes)')
text = out.read_text(encoding='utf-8')
assert 'LibraryTab' in text and 'DeviceTab' in text
assert 'PLACEHOLDER' not in text
print('OK: App.tsx restored with LibraryTab and DeviceTab')
