#!/usr/bin/env python3
"""Restore src/App.tsx with WordsTab (and prior Library/Device extractions) wired in."""
import base64, pathlib, zlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
z = root / "scripts" / "app-words.z64"
if not z.exists():
    print("Missing scripts/app-words.z64", file=sys.stderr)
    sys.exit(1)
data = zlib.decompress(base64.b64decode(z.read_text().strip()))
out = root / "src" / "App.tsx"
out.write_bytes(data)
text = data.decode("utf-8")
ok = "WordsTab" in text and "LibraryTab" in text and "DeviceTab" in text and "wordFilter" not in text
print(f"Wrote {out} ({len(data)} bytes)")
print("OK: App.tsx restored with LibraryTab, DeviceTab, WordsTab" if ok else "WARN: unexpected content")
sys.exit(0 if ok else 1)
