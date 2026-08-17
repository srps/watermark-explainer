#!/usr/bin/env bash
# Cross-validation runner: generate reference vectors with DeepMind's real
# implementation. The torch venv lives OUTSIDE the repo (the
# source store cannot handle multi-GB directories): %LOCALAPPDATA%/watermark-xval
set -e
cd "$(dirname "$0")/.."
PY="$LOCALAPPDATA/watermark-xval/xval-venv/Scripts/python.exe"
"$PY" .test/xval_make_vectors.py
