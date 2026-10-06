from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    errors: list[str]


def _text(value) -> str:
    return str(value or "").strip()


def validate_settlement(settlement: dict, receipt_count: int = 0) -> ValidationResult:
    errors: list[str] = []

    if not _text(settlement.get("name")):
        errors.append("성명이 비어 있습니다.")
    if not _text(settlement.get("position")):
        errors.append("직급이 비어 있습니다.")
    if not _text(settlement.get("startDate")):
        errors.append("시작일이 비어 있습니다.")
    if not _text(settlement.get("destination")):
        errors.append("출장지가 비어 있습니다.")
    if not _text(settlement.get("movementMode")):
        errors.append("이동구분을 선택해 주세요.")
    if not _text(settlement.get("routeType")):
        errors.append("왕복/편도 구분을 선택해 주세요.")
    if not _text(settlement.get("mealProvidedFlag")):
        errors.append("식사 제공 여부를 선택해 주세요.")
    if not _text(settlement.get("receiptMode")):
        errors.append("영수증 처리 방식을 선택해 주세요.")

    if settlement.get("status") == "done" and not _text(settlement.get("settlementDate")):
        errors.append("정산완료 상태인 경우 정산일자를 입력해 주세요.")

    for idx, row in enumerate(settlement.get("privateCars") or [], 1):
        if not any(_text(row.get(k)) for k in ("date","from","to","km","fuel","toll","parking","other","manualAmount","driver","remark")):
            continue
        if not _text(row.get("from")):
            errors.append(f"자가용 {idx}행의 출발지가 비어 있습니다.")
        if not _text(row.get("to")):
            errors.append(f"자가용 {idx}행의 도착지가 비어 있습니다.")

    for idx, row in enumerate(settlement.get("publicTransport") or [], 1):
        if not any(_text(row.get(k)) for k in ("date","transport","from","to","grade","amount","remark")):
            continue
        if not _text(row.get("from")):
            errors.append(f"대중교통 {idx}행의 출발지가 비어 있습니다.")
        if not _text(row.get("to")):
            errors.append(f"대중교통 {idx}행의 도착지가 비어 있습니다.")

    if settlement.get("movementMode") == "private" and not (settlement.get("privateCars") or []):
        errors.append("이동구분이 자가용인데 자가용 운임 행이 없습니다.")
    if settlement.get("movementMode") == "public" and not (settlement.get("publicTransport") or []):
        errors.append("이동구분이 대중교통인데 대중교통 행이 없습니다.")
    if settlement.get("receiptMode") == "attached" and receipt_count <= 0:
        errors.append("프로그램 첨부를 선택했지만 첨부된 영수증이 없습니다.")

    return ValidationResult(ok=not errors, errors=errors)


# Copyright 2026@박주가리교감 All rights reserved.
