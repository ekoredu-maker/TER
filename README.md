# 개인출장 여비정산 관리 프로그램 — PWA 배포 패키지

## 📦 패키지 구성

```
📁 pwa_deploy/
├── 📄 pwa_patcher.py       ← ① 먼저 실행! (원본 HTML → index.html 자동 변환)
├── 📄 manifest.json        ← PWA 앱 정보 정의
├── 📄 sw.js                ← 오프라인 캐싱 Service Worker
├── 📄 README.md            ← 이 파일
└── 📁 icons/
    ├── icon-72.png
    ├── icon-96.png
    ├── icon-128.png
    ├── icon-144.png
    ├── icon-152.png
    ├── icon-192.png        ← Android 홈화면용
    ├── icon-384.png
    └── icon-512.png        ← PWA 설치 필수
```

---

## 🚀 배포 단계 (5분 완성)

### STEP 1 — 원본 HTML 패치 (로컬)
```bash
# 원본 HTML 파일을 이 폴더에 복사한 뒤 실행
python pwa_patcher.py
```
→ `index.html` 이 자동 생성됩니다.

### STEP 2 — GitHub 저장소 업로드

업로드할 파일 목록:
```
index.html       (STEP 1에서 생성)
manifest.json
sw.js
icons/           (폴더 전체)
```

### STEP 3 — GitHub Pages 활성화
```
저장소 → Settings → Pages
→ Source: Deploy from a branch
→ Branch: main  /  (root)
→ Save
```

### STEP 4 — 완료! 🎉
```
https://[GitHub계정명].github.io/[저장소명]/
```

---

## 📱 설치 방법

| 플랫폼 | 설치 방법 |
|--------|-----------|
| **Android (Chrome)** | 주소창 오른쪽 "설치" 버튼 클릭 |
| **iOS (Safari)** | 공유 버튼 → "홈 화면에 추가" |
| **PC (Chrome/Edge)** | 주소창 오른쪽 설치 아이콘 클릭 |

---

## ♻️ 업데이트 방법

앱 내용을 변경한 후 캐시를 갱신하려면 `sw.js`의 버전을 올려주세요:

```js
// sw.js
const CACHE_NAME = 'yebi-jeongsan-v2';  // v1 → v2 로 변경
```

---

## ⚠️ 주의사항

- 데이터는 **브라우저 localStorage**에 저장됩니다.
- 브라우저 변경 또는 캐시 초기화 시 데이터가 초기화될 수 있습니다.
- 중요한 데이터는 프로그램의 **내보내기(export)** 기능으로 정기 백업하세요.
