개인출장·여비정산 관리 프로그램 v1.2 최소리팩터링 안정판

이 패키지는 기존에 동작하던 단일 HTML 파일을 기준으로,
HTML / CSS / JS만 분리한 최소 리팩터링판입니다.

구성:
- index.html
- assets/css/style.css
- assets/css/print.css
- assets/js/app.js
- manifest.json
- sw.js

테스트 방법:
1) 폴더에서 index.html을 직접 열어 기본 화면이 보이는지 확인
2) GitHub Pages 배포 시에는 manifest/sw.js가 같이 동작

주의:
- 엑셀 업로드용 xlsx 라이브러리는 CDN을 사용하므로 첫 실행은 온라인이 안전합니다.
- file:// 실행에서는 서비스워커가 자동 등록되지 않습니다.
