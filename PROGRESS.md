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

## 1단계 - 완료
- 커밋 해시: (이 커밋)
- 바꾼 것:
  - 마커에 불변 `uid` 필드 추가(`newMarkerIdPair()` — 기존에도 `id: uid()`였던 값을 그대로 `id`/`uid` 두 필드에 나눠 씀, 새 난수 발급 없음). 마커 생성 5곳(클릭·드래그·범위3클릭·CSV불러오기·표로입력) 모두 적용.
  - 표시번호를 `m.seq` 필드로 명시화. `renumberDrawingMarkers(d, {silent})` 함수 하나로 채번 로직을 모음 — 배열 순서(index+1)와 다르면 seq를 갱신하고, 이미 번호가 있던 마커가 실제로 바뀐 경우(silent 아닐 때)만 재정렬 토스트를 띄움. `renumberAllDrawings()`는 도면 여러 개를 조용히 한 번에 재정렬(내보내기·불러오기 직후용).
  - 재정렬 토스트: "번호 재정렬됨 · N건 변경 (4→3, 5→4 …) · [되돌리기]" — `showToast()`에 `actionLabel`/`onAction` 옵션 추가(있으면 자동으로 sticky). [되돌리기]는 기존 `undo()`를 그대로 호출(재정렬 직전 지점마다 이미 `pushUndo()`가 먼저 호출되고 있어 별도 스택 없이도 Ctrl+Z/Cmd+Z와 동일하게 되돌아감 — 새 실행취소 로직 불필요, 기존 undo 인프라 재사용).
  - CSV/XLSX 내보내기 헤더 맨 끝에 `UID` 열 추가, `번호` 열은 `m.seq` 사용.
  - 사진 ZIP 파일명에 `{번호}_{uid 앞 8자리}_{유형}_{부재명}_{결함명}` 형식으로 uid8 포함.
  - 프로젝트 JSON/자동저장(IndexedDB) 스냅샷은 마커 객체를 그대로 직렬화하므로 별도 코드 변경 없이 uid/seq가 자동으로 실림.
  - `applyProjectData()`가 불러오기 직후 uid 없는 구버전 마커에 `uid = id`로 backfill하고, `renumberAllDrawings({silent:true})`로 전체 도면 seq를 한 번 맞춤(재정렬 토스트 없이).
  - 캔버스 렌더링(메인/썸네일)과 PNG/PDF 내보내기의 번호 라벨을 `idx+1`에서 `m.seq||idx+1`로 전환(2단계의 계열별 독립 채번을 위한 선행 작업, 지금은 값이 동일해 화면상 차이 없음).
- 새로 만든 함수/파일:
  - `newMarkerIdPair()`, `renumberDrawingMarkers(d, opts)`, `renumberAllDrawings(opts)` — 모두 `uid()` 정의 바로 아래(약 1260번째 줄 부근)
  - `showToast()`에 `opts.actionLabel`/`opts.onAction` 지원 추가, `.toast-action` CSS 클래스 신설
- 알려진 미해결 문제:
  - **자동화된 브라우저 회귀 테스트를 실행하지 못함** — 이 환경에는 headless 브라우저 구동 도구(chromium-cli 등)가 설치돼 있지 않고, 이 프로젝트 제약상 `npm install`이 금지돼 있어 설치할 수도 없다. 대신 (a) `node --check`로 스크립트 전체 구문 오류 없음을 확인, (b) `applyProjectData`/`buildProjectSnapshot`/`buildProjectMetaSnapshot`/`buildXLSXBlob`/`buildDefectExportData`/`exportAllPhotosZip` 등 관련 함수 전체를 코드 추적으로 정독해 `test-fixtures/legacy-project.json`(uid/seq 없음)이 문제없이 로드되고, 각 마커에 uid가 채워지고, CSV/XLSX/ZIP에 uid·seq가 올바르게 반영됨을 정적으로 확인했다. 실제 브라우저에서 "프로젝트 불러오기"로 이 픽스처를 열어 도면 2장/마커 4+2건이 뜨는지, CSV를 내려받아 헤더 끝에 UID 열이 있는지 **직접 한 번 확인해 주시길 권장**합니다.
- 다음 단계에서 주의할 점:
  - 2단계(계열 시스템)는 `renumberDrawingMarkers`를 "도면 전체 하나의 카운터"에서 "series별 독립 카운터"로 바꿔야 한다 — 함수 시그니처와 호출부(렌더/내보내기 쪽)는 이미 seq 필드를 통해 간접 참조하도록 정리해뒀으므로, 이 함수 내부 로직만 series 그룹핑으로 교체하면 된다.
  - 마커 생성 지점이 늘어나면(예: 4단계 복제) 반드시 `newMarkerIdPair()`를 재사용해 uid를 새로 발급할 것 — 복제된 마커는 새 uid를 받아야 하고(원본과 동일 uid면 안 됨), seq는 대상 도면에서 `renumberDrawingMarkers`가 다시 매겨준다.
