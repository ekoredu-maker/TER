# 개인출장·여비정산 Hybrid v2

이 브랜치는 기존 GitHub Pages 웹판을 보존하면서 Python 하이브리드 구조로 전환하기 위한 개발 브랜치입니다.

## 원칙
- main 브랜치는 현재 웹/PWA 안정판으로 유지합니다.
- UI는 HTML/CSS/JavaScript를 유지합니다.
- Excel, SQLite 저장, 영수증/서명 파일, 백업, HWPX 생성은 Python으로 이관합니다.
- 서버는 127.0.0.1에만 바인딩하고 포트 0으로 빈 포트를 자동 선택합니다.
- 원본 HWPX는 덮어쓰지 않고 output/에 새 파일을 생성합니다.
- 핵심 라이브러리는 배포판에 로컬 포함합니다.
- 모든 변경은 회귀테스트 후 main 또는 Release 반영 여부를 결정합니다.

## 단계
1. beta2.1 안정화 모듈
2. frontend-Python API 브리지
3. HWPX 기준양식 회귀검증
4. Windows 포터블 런타임
5. GitHub Actions 자동 테스트/빌드

Copyright 2026@박주가리교감 All rights reserved.
