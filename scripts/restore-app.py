#!/usr/bin/env python3
"""Restore src/App.tsx from the compressed payload on this branch."""
import base64, pathlib, zlib
root = pathlib.Path(__file__).resolve().parents[1]
z64 = (root / 'src' / 'App.tsx.z64').read_text().strip()
out = root / 'src' / 'App.tsx'
out.write_bytes(zlib.decompress(base64.b64decode(z64)))
print(f'Wrote {out} ({out.stat().st_size} bytes)')
