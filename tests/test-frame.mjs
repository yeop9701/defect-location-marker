/* 도면틀(도곽) 검사 — 실제 브라우저에서 저장 결과와 똑같은 캔버스를 만들어, 그 픽셀을 직접
   재서 확인한다. 값만 읽어 비교하면 "코드가 그렇게 되어 있다"는 것밖에 확인하지 못하지만,
   픽셀을 재면 실제로 그렇게 그려졌는지까지 확인된다.

   함께 보는 것 : 「도면틀 조절」 손잡이(1.0 = 기본 도면틀), 도면 제목의 기본 자리와 끌어 옮기기,
   글자 크기가 1.0을 넘어도 실제로 커지는지, 표 값이 두 줄일 때 칸 한가운데에 오는지,
   도면틀을 손봐도 범례가 제자리에 남는지, 이미지 크기 조절(도곽 있을 때·없을 때),
   범례 상자 모양, 미리보기 안에서 표제란 값 고치기, 템플릿에 도면틀·범례가 함께 담기는지.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-frame.mjs                                                              */
import { connect, drag, shot, finish } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// 검사 대상은 '이 검사 파일이 들어 있는 폴더의 index.html' — 어느 폴더에 받아 두었든
// 그대로 돈다. 다른 사본을 시험하려면 APP_URL 환경변수로 덮어쓴다.
const APP = process.env.APP_URL || new URL('../index.html', import.meta.url).href;
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const cdp = await connect(9222);
const ev = (s) => cdp.evaluate(s);
let fails = 0, passes = 0;
const ok = (cond, msg, extra) => {
  if (cond) passes++; else fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + msg + (!cond && extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, { 실제: a, 바람: b });
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg, { 실제: a, 바람: b, 허용: tol });

await cdp.send('DOM.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1400, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: APP });
await sleep(1500);
await ev('try{localStorage.clear()}catch(e){}; true');
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);

/* ── 도면 한 장을 올린다 ─────────────────────────────────────────── */
const r = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#addDrawingInput')` });
await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/plan.png'], objectId: r.result.objectId });
await sleep(1400);
ok(await ev('document.querySelectorAll(".drawing-tab, [data-drawing-id]").length > 0 || !!document.getElementById("mainCanvas")'),
   '도면을 한 장 올렸다');

