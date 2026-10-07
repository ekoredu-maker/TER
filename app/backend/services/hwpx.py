from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
NS = {"hp": HP}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float:
    try:
        return float(str(value or "0").replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def _money(value: Any) -> str:
    n = round(_number(value))
    return f"{n:,}" if n else ""


def _short_date(value: str) -> str:
    s = _text(value)
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})$", s)
    if not m:
        return s
    return f"{int(m.group(2))}. {int(m.group(3))}."


def _date_kr(value: str) -> str:
    s = _text(value)
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})$", s)
    if not m:
        return s
    return f"{int(m.group(1))}년 {int(m.group(2))}월 {int(m.group(3))}일"


def _trip_period(settlement: dict[str, Any]) -> str:
    sd = _text(settlement.get("startDate"))
    st = _text(settlement.get("startTime"))
    ed = _text(settlement.get("endDate")) or sd
    et = _text(settlement.get("endTime"))
    left = " ".join(v for v in (_date_kr(sd), st) if v)
    if not ed and not et:
        return left
    if ed == sd:
        right = et
    else:
        right = " ".join(v for v in (_date_kr(ed), et) if v)
    return f"{left} ~ {right}".strip(" ~")


def _meal_label(settlement: dict[str, Any]) -> str:
    note = _text(settlement.get("mealProvidedNote"))
    flag = _text(settlement.get("mealProvidedFlag"))
    if note:
        return note
    if flag == "yes":
        return "식사 제공"
    if flag == "no":
        return "식사 미제공"
    return _text(settlement.get("mealProvided"))


def _private_row_amount(row: dict[str, Any], km_rate: float) -> float:
    manual = _number(row.get("manualAmount"))
    if manual:
        return manual
    return (
        _number(row.get("km")) * km_rate
        + _number(row.get("fuel"))
        + _number(row.get("toll"))
        + _number(row.get("parking"))
        + _number(row.get("other"))
    )


def _attachment_line(settlement: dict[str, Any], receipt_count: int) -> str:
    mode = _text(settlement.get("receiptMode"))
    if mode == "attached":
        count = max(int(receipt_count or 0), 1)
        return f"        2. 영수증 {count}부.  끝."
    if mode == "none":
        return "        2. 영수증 없음.  끝."
    if mode == "separate":
        return "        2. 영수증 별도 제출.  끝."
    return "        2. 영수증 1부.  끝."


def _register_namespaces(xml_bytes: bytes) -> None:
    for _event, item in ET.iterparse(io.BytesIO(xml_bytes), events=("start-ns",)):
        prefix, uri = item
        try:
            ET.register_namespace(prefix or "", uri)
        except ValueError:
            pass


class _Form:
    def __init__(self, xml_bytes: bytes):
        _register_namespaces(xml_bytes)
        self.root = ET.fromstring(xml_bytes)
        self.table = self.root.find(".//hp:tbl", NS)
        if self.table is None:
            raise ValueError("기준 HWPX에서 여비정산 표를 찾지 못했습니다.")

    def cell(self, col: int, row: int):
        for tc in self.table.findall(".//hp:tc", NS):
            addr = tc.find("./hp:cellAddr", NS)
            if addr is None:
                continue
            if int(addr.get("colAddr", "-1")) == col and int(addr.get("rowAddr", "-1")) == row:
                return tc
        raise KeyError(f"HWPX cell not found: ({col},{row})")

    def set_cell(self, col: int, row: int, value: Any) -> None:
        tc = self.cell(col, row)
        sub = tc.find("./hp:subList", NS)
        if sub is None:
            raise ValueError(f"HWPX cell ({col},{row}) has no subList")
        p = sub.find("./hp:p", NS)
        if p is None:
            p = ET.SubElement(sub, f"{{{HP}}}p", {"id": "2147483648", "paraPrIDRef": "3", "styleIDRef": "0"})
        run = p.find("./hp:run", NS)
        if run is None:
            run = ET.SubElement(p, f"{{{HP}}}run", {"charPrIDRef": "5"})
        for child in list(run):
            if child.tag == f"{{{HP}}}t":
                run.remove(child)
        t = ET.SubElement(run, f"{{{HP}}}t")
        t.text = _text(value)

    def replace_text(self, pattern: str, replacement: str) -> int:
        count = 0
        regex = re.compile(pattern)
        for node in self.root.findall(".//hp:t", NS):
            if not node.text:
                continue
            new_text, n = regex.subn(replacement, node.text)
            if n:
                node.text = new_text
                count += n
        return count

    def to_bytes(self) -> bytes:
        return ET.tostring(self.root, encoding="utf-8", xml_declaration=True)


