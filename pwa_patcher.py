#!/usr/bin/env python3
"""
pwa_patcher.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
원본 여비정산 HTML 파일에 PWA 코드를 자동 삽입합니다.

사용법:
  1. 이 스크립트를 원본 HTML 파일과 같은 폴더에 놓으세요.
  2. Python 3 환경에서 실행:
       python pwa_patcher.py
  3. 완성된 index.html 이 생성됩니다.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
import os, sys, glob, shutil

# ── 원본 HTML 파일 자동 탐색 ──
html_files = glob.glob('*.html')
src_file = None
for f in html_files:
    if '여비' in f or '출장' in f or 'index' in f.lower():
        src_file = f
        break
if not src_file and html_files:
    src_file = html_files[0]
if not src_file:
    print("❌ HTML 파일을 찾을 수 없습니다. 같은 폴더에 원본 HTML을 놓고 실행하세요.")
    sys.exit(1)

print(f"✅ 원본 파일 발견: {src_file}")

with open(src_file, 'r', encoding='utf-8') as f:
    content = f.read()

# ── 이미 패치 여부 확인 ──
if 'manifest.json' in content:
    print("⚠️  이미 PWA 코드가 삽입되어 있습니다. 중복 삽입을 건너뜁니다.")
    if src_file != 'index.html':
        shutil.copy(src_file, 'index.html')
        print("✅ index.html 복사 완료")
    sys.exit(0)

# ── PWA 삽입 코드 ──
pwa_head = """
  <!-- ====== PWA 설정 (자동 삽입) ====== -->
  <link rel="manifest" href="manifest.json">
  <meta name="theme-color" content="#2c5f9e">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="여비정산">
  <link rel="apple-touch-icon" href="icons/icon-192.png">
  <link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
  <!-- ====== /PWA 설정 ====== -->"""

pwa_script = """
  <!-- ====== Service Worker 등록 (자동 삽입) ====== -->
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('[PWA] Service Worker 등록 완료:', reg.scope))
          .catch(err => console.warn('[PWA] Service Worker 등록 실패:', err));
      });
    }
  </script>
  <!-- ====== /Service Worker 등록 ====== -->"""

# </head> 앞에 삽입
if '</head>' in content:
    content = content.replace('</head>', pwa_head + '\n</head>', 1)
    print("✅ <head> 태그에 PWA 메타 삽입 완료")
else:
    print("⚠️  </head> 태그를 찾지 못했습니다. 파일 앞부분에 직접 추가하세요.")

# </body> 앞에 삽입
if '</body>' in content:
    content = content.replace('</body>', pwa_script + '\n</body>', 1)
    print("✅ <body> 태그에 Service Worker 등록 코드 삽입 완료")
else:
    content += pwa_script
    print("⚠️  </body> 태그를 찾지 못해 파일 끝에 추가했습니다.")

# ── index.html 저장 ──
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print()
print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
print("✅ index.html 생성 완료!")
print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
print("다음 단계:")
print("  1. index.html, manifest.json, sw.js, icons/ 폴더를")
print("     GitHub 저장소에 업로드하세요.")
print("  2. Settings → Pages → Branch: main / (root) → Save")
print("  3. 배포 완료! 🎉")