const setField = (id, v) => ev(`(()=>{ const e=document.getElementById('${id}'); e.value=${JSON.stringify(v)};
  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await setField('projectNameInput', '○○아파트 정밀안전점검 용역');
await setField('siteNameInput', '101동');
await setField('structureTypeInput', '철근콘크리트 벽식구조');
await setField('docTitleInput', '외관조사망도');
await sleep(300);

/* ── 도면틀을 켜면 미리보기가 함께 열린다 ────────────────────────── */
await ev(`(()=>{const c=document.getElementById('titleBlockToggle');
  c.checked = true; c.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(900);
ok(await ev(`document.getElementById('tbPreviewBackdrop').style.display !== 'none'`),
   '도면틀을 켜면 인쇄 미리보기가 열린다');

/* ── 캔버스 픽셀을 재는 도우미 ───────────────────────────────────
   저장 결과와 똑같은 캔버스(#tbPreviewCanvas)에서 바깥쪽부터 처음 만나는 검은 점을 찾는다.
   테두리 바깥은 순백이라, 처음 만나는 점이 곧 도곽 테두리다. */
const MEASURE = `(()=>{
  const cv = document.getElementById('tbPreviewCanvas');
  const g = cv.getContext('2d', { willReadFrequently:true });
  const W = cv.width, H = cv.height;
  const dark = (d,i)=> d[i] < 150;
  const rowAt = y => g.getImageData(0, y, W, 1).data;
  const colAt = x => g.getImageData(x, 0, 1, H).data;
  const midRow = rowAt(Math.round(H*0.5));
  let left = -1, right = -1;
  for(let x=0; x<W; x++){ if(dark(midRow, x*4)){ left = x; break; } }
  for(let x=W-1; x>=0; x--){ if(dark(midRow, x*4)){ right = x; break; } }
  const midCol = colAt(Math.round(W*0.5));
  let top = -1, bottom = -1;
  for(let y=0; y<H; y++){ if(dark(midCol, y*4)){ top = y; break; } }
  for(let y=H-1; y>=0; y--){ if(dark(midCol, y*4)){ bottom = y; break; } }
  /* 표제란(상단 표)의 왼쪽·위 모서리 — 테두리 안쪽에서 다시 처음 만나는 검은 점 */
  const tbRow = rowAt(top + 40);
  let tbLeft = -1;
  for(let x=left+4; x<W; x++){ if(dark(tbRow, x*4)){ tbLeft = x; break; } }
  const tbCol = colAt(left + 15);
  let tbTop = -1;
  for(let y=top+3; y<H; y++){ if(dark(tbCol, y*4)){ tbTop = y; break; } }
  /* 왼쪽 테두리의 "잉크 양"(선 굵기에 비례) — 안티에일리어싱까지 더해 재면 굵기 비교가 된다 */
  let ink = 0;
  for(let x=Math.max(0,left-3); x<left+6; x++) ink += 255 - midRow[x*4];
  return { W, H, left, right, top, bottom,
           mLeft:left, mRight:W-1-right, mTop:top, mBottom:H-1-bottom,
           gapLeft: tbLeft-left, gapTop: tbTop-top, ink };
})()`;

const setFL = async (key, v) => {
  await ev(`(()=>{const s=document.getElementById('ft-${key}');
    s.value='${v}'; s.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
  await sleep(250);
};

/* ══ 1. 테두리와 페이지 사이 여백 ══════════════════════════════════
   요청받은 값(위 0.85 · 아래 0.7 · 좌 0.7 · 우 0.7 배)이 이제 곧 "1.0"이다. */
console.log('\n══ 1. 테두리 ↔ 용지 가장자리 여백 (기본 배수는 전부 1.0) ══');
const m = await ev(MEASURE);
const B = await ev('__markerDbg.FRAME_BASE');
eq(await ev('__markerDbg.frameLayout'), await ev('__markerDbg.FRAME_LAYOUT_DEFAULT'), '처음 값은 전부 기본값이다');
eq(Object.values(await ev('__markerDbg.FRAME_LAYOUT_DEFAULT')), new Array(11).fill(1),
   '기본값은 열한 항목 모두 1.0이다 (1.0 = 지금 쓰는 도면틀)');
near(m.mLeft,   B.marginLeft,   2, `왼쪽 여백 = ${B.marginLeft}px`);
near(m.mRight,  B.marginRight,  2, `오른쪽 여백 = ${B.marginRight}px`);
near(m.mBottom, B.marginBottom, 2, `아래 여백 = ${B.marginBottom}px`);
near(m.mTop,    B.marginTop,    2, `위 여백 = ${B.marginTop}px (아래·좌·우보다 넓다)`);
near(m.mTop / m.mLeft, 0.85/0.7, 0.03, '위:왼쪽 = 0.85 : 0.7');

/* ══ 2. 표와 테두리 사이 간격 ═════════════════════════════════════ */
console.log('\n══ 2. 표·도면 ↔ 테두리 간격 ══');
near(m.gapLeft, B.gapLeft, 2.5, `표 왼쪽 간격 = ${B.gapLeft}px`);
near(m.gapTop,  B.gapTop,  2.5, `표 위쪽 간격 = ${B.gapTop}px`);
ok(m.gapTop > m.gapLeft, '위쪽 간격이 좌우보다 넓다', { 위: m.gapTop, 좌: m.gapLeft });

/* ══ 3. 선 굵기 ═══════════════════════════════════════════════════ */
console.log('\n══ 3. 선 굵기 ══');
eq(await ev('__markerDbg.frameLayout.lineScale'), 1, '기본 선 굵기 배수가 1.0이다');
eq(await ev('__markerDbg.frameAbs("lineScale")'), 0.6, '1.0이 뜻하는 실제 굵기는 예전 굵기의 0.6배다');
await ev(`document.getElementById('tbFrameToggle').click(); true`);
await sleep(300);
ok(await ev(`document.getElementById('tbFramePanel').style.display !== 'none'`),
   '미리보기 아래 「도면틀 조절」이 펼쳐진다');
await setFL('lineScale', 3);
const inkThick = (await ev(MEASURE)).ink;
await setFL('lineScale', 1);
const inkThin = (await ev(MEASURE)).ink;
ok(inkThick > inkThin * 1.8, '선 굵기 배수를 올리면 테두리가 실제로 굵어진다',
   { '3.0배': Math.round(inkThick), '1.0배': Math.round(inkThin) });

/* ══ 4. 글자 — 1.0을 넘겨도 실제로 커져야 한다 ════════════════════ */
console.log('\n══ 4. 표제란 글자 (1.0 위로도 실제로 커질 것) ══');
eq(await ev('__markerDbg.frameLayout.fontScale'), 1, '기본 글자 크기 배수가 1.0이다');
eq(await ev('__markerDbg.frameAbs("fontScale")'), 0.75, '1.0이 뜻하는 실제 크기는 예전 크기의 0.75배다');
const src = readFileSync(ROOT + 'index.html', 'utf8');
ok(/const tbFont = `400 \$\{tbFontPx\}px/.test(src),
   '표제(라벨)와 표 내용(값)이 같은 글꼴·같은 굵기(400 — 굵게 하지 않음)를 쓴다');
ok(!/labelFont|valueFont/.test(src), '라벨용·값용으로 갈라져 있던 글꼴이 하나로 합쳐졌다');
ok(/ctx\.font = `400 \$\{Math\.round\(titleFontPx\)\}px/.test(src), '도면 제목도 굵게 하지 않는다(400)');
ok(!/Math\.max\(9, badgeH\*0\.62\)/.test(src), '글자 크기를 가로막던 배지 높이 상한이 없어졌다');

/* 표제란 띠 안의 "잉크 양"을 세면 글자가 실제로 커졌는지 보인다 */
const tbInk = `(()=>{
  const cv=document.getElementById('tbPreviewCanvas');
  const g=cv.getContext('2d',{willReadFrequently:true});
  const W=cv.width,H=cv.height, hh=Math.round(H*0.28);
  const im=g.getImageData(0,0,W,hh).data;
  let n=0;
  for(let y=0;y<hh;y++){
    let row=0;
    for(let x=Math.round(W*0.05);x<Math.round(W*0.95);x++){ if(im[(y*W+x)*4]<150) row++; }
    if(row < (W*0.9)*0.5) n += row;   /* 표의 가로선(거의 꽉 찬 줄)은 뺀다 */
  }
  return n;})()`;
const fontInk = {};
for (const fs of [0.6, 1.0, 1.4, 1.8]) {
  await setFL('fontScale', fs);
  fontInk[fs] = await ev(tbInk);
}
await setFL('fontScale', 1);
ok(fontInk[1.0] > fontInk[0.6] && fontInk[1.4] > fontInk[1.0] && fontInk[1.8] > fontInk[1.4],
   '글자 크기 배수를 올리면 1.0 위로도 글자가 계속 커진다', fontInk);

/* ══ 5. 표 값이 두 줄일 때 칸 한가운데에 오는가 ═══════════════════ */
console.log('\n══ 5. 표 값의 세로 자리 ══');
/* 왼쪽 칸의 "값" 글자만 걸리는 좁은 세로 띠에서, 표 1행의 위·아래 선과 글자 잉크를 함께 잰다 */
const valueBand = `(()=>{
  const cv=document.getElementById('tbPreviewCanvas');
  const g=cv.getContext('2d',{willReadFrequently:true});
  const W=cv.width,H=cv.height;
  const x0=Math.round(W*0.125), x1=Math.round(W*0.46), hh=Math.round(H*0.30);
  const im=g.getImageData(0,0,W,hh).data;
  const wide=[], ink=[];
  for(let y=0;y<hh;y++){
    let n=0;
    for(let x=x0;x<x1;x++){ if(im[(y*W+x)*4]<150) n++; }
    if(n > (x1-x0)*0.8) wide.push(y);      /* 표의 가로선 */
    else if(n > 0) ink.push(y);            /* 값 글자 */
  }
  /* wide 는 [도곽 위선…, 표 위선…, 가운데 구분선…] 순으로 나온다. 붙어 있는 것끼리 묶는다 */
  if(wide.length===0) return null;
  const bands=[]; let cur=[wide[0]];
  for(let i=1;i<wide.length;i++){ if(wide[i]-wide[i-1]<=2) cur.push(wide[i]); else { bands.push(cur); cur=[wide[i]]; } }
  bands.push(cur);
  const rowTop = bands[1] ? bands[1][bands[1].length-1] : null;   /* 표 위선의 아래끝 */
  const rowBot = bands[2] ? bands[2][0] : null;                   /* 가운데 구분선의 위끝 */
  const inkIn = ink.filter(y=> rowTop!=null && rowBot!=null && y>rowTop && y<rowBot);
  return { rowTop, rowBot, inkTop: inkIn[0], inkBot: inkIn[inkIn.length-1], bands: bands.length };})()`;

await setField('projectNameInput', '○○아파트');
await sleep(400);
const one = await ev(valueBand);
await setField('projectNameInput', '○○아파트 정밀안전점검 및 내진성능평가 용역 제2차 추가분 (2026년 상반기) 101동 외관조사망도 작성분');
await sleep(400);
const two = await ev(valueBand);
ok(two.inkBot - two.inkTop > (one.inkBot - one.inkTop) * 1.6,
   '용역명을 길게 넣으면 값이 두 줄이 된다', { 한줄: one, 두줄: two });
near((two.inkTop + two.inkBot) / 2, (two.rowTop + two.rowBot) / 2, 2.5,
   '두 줄이어도 글자가 칸의 세로 한가운데에 온다');
near((one.inkTop + one.inkBot) / 2, (one.rowTop + one.rowBot) / 2, 2.5, '한 줄일 때도 마찬가지다');

/* ══ 6. 도면 제목의 자리 ══════════════════════════════════════════ */
console.log('\n══ 6. 도면 제목 — 기본은 아랫줄 가운데, 끌어서 옮긴다 ══');
eq(await ev('__markerDbg.docTitlePct'), null, '처음에는 자리를 잡아둔 적이 없다(기본 자리)');
const titleGeo = () => ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  const t=d.__tbTitleBox, f=d.__tbFrameRect;
  if(!t||!f) return null;
  return { cx:(t.x+t.w/2-f.x)/f.w*100, cy:(t.y+t.h/2-f.y)/f.h*100, box:t, frame:f };})()`);
const g0 = await titleGeo();
near(g0.cx, 50, 0.5, '기본 자리는 도곽의 가로 가운데다');
ok(g0.cy > 85, '기본 자리는 도곽의 아랫줄이다', g0.cy);

/* 미리보기 캔버스 위에서 제목을 끌어 옮긴다. 캔버스는 화면에 축소되어 있으므로 그 배율을 되돌리고,
   도면 제목은 도곽 맨 아래라 미리보기 상자 밖으로 밀려나 있을 수 있으므로 먼저 보이게 굴려 둔다. */
const scrollCanvasTo = (py) => ev(`(()=>{const cv=document.getElementById('tbPreviewCanvas');
  const body=cv.closest('.modal-body'); if(!body) return false;
  const scale=cv.getBoundingClientRect().height/cv.height;
  body.scrollTop = Math.max(0, ${py}*scale - body.clientHeight*0.5);
  return true;})()`);
const toScreen = (px, py) => ev(`(()=>{const cv=document.getElementById('tbPreviewCanvas');
  const r=cv.getBoundingClientRect();
  return { x: r.left + ${px} * (r.width/cv.width), y: r.top + ${py} * (r.height/cv.height) };})()`);
await scrollCanvasTo(g0.box.y + g0.box.h / 2);
await sleep(200);
const from = await toScreen(g0.box.x + g0.box.w / 2, g0.box.y + g0.box.h / 2);
const to = await toScreen(g0.box.x + g0.box.w / 2 - g0.frame.w * 0.3, g0.box.y + g0.box.h / 2 - g0.frame.h * 0.1);
ok(from.y > 0 && from.y < 1400, '제목이 미리보기 안에 보이는 자리에 있다', from);
await drag(cdp, [from, to], { steps: 10 });
await sleep(400);
const g1 = await titleGeo();
ok(await ev('!!__markerDbg.docTitlePct'), '끌어 옮기면 제목 자리가 기억된다');
near(g1.cx, g0.cx - 30, 2.5, '왼쪽으로 끈 만큼(도곽 폭의 30%) 제목이 옮겨졌다');
near(g1.cy, g0.cy - 10, 2.5, '위로 끈 만큼(도곽 높이의 10%) 제목이 옮겨졌다');
await setFL('marginLeft', 1.6);
near((await titleGeo()).cx, g1.cx, 0.5, '여백을 바꿔도 잡아둔 제목 자리는 그대로다');
await setFL('marginLeft', 1);
await ev(`document.getElementById('btnFrameTitleReset').click(); true`);
await sleep(300);
eq(await ev('__markerDbg.docTitlePct'), null, '「제목 자리 되돌리기」로 기본 자리로 돌아간다');
near((await titleGeo()).cx, 50, 0.5, '되돌린 제목은 다시 가운데다');

/* ══ 7. 도면틀을 손봐도 범례가 제자리에 남는가 ════════════════════ */
console.log('\n══ 7. 범례(NOTE)의 자리 — 도면틀을 만져도 그대로 ══');
const legendGeo = () => ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  const b=d.__tbLegendBox, a=d.__tbLegendAnchor;
  if(!b||!a) return null;
  return { x:b.x, y:b.y, w:b.w, h:b.h, field:a.field,
    rel:{ x:(b.x-a.area.x)/a.area.w*100, y:(b.y-a.area.y)/a.area.h*100 } };})()`);
const L0 = await legendGeo();
eq(L0.field, 'legendFramePct', '도곽이 있으면 범례 자리는 틀 기준(legendFramePct)으로 잡힌다');
/* 범례를 한 번 끌어 옮겨 자리를 확정한다 */
await scrollCanvasTo(L0.y + L0.h / 2);
await sleep(200);
const lf = await toScreen(L0.x + L0.w / 2, L0.y + L0.h / 2);
const lt = await toScreen(L0.x + L0.w / 2 - 400, L0.y + L0.h / 2 + 300);
await drag(cdp, [lf, lt], { steps: 10 });
await sleep(400);
const L1 = await legendGeo();
ok(Math.abs(L1.x - (L0.x - 400)) < 8 && Math.abs(L1.y - (L0.y + 300)) < 8,
   '미리보기에서 범례를 끌면 끈 만큼 옮겨진다', { 전: [L0.x, L0.y], 후: [L1.x, L1.y] });
ok(await ev(`!!__markerDbg.getActiveDrawing().legendFramePct`), '옮긴 자리가 틀 기준으로 남는다');

for (const [key, v] of [['titleBarScale', 1.5], ['gapTop', 2.5], ['fontScale', 1.3]]) {
  await setFL(key, v);
  const Lx = await legendGeo();
  near(Lx.rel.x, L1.rel.x, 0.5, `「${key}」를 바꿔도 범례가 제자리에 남는다 (가로)`);
  near(Lx.rel.y, L1.rel.y, 0.5, `「${key}」를 바꿔도 범례가 제자리에 남는다 (세로)`);
  await setFL(key, 1);
}
const setImg = async (v) => {
  await ev(`(()=>{const s=document.getElementById('tbPreviewImgScaleSlider');
    s.value='${v}'; s.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
  await sleep(250);
};
await setImg(0.5);
const L2 = await legendGeo();
near(L2.x, L1.x, 1, '이미지 크기를 줄여도 범례는 페이지 위 같은 자리에 그대로 있다 (가로)');
near(L2.y, L1.y, 1, '이미지 크기를 줄여도 범례는 페이지 위 같은 자리에 그대로 있다 (세로)');
near(L2.w, L1.w, 1, '범례 상자 크기도 이미지 크기에 딸려가지 않는다');

/* ══ 8. 이미지 크기 — 도곽 있을 때·없을 때 ════════════════════════ */
console.log('\n══ 8. 이미지 크기 ══');
const drawArea = () => ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  const a=d.__tbDrawArea; return { x:a.x, y:a.y, w:a.w, h:a.h };})()`);
const canvasSize = () => ev(`(()=>{const cv=document.getElementById('tbPreviewCanvas'); return {w:cv.width,h:cv.height};})()`);
const A50 = await drawArea();
await setImg(1);
const A100 = await drawArea();
near(A50.w / A100.w, 0.5, 0.01, '이미지 크기 50%면 도면이 절반 크기로 그려진다');
near(A50.x + A50.w / 2, A100.x + A100.w / 2, 1.5, '줄여도 도면은 같은 자리에 가운데로 놓인다');
await setImg(1.5);
const A150 = await drawArea();
const cs150 = await canvasSize();
near(A150.w / A100.w, 1.5, 0.01, '100%를 넘기면 실제로 더 크게 그려진다');
await setImg(1);
eq(cs150, await canvasSize(), '이미지를 키워도 종이(캔버스) 크기는 그대로다 — 넘치는 만큼 잘린다');

/* 도곽 없이 저장할 때도 같은 규칙 */
const simpleArea = (s) => ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  d.imgScale=${s}; const c=__markerDbg.buildExportCanvasSimple(d);
  const a=d.__tbDrawArea, an=d.__tbLegendAnchor;
  return { cw:c.width, ch:c.height, x:a.x, y:a.y, w:a.w, h:a.h, field:an.field,
           nat:{ w:d.naturalW, h:d.naturalH }, title:d.__tbTitleBox };})()`);