def generate_hwpx(
    *,
    template_path: Path,
    output_path: Path,
    settlement: dict[str, Any],
    receipt_count: int = 0,
    km_rate: float = 200,
) -> Path:
    template_path = Path(template_path)
    output_path = Path(output_path)
    if not template_path.is_file():
        raise FileNotFoundError(f"HWPX 기준양식이 없습니다: {template_path}")

    with zipfile.ZipFile(template_path, "r") as zin:
        section = zin.read("Contents/section0.xml")
        form = _Form(section)

        # 상단 기본정보
        form.set_cell(2, 0, settlement.get("dept"))
        form.set_cell(7, 0, settlement.get("position"))
        form.set_cell(15, 0, settlement.get("name"))
        form.set_cell(2, 1, settlement.get("coTravelers"))

        # 출장 일정
        form.set_cell(3, 2, _trip_period(settlement))
        form.set_cell(3, 3, settlement.get("destination"))
        form.set_cell(3, 4, settlement.get("purpose"))
        form.set_cell(3, 5, _meal_label(settlement))

        # 숙박비
        form.set_cell(3, 6, _money(settlement.get("lodgingAdvance")))
        form.set_cell(10, 6, _money(settlement.get("lodgingActual")))
        form.set_cell(17, 6, settlement.get("lodgingOverReason"))
        form.set_cell(3, 7, f"({_text(settlement.get('lodgingFriendNights')) or '0'})박")
        form.set_cell(10, 7, f"({_text(settlement.get('lodgingSharedNights')) or '0'})박")
        form.set_cell(17, 7, settlement.get("lodgingSharedApplicant"))

        # 자가용 4개 이동행 + 병합된 금액/운전자/비고
        private_rows = list(settlement.get("privateCars") or [])[:4]
        for offset in range(4):
            row_addr = 9 + offset
            row = private_rows[offset] if offset < len(private_rows) else {}
            form.set_cell(2, row_addr, _short_date(_text(row.get("date"))))
            form.set_cell(3, row_addr, row.get("from"))
            form.set_cell(5, row_addr, row.get("to"))
            form.set_cell(8, row_addr, row.get("km"))

        private_total = sum(_private_row_amount(row, km_rate) for row in private_rows)
        drivers = []
        remarks = []
        for row in private_rows:
            driver = _text(row.get("driver"))
            remark = _text(row.get("remark"))
            if driver and driver not in drivers:
                drivers.append(driver)
            if remark and remark not in remarks:
                remarks.append(remark)
        form.set_cell(11, 9, _money(private_total))
        form.set_cell(14, 9, ", ".join(drivers))
        form.set_cell(18, 9, ", ".join(remarks))

        # 대중교통 4개 독립행
        public_rows = list(settlement.get("publicTransport") or [])[:4]
        for offset in range(4):
            row_addr = 14 + offset
            row = public_rows[offset] if offset < len(public_rows) else {}
            form.set_cell(2, row_addr, _short_date(_text(row.get("date"))))
            form.set_cell(3, row_addr, row.get("transport"))
            form.set_cell(5, row_addr, row.get("from"))
            form.set_cell(9, row_addr, row.get("to"))
            form.set_cell(12, row_addr, row.get("grade"))
            form.set_cell(16, row_addr, _money(row.get("amount")))

        # 하단 첨부·신청일·신청인
        form.replace_text(r"\s*2\.\s*영수증[^\n]*?끝\.", _attachment_line(settlement, receipt_count))
        settlement_date = _date_kr(_text(settlement.get("settlementDate")))
        if settlement_date:
            form.replace_text(r"\s*\d{4}년\s*\d*월\s*\d*일", f"                                   {settlement_date}")
        applicant = _text(settlement.get("name"))
        if applicant:
            form.replace_text(r"\s*신\s*청\s*인\s*(?:[^\n]*?)\(서명\)", f"                                        신 청 인  {applicant}  (서명)")

        new_section = form.to_bytes()
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(output_path, "w") as zout:
            for info in zin.infolist():
                data = new_section if info.filename == "Contents/section0.xml" else zin.read(info.filename)
                zout.writestr(info, data)

    validation = validate_hwpx(output_path)
    if not validation["ok"]:
        try:
            output_path.unlink()
        except OSError:
            pass
        raise ValueError("생성 HWPX 무결성 검증 실패: " + "; ".join(validation["errors"]))
    return output_path


def validate_hwpx(path: Path) -> dict[str, Any]:
    path = Path(path)
    errors: list[str] = []
    required = {"mimetype", "Contents/section0.xml", "Contents/header.xml", "Contents/content.hpf"}

    try:
        with zipfile.ZipFile(path, "r") as zf:
            bad = zf.testzip()
            if bad:
                errors.append(f"손상된 ZIP 항목: {bad}")
            names = set(zf.namelist())
            missing = sorted(required - names)
            if missing:
                errors.append("필수 항목 누락: " + ", ".join(missing))
            if "Contents/section0.xml" in names:
                try:
                    ET.fromstring(zf.read("Contents/section0.xml"))
                except ET.ParseError as exc:
                    errors.append(f"section0.xml 파싱 오류: {exc}")
    except Exception as exc:
        errors.append(str(exc))

    return {"ok": not errors, "errors": errors}


# Copyright 2026@박주가리교감 All rights reserved.
