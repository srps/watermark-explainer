#!/usr/bin/env bash
cd "$(dirname "$0")/.."
PY="$LOCALAPPDATA/watermark-xval/xval-venv/Scripts/python.exe"
"$PY" .test/probe_collapse.py
