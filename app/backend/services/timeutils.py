from __future__ import annotations

from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9), name='KST')


def now_kst() -> datetime:
    return datetime.now(KST)


def iso_kst(timespec: str = 'seconds') -> str:
    return now_kst().isoformat(timespec=timespec)


def ymd_kst() -> str:
    return now_kst().strftime('%Y-%m-%d')


def stamp_kst() -> str:
    return now_kst().strftime('%Y%m%d_%H%M%S')


# Copyright 2026@박주가리교감 All rights reserved.
