# Windows 포터블 배포판 만들기

## 목표

최종 사용 PC에는 Python 설치가 필요 없습니다.

배포 폴더 구조:

~~~text
개인출장_여비정산_Hybrid_v2/
├─ 실행_개인출장여비정산.bat
├─ launcher.py
├─ app/
├─ assets/
├─ runtime/
│  └─ python.exe
├─ vendor/
│  ├─ openpyxl/
│  └─ et_xmlfile/
├─ template/
│  └─ 여비정산서(양식).hwpx
├─ data/
│  ├─ receipts/
│  └─ signature/
├─ output/
├─ backup/
└─ logs/
~~~

## 준비

1. python.org의 Windows embeddable package ZIP을 준비합니다.
2. 사용자가 확정한 기준양식 여비정산서(양식).hwpx를 template/ 폴더에 넣습니다.
3. 빌드 PC에는 Python과 pip가 있어야 합니다. 최종 사용자 PC에는 필요 없습니다.

## 빌드

예:

~~~powershell
python tools/build_portable.py --python-embed C:\\Downloads\\python-3.12.x-embed-amd64.zip
~~~

빌드 스크립트는 앱 소스 복사, vendor 의존성 설치, embeddable runtime 배치, _pth 보정, 데이터 폴더 생성, 실행 BAT 생성, ZIP 패키징을 수행합니다.

## 배포 전 회귀테스트

1. 실행 BAT로 앱 시작
2. Python 엔진 연결 상태 확인
3. 개인설정 저장 후 재실행
4. 출장 Excel 가져오기
5. 동일 파일 재업로드 후 중복 여부 확인
6. 자가용 왕복 및 출발지 수정
7. 영수증 JPG/PDF 등록·미리보기·삭제
8. 서명 등록·재실행
9. 기준 HWPX 정산서 생성
10. 생성 HWPX를 한글에서 열어 표·문구 확인
11. ZIP 백업
12. 초기화
13. ZIP 복원
14. 프로그램 종료 후 자신의 Python 서버만 종료되는지 확인

## 주의

- template/여비정산서(양식).hwpx는 원본을 덮어쓰지 않습니다.
- 생성 HWPX는 output/에만 생성합니다.
- GitHub Pages 웹판은 main 브랜치에서 계속 운영합니다.
- Windows 포터블판은 hybrid-v2 검증 후 GitHub Release ZIP으로 배포합니다.

Copyright 2026@박주가리교감 All rights reserved.
