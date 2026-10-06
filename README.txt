개인출장·여비정산 관리 프로그램 Hybrid v2 개발 브랜치

이 브랜치는 기존 GitHub Pages 웹판(main)을 보존한 상태에서
HTML/JavaScript UI + Python 처리 엔진 + Windows 포터블 실행기 구조로
마이그레이션하기 위한 개발 브랜치입니다.

현재 구현
- 127.0.0.1 빈 포트 자동 선택 로컬 서버
- 실행별 접근 토큰
- KST(+09:00) 고정
- Python openpyxl 출장목록 분석
- SQLite trips / settlements / receipts / settings 저장
- 정산 필수값 검증
- 영수증·서명 실제 파일 저장 서비스
- ZIP 백업/복원 서비스
- Windows 실행 스크립트
- backend 회귀테스트
- HWPX 기준양식 운영 원칙

아직 main에 합치지 않는 항목
- 기존 프론트엔드와 Python API 완전 연결
- 실제 기준 HWPX 바이너리 포함 및 최종 출력 회귀검증
- HWPX 서명 이미지 삽입
- Python 미설치 PC용 runtime 포함 포터블 배포
- 최종 Windows launcher.exe

개발 원칙
1. main은 현재 안정 웹판으로 유지
2. hybrid-v2에서만 구조 변경
3. 기존 정상 기능·출력을 기준선으로 회귀검증
4. 원본 HWPX는 절대 덮어쓰지 않음
5. 검증된 버전만 GitHub Release로 배포

Copyright 2026@박주가리교감 All rights reserved.
