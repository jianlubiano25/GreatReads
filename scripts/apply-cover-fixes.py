#!/usr/bin/env python3
"""Apply cover loading fixes (OL default=false already on branch; this writes BookMeta + sw.js)."""
import base64, pathlib, zlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
# Files written by this script are embedded below after generation on the agent side.
# If FILES is empty, fall back to in-place search-replace only.
FILES = {}
exec(pathlib.Path(__file__).read_text().split('FILES = ',1)[-1] if False else 'pass')
