from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

from app.backend.services.excel import parse_trip_file
from app.backend.services.store import SQLiteStore
from app.backend.services.timeutils import iso_kst, ymd_kst
from app.backend.services.validators import validate_settlement


class HybridBackendTests(unittest.TestCase):
    def test_kst_timestamp(self):
        self.assertTrue(iso_kst().endswith("+09:00"))
        self.assertEqual(len(ymd_kst()), 10)

    def test_sqlite_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            store = SQLiteStore(Path(td) / "app.db")
            row = {"id": "trip_1", "name": "홍길동", "destination": "충북교육청"}
            store.put("trips", row)
            self.assertEqual(store.get("trips", "trip_1")["destination"], "충북교육청")
            self.assertEqual(len(store.get_all("trips")), 1)
            store.delete("trips", "trip_1")
            self.assertEqual(store.get_all("trips"), [])

    def test_excel_filter_and_settlement_flag(self):
        wb = Workbook()
        ws = wb.active
        ws.append([
            "순번", "부서", "직위", "신청자", "출장기간", "출장지",
            "출장목적", "식사제공여부", "결재상태", "삭제여부",
        ])
        ws.append([
            1, "교육과", "장학사", "홍길동",
            "2026.10.06 09:00 ~ 2026.10.06 18:00",
            "충북교육청", "업무협의", "중식 제공", "완결", "미삭제",
        ])
        ws.append([
            2, "교육과", "장학사", "홍길동",
            "2026.10.07 09:00 ~ 2026.10.07 18:00",
            "제천시청", "진행 중 협의", "미제공", "진행중", "미삭제",
        ])
        ws.append([
            3, "교육과", "장학사", "홍길동",
            "2026.10.08 09:00 ~ 2026.10.08 18:00",
            "청주시", "연수 여비부지급", "미제공", "완결", "미삭제",
        ])
        data = io.BytesIO()
        wb.save(data)

        result = parse_trip_file("출장목록.xlsx", data.getvalue())
        self.assertEqual(len(result["preview"]), 2)
        self.assertEqual(result["preview"][0]["startDate"], "2026-10-06")
        self.assertEqual(result["preview"][0]["startTime"], "09:00")
        self.assertFalse(result["preview"][1]["settlementRequired"])
        self.assertTrue(result["preview"][0]["createdAt"].endswith("+09:00"))

    def test_settlement_validation(self):
        settlement = {
            "name": "홍길동",
            "position": "장학사",
            "startDate": "2026-10-06",
            "destination": "충북교육청",
            "movementMode": "private",
            "routeType": "round",
            "mealProvidedFlag": "yes",
            "receiptMode": "attached",
            "settlementDate": "2026-10-07",
            "status": "done",
            "privateCars": [
                {"from": "제천교육지원청", "to": "충북교육청", "date": "2026-10-06"},
                {"from": "충북교육청", "to": "제천교육지원청", "date": "2026-10-06"},
            ],
            "publicTransport": [],
        }
        result = validate_settlement(settlement, receipt_count=1)
        self.assertTrue(result.ok, result.errors)


if __name__ == "__main__":
    unittest.main()
