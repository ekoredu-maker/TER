from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.backend.app import serve

if __name__ == '__main__':
    raise SystemExit(serve())

# Copyright 2026@박주가리교감 All rights reserved.
