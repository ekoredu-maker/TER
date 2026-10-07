from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

from app.backend.services.excel import parse_trip_file
from app.backend.services.files import receipt_path, save_receipt, save_signature, signature_path
from app.backend.services.hwpx import generate_hwpx, validate_hwpx
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
            "순번", "부서", "직위", "신청자", "출장종류", "출장기간", "출장지",
            "출장목적", "식사제공여부", "결재상태", "삭제여부",
        ])
        ws.append([
            1, "교육과", "장학사", "홍길동", "관외출장",
            "2026.10.06 09:00 ~ 2026.10.06 18:00",
            "충북교육청", "업무협의", "중식 제공", "완결", "미삭제",
        ])
        ws.append([
            2, "교육과", "장학사", "홍길동", "관내출장",
            "2026.10.07 09:00 ~ 2026.10.07 18:00",
            "제천시청", "업무협의", "미제공", "완결", "N",
        ])
        ws.append([
            3, "교육과", "장학사", "홍길동", "관외출장",
            "2026.10.08 09:00 ~ 2026.10.08 18:00",
            "청주시", "연수 여비부지급", "미제공", "완결", "미삭제",
        ])
        ws.append([
            4, "교육과", "장학사", "홍길동", "관외출장",
            "2026.10.09 09:00 ~ 2026.10.09 18:00",
            "청주시", "진행 중 협의", "미제공", "진행중", "미삭제",
        ])
        data = io.BytesIO()
        wb.save(data)

        result = parse_trip_file("출장목록.xlsx", data.getvalue())
        self.assertEqual(len(result["preview"]), 3)

        inter, intra, no_expense = result["preview"]
        self.assertEqual(inter["tripScope"], "inter")
        self.assertTrue(inter["settlementRequired"])
        self.assertEqual(inter["settlementPolicy"], "inter_required")

        self.assertEqual(intra["tripScope"], "intra")
        self.assertFalse(intra["settlementRequired"])
        self.assertEqual(intra["settlementPolicy"], "intra_default_exempt")

        self.assertFalse(no_expense["settlementRequired"])
        self.assertEqual(no_expense["settlementPolicy"], "no_expense")
        self.assertTrue(inter["createdAt"].endswith("+09:00"))

    def test_receipt_and_signature_file_storage(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            receipt = save_receipt(
                base / "receipts",
                filename="영수증.png",
                data=b"PNGTEST",
                mime_type="image/png",
            )
            self.assertTrue(receipt_path(base / "receipts", receipt).is_file())

            signature = save_signature(
                base / "signature",
                filename="signature.png",
                data=b"PNGTEST",
            )
            self.assertTrue(signature_path(base / "signature", signature).is_file())

    def test_hwpx_generation_when_template_available(self):
        template = Path(__file__).resolve().parents[1] / "template" / "여비정산서(양식).hwpx"
        if not template.is_file():
            self.skipTest("HWPX template is supplied in the local/release package")

        settlement = {
            "dept": "교육과",
            "position": "장학사",
            "name": "홍길동",
            "coTravelers": "김철수",
            "startDate": "2026-10-06",
            "startTime": "09:00",
            "endDate": "2026-10-06",
            "endTime": "18:00",
            "destination": "충북교육청",
            "purpose": "업무협의",
            "mealProvidedFlag": "yes",
            "mealProvidedNote": "중식 제공",
            "movementMode": "private",
            "routeType": "round",
            "receiptMode": "attached",
            "settlementDate": "2026-10-07",
            "status": "done",
            "privateCars": [
                {"date":"2026-10-06","from":"제천교육지원청","to":"충북교육청","km":"120","toll":"5000","driver":"홍길동","remark":"왕복"},
                {"date":"2026-10-06","from":"충북교육청","to":"제천교육지원청","km":"120","toll":"5000","driver":"홍길동","remark":"왕복"},
            ],
            "publicTransport": [],
        }

        with tempfile.TemporaryDirectory() as td:
            output = Path(td) / "test.hwpx"
            generate_hwpx(
                template_path=template,
                output_path=output,
                settlement=settlement,
                receipt_count=1,
                km_rate=200,
            )
            result = validate_hwpx(output)
            self.assertTrue(result["ok"], result["errors"])

    def test_intracity_settlement_requires_exception_reason(self):
        base = {
            "name": "홍길동",
            "position": "장학사",
            "startDate": "2026-10-06",
            "destination": "제천시청",
            "tripType": "관내출장",
            "tripScope": "intra",
            "movementMode": "private",
            "routeType": "round",
            "mealProvidedFlag": "no",
            "receiptMode": "none",
            "settlementDate": "2026-10-07",
            "status": "done",
            "privateCars": [
                {"from": "제천교육지원청", "to": "제천시청", "date": "2026-10-06"},
                {"from": "제천시청", "to": "제천교육지원청", "date": "2026-10-06"},
            ],
            "publicTransport": [],
        }
        result = validate_settlement(base, receipt_count=0)
        self.assertFalse(result.ok)
        self.assertTrue(any("예외 정산 사유" in x for x in result.errors))

        base["exceptionReason"] = "관내 행사 지원으로 자가용 실비 정산 필요"
        result = validate_settlement(base, receipt_count=0)
        self.assertTrue(result.ok, result.errors)

        base["status"] = "exempt"
        base["exceptionReason"] = ""
        base["movementMode"] = ""
        base["routeType"] = ""
        base["receiptMode"] = ""
        result = validate_settlement(base, receipt_count=0)
        self.assertTrue(result.ok, result.errors)

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