const S100 = await simpleArea(1);
const S50 = await simpleArea(0.5);
eq(S100.title, null, '도곽 없이 저장하면 도면 제목도 그리지 않는다(끌기도 함께 꺼진다)');
eq(S50.field, 'legendPct', '도곽이 없으면 범례 자리는 종이(캔버스) 기준이다');
eq({ w: S100.w, h: S100.h }, { w: S100.nat.w, h: S100.nat.h }, '100%면 도면이 예전처럼 종이를 꽉 채운다');
near(S50.w, S100.nat.w * 0.5, 1, '도곽이 없어도 이미지 크기 50%가 그대로 먹힌다');
eq({ w: S50.cw, h: S50.ch }, { w: S100.cw, h: S100.ch }, '도곽이 없어도 종이 크기는 그대로다');
near(S50.x + S50.w / 2, S100.cw / 2, 1, '줄인 도면은 종이 한가운데에 놓인다');
await ev(`(()=>{__markerDbg.getActiveDrawing().imgScale=1; return true;})()`);

/* ══ 9. 범례 상자의 배경·테두리 ═══════════════════════════════════ */
console.log('\n══ 9. 범례 상자 모양 (배경 · 테두리) ══');
await ev(`(()=>{const s=document.getElementById('legendBgSelect');
  s.value='soft'; s.dispatchEvent(new Event('change',{bubbles:true}));
  const b=document.getElementById('legendBorderToggle');
  b.checked=true; b.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(400);
/* 범례 상자의 왼쪽 선 언저리를 훑어 잉크를 센다 */
const legendEdgeInk = `(()=>{
  const d=__markerDbg.getActiveDrawing(); const b=d.__tbLegendBox;
  const cv=document.getElementById('tbPreviewCanvas');
  const g=cv.getContext('2d',{willReadFrequently:true});
  const y=Math.round(b.y+b.h*0.6);
  const im=g.getImageData(Math.round(b.x-4),y,10,1).data;
  let ink=0; for(let i=0;i<10;i++) ink += 255-im[i*4];
  return ink;})()`;
const edgeOn = await ev(legendEdgeInk);
await ev(`(()=>{const b=document.getElementById('legendBorderToggle');
  b.checked=false; b.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(400);
const edgeOff = await ev(legendEdgeInk);
ok(edgeOff < edgeOn * 0.5, '「범례 테두리」를 끄면 상자 선이 실제로 사라진다',
   { 켬: Math.round(edgeOn), 끔: Math.round(edgeOff) });
eq(await ev('__markerDbg.legendBoxStyle.border'), false, '끈 상태가 값에 남는다');
await ev(`(()=>{const s=document.getElementById('legendBgSelect');
  s.value='none'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(300);
eq(await ev('__markerDbg.legendBoxStyle.bg'), 'none', '범례 배경을 「없음」으로 고를 수 있다');
await ev(`(()=>{const s=document.getElementById('legendBgSelect');
  s.value='soft'; s.dispatchEvent(new Event('change',{bubbles:true}));
  const b=document.getElementById('legendBorderToggle');
  b.checked=true; b.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(300);

/* ══ 10. 미리보기 안에서 표제란 값 고치기 ═════════════════════════ */
console.log('\n══ 10. 미리보기 안에서 표제란 값 고치기 ══');
await ev(`document.getElementById('tbPvFieldsToggle').click(); true`);
await sleep(300);
ok(await ev(`document.getElementById('tbPvFieldsPanel').style.display !== 'none'`),
   '「표제란 내용 고치기」가 펼쳐진다');
eq(await ev(`document.getElementById('pvSiteName').value`), '101동',
   '펼치면 지금 값이 그대로 들어 있다');
await ev(`(()=>{const e=document.getElementById('pvSiteName');
  e.value='102동'; e.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
await sleep(400);
eq(await ev(`document.getElementById('siteNameInput').value`), '102동',
   '미리보기에서 고친 값이 「저장」 창의 진짜 입력칸에도 들어간다');

/* ══ 11. 템플릿에 도면틀·범례가 함께 담기는가 ═════════════════════ */
console.log('\n══ 11. 표제란 템플릿 — 도면틀·범례까지 함께 ══');
await setFL('marginTop', 1.4);
await setFL('fontScale', 1.25);
await ev(`(()=>{const s=document.getElementById('legendBgSelect');
  s.value='solid'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(300);
await ev(`window.prompt = ()=> '검사용 표준틀'; true`);
await ev(`document.getElementById('btnSaveTemplate').click(); true`);
await sleep(400);
/* 값을 흐트러뜨린 뒤 템플릿을 다시 적용해 본다 */
await setFL('marginTop', 0.6);
await setFL('fontScale', 0.6);
await ev(`(()=>{const s=document.getElementById('legendBgSelect');
  s.value='none'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(300);
ok(await ev(`(()=>{const sel=document.getElementById('tbTemplateSelect');
  const i=[...sel.options].findIndex(o=>o.textContent==='검사용 표준틀');
  if(i<0) return false; sel.value=sel.options[i].value; return true;})()`),
   '저장한 템플릿이 목록에 올라온다');
await ev(`document.getElementById('btnApplyTemplate').click(); true`);
await sleep(500);
eq(await ev('__markerDbg.frameLayout.marginTop'), 1.4, '템플릿을 적용하면 도면틀 여백이 함께 돌아온다');
eq(await ev('__markerDbg.frameLayout.fontScale'), 1.25, '글자 크기도 함께 돌아온다');
eq(await ev('__markerDbg.legendBoxStyle.bg'), 'solid', '범례 상자 모양도 함께 돌아온다');
eq(await ev(`document.getElementById('ft-marginTop').value`), '1.4', '손잡이 위치도 함께 맞춰진다');
await ev(`document.getElementById('btnFrameReset').click(); true`);
await sleep(400);
eq(await ev(`JSON.stringify(__markerDbg.frameLayout) === JSON.stringify(__markerDbg.FRAME_LAYOUT_DEFAULT)`), true,
   '「기본값으로」가 모든 값을 기본으로 되돌린다');
eq(await ev(`document.getElementById('ft-titleBarScale').value`), '1', '되돌리면 손잡이 위치도 함께 맞춰진다');

/* ══ 12. 상단표 높이 · 예전(v4) 파일 환산 ═════════════════════════ */
console.log('\n══ 12. 상단표 높이 · 예전 파일 환산 ══');
const bandsOf = () => ev(`(()=>{
  const cv=document.getElementById('tbPreviewCanvas');
  const g=cv.getContext('2d',{willReadFrequently:true});
  const W=cv.width,H=cv.height;
  const col=g.getImageData(Math.round(W*0.5),0,1,H).data;
  const dark=y=>col[y*4]<150;
  let top=-1; for(let y=0;y<H;y++){ if(dark(y)){ top=y; break; } }
  let bands=[], inBand=false;
  for(let y=top; y<H*0.5; y++){
    if(dark(y) && !inBand){ bands.push(y); inBand=true; }
    else if(!dark(y)) inBand=false;
  }
  return bands;})()`);
const bands0 = await bandsOf();
await setFL('titleBarScale', 1.4);
const bands1 = await bandsOf();
ok(bands1.length >= 3 && bands0.length >= 3 && (bands1[2] - bands1[0]) > (bands0[2] - bands0[0]),
   '상단표 높이 배수를 올리면 표가 실제로 높아진다', { 기본: bands0, '1.4배': bands1 });
await setFL('titleBarScale', 1);

const conv = await ev(`__markerDbg.convertLegacyFrameLayout({marginTop:0.8, gapLeft:0.3, fontScale:0.8, lineScale:0.6})`);
near(conv.marginTop * B.marginTop, 108 * 0.8, 0.01, 'v4 파일의 여백 배수를 열면 저장 당시의 실제 크기 그대로다');
near(conv.gapLeft * B.gapLeft, 32 * 0.3, 0.01, 'v4 파일의 간격도 마찬가지다');
near(conv.lineScale * B.lineScale, 0.6, 0.001, 'v4 파일의 선 굵기도 마찬가지다');
eq(await ev('__markerDbg.PROJECT_FILE_VERSION'), 5, '프로젝트 파일 버전이 5로 올랐다');

/* ══ 13. 설정이 남는지 ════════════════════════════════════════════ */
console.log('\n══ 13. 다음에 열어도 그대로인지 ══');
await setFL('fontScale', 1.2);
await sleep(300);
cdp.setDialogAnswer(true);           // "저장하지 않은 변경사항" 확인 대화상자
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);
eq(await ev('__markerDbg.frameLayout.fontScale'), 1.2, '새로 고쳐도 도면틀 설정이 남는다');
eq(await ev('__markerDbg.legendBoxStyle.bg'), 'solid', '범례 상자 모양도 남는다');
await ev(`(()=>{ __markerDbg.frameLayout = Object.assign({}, __markerDbg.FRAME_LAYOUT_DEFAULT); __markerDbg.saveFrameLayout(); return true; })()`);

/* ══ 14. 화면 갈무리 · 콘솔 오류 ══════════════════════════════════ */
console.log('\n══ 14. 화면 갈무리 · 콘솔 오류 ══');
const rr = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#addDrawingInput')` });
await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/plan.png'], objectId: rr.result.objectId });
await sleep(1400);
await ev(`(()=>{const c=document.getElementById('titleBlockToggle');
  c.checked = true; c.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(900);
await ev(`document.getElementById('tbFrameToggle').click(); true`);
await sleep(400);
await shot(cdp, OUT + 'frame-preview.png');
console.log('  ->   ' + OUT + 'frame-preview.png');

const errs = [];
for (const e of cdp.events) {
  if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errs.push(e.params.entry.text);
  if (e.method === 'Runtime.exceptionThrown') errs.push(String(e.params.exceptionDetails.text));
}
const real = errs.filter(t => !/manifest|net::ERR_FAILED|favicon/i.test(t));
ok(real.length === 0, '실행 중 콘솔 오류가 없다', real.slice(0, 5));

console.log('\n' + '─'.repeat(60));
console.log(`  통과 ${passes} · 실패 ${fails}`);
console.log('  결과물 : ' + OUT);
finish(cdp, fails ? 1 : 0);
