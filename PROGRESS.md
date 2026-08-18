# 작업 진행 로그

새 세션에서 재개할 때는 이 파일만 읽으면 이어갈 수 있어야 합니다.
브랜치: `feat/numbering-series-legend-duplicate` (base: `main` @ 655823e, "태블릿 서랍 버그 수정 + 현장 사용성 개선")
절대 금지 사항(원 지시 참고): git push, main 커밋/체크아웃, reset --hard/rebase/clean, 커밋 amend, 태그 삭제/이동, 레포 밖 파일, 패키지 설치, service-worker.js CACHE_VERSION 변경.

## 0단계 - 완료
- 커밋 해시: (이 커밋)
- 바꾼 것:
  - index.html(5,991줄) 전체를 구조 맵(grep) + 핵심 구간 직접 읽기로 파악
  - **분할 여부 판단: 분할하지 않음(index.html 유지)** — 이유는 아래 "판단 필요" 절 참고
  - test-fixtures/legacy-project.json 회귀 기준 파일 생성(0단계 b)
- 새로 만든 함수/파일:
  - `test-fixtures/legacy-project.json` (도면 2장, 마커 6개: 화살표 4 + 점 1 + 범위 1, 사진 1장, uid 없음, 현재 DEFECT_TYPES typeKey 사용)
- 알려진 미해결 문제: 없음
- 다음 단계에서 주의할 점:
  - 마커 배열은 `d.markers` 순서 = 화면 번호(현재는 idx+1 암묵적). 1단계에서 `m.seq` 필드로 명시화 예정.
  - 마커 필드 스키마(현재): `{id, typeKey, xPct, yPct, angle, lenMult, numRot, note, rectXPct, rectYPct, rectWPct, rectHPct, rectAngle, rptType, rptMember, rptDefect, rptWidth, rptLength, rptCount, rptTag, photos}`
  - 마커 생성 지점은 5곳: `addMarkerAt`, `addMarkerWithGesture`, `handleRectCreateClick`, `buildMarkerFromRow`(CSV 불러오기), `applyTableInputRows`(표로 입력, 2곳: 신규/편집모드 fallback)
  - 프로젝트 저장/자동저장은 `buildProjectSnapshot` / `buildProjectMetaSnapshot`+`buildProjectImagesSnapshot`+`mergeMetaAndImages`가 마커 객체를 그대로(구조분해로 photos만 분리) 직렬화하므로, 마커 객체에 새 필드를 추가하기만 하면 저장/자동저장/불러오기에 자동으로 실린다 — 별도 스키마 코드 수정 불필요.
  - 도면 전환 없이도 모든 도면의 번호가 정확해야 하는 내보내기(CSV/XLSX/PNG/PDF/사진ZIP)는 활성 도면 렌더링(`renderTable`)에 의존하지 않으므로, 내보내기 함수 시작부에서 전체 도면 재채번을 별도로 호출해야 함(1단계에서 처리).

### 판단 필요 — 0(a) 파일 분할 여부
**결론: 분할하지 않음.** 근거:
1. 이 프로젝트는 번들러 없는 순수 정적 PWA(스크립트 태그 직접 로드, 오프라인 캐시)라 분할해도 빌드상 이점이 없고, `<script src>` 여러 개 + 서비스워커 APP_SHELL 갱신만 늘어난다.
2. 전체 스크립트가 사실상 하나의 IIFE(`(function(){ "use strict"; … })()`)에서 `drawings`/`activeDrawingId`/`undoStack` 등 공유 상태를 자유롭게 참조한다. model/renderer/export/ui로 나누면 대부분의 함수가 여러 "모듈"의 상태를 동시에 필요로 해(예: `DEFECT_TYPES`는 캔버스 렌더링·범례·CSV/XLSX·표 입력·퀵입력 시트 어디서나 쓰임; `renderTable`은 모델을 직접 변경하면서 동시에 DOM을 그림) 경계가 인위적이라 리팩터링 자체가 큰 회귀 위험을 만든다.
3. 지금 필요한 1~4단계 작업(번호체계, 계열 시스템, 범례, 복제)은 기존 섹션 주석 구조(`// ---------- 제목 ----------`) 안에서 함수를 추가/확장하는 방식으로 충분히 수행 가능 — 파일 분할이 선행 조건이 아님.
4. 이미 각 기능이 `// ---------- 섹션명 ----------` 주석으로 명확히 구획돼 있어(테마/태블릿/유형정의/상태/토스트/도형그리기/실행취소/내보내기/자동저장 등) 탐색성이 index.html 하나로도 나쁘지 않음을 확인.

다만 5단계 이후(계열 편집 UI, 범례 드래그, 복제 UI)가 더해지면 파일이 7,000줄을 넘을 수 있어, **그 시점에 다시 분할을 검토할 가치가 있음**을 남겨둔다(지금 강제로 안 하는 것이지 "영구히 안 한다"는 결론은 아님).
