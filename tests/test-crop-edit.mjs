/* 자르기 : 잡아 둔 영역 손보기 · px 입력 · 가운데 · 모든 도면 한꺼번에 — 실제 브라우저 검사.

   보는 것 : 한 번 잡은 영역을 상자 안을 끌어 옮길 수 있는지(Shift면 곧게), 여덟 손잡이로 크기를
   바꿀 때 반대쪽이 제자리에 붙박이는지, Shift가 지금 비율을 지키는지, 비율을 걸어 두면 손잡이를
   어느 쪽으로 끌어도 그 비율이 유지되는지, px 칸에 넣은 수가 그대로 상자 크기가 되는지,
   「가운데」가 크기를 건드리지 않고 자리만 옮기는지, 그리고 「모든 도면 자르기」가 크기가 서로 다른
   도면들을 같은 자리(도면 대비 %)로 자르고 실행취소 한 번으로 전부 돌아오는지.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-crop-edit.mjs                                                            */
import { connect, drag, shot, finish } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP = 'file:///C:/Users/user/Desktop/%ED%81%B4%EB%A1%9C%EB%93%9C/defect-location-marker/index.html';
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const cdp = await connect(9222);
const ev = (s) => cdp.evaluate(s);
let fails = 0, passes = 0;
const ok = (cond, msg, extra) => {
  if (cond) passes++; else fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + msg + (!cond && extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg, { 실제: a, 바람: b, 허용: tol });

await cdp.send('DOM.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: APP });
await sleep(1500);
await ev('try{localStorage.clear()}catch(e){}; true');
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);

const r = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#addDrawingInput')` });
await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/plan.png'], objectId: r.result.objectId });
await sleep(1400);
ok(await ev('!!__markerDbg.getActiveDrawing()'), '도면을 한 장 올렸다');

/* 지금 잡혀 있는 영역(캔버스 px 그대로 — 옮기고 늘이는 것은 화면에서 일어나는 일이라 여기서는
   화면 좌표로 재는 편이 맞다). 비율은 원본 기준이므로 그것만 따로 환산한다. */
const RECT = `(()=>{
  const cr = __markerDbg.cropRect; if(!cr) return null;
  const d = __markerDbg.getActiveDrawing();
  const cv = document.getElementById('mainCanvas');
  const sx = d.naturalW/cv.width, sy = d.naturalH/cv.height;
  return { x:cr.x, y:cr.y, w:cr.w, h:cr.h, 원본비율:(cr.w*sx)/(cr.h*sy),
           원본W:Math.round(cr.w*sx), 원본H:Math.round(cr.h*sy), canvasW:cv.width, canvasH:cv.height };
})()`;
const ptAt = async (fx, fy) => await ev(`(()=>{const c=document.getElementById('mainCanvas');const r=c.getBoundingClientRect();
  return { x: Math.round(r.left + r.width*${fx}), y: Math.round(r.top + r.height*${fy}) };})()`);
/* 캔버스 좌표(백엔드 px) → 화면 좌표. 손잡이를 정확히 집으려면 이 환산이 필요하다. */
const screenOf = async (cx, cy) => await ev(`(()=>{const c=document.getElementById('mainCanvas');const r=c.getBoundingClientRect();
  return { x: Math.round(r.left + ${cx}/c.width*r.width), y: Math.round(r.top + ${cy}/c.height*r.height) };})()`);
const pick = (v) => ev(`(()=>{const s=document.getElementById('cropRatioSelect');
  s.value='${v}'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);

await ev('__markerDbg.enterCropMode(); true');
await sleep(300);
await pick('free');
await sleep(150);

/* ── 1. 영역을 잡으면 여덟 개의 손잡이가 생긴다 ──────────────────────── */
let a = await ptAt(0.20, 0.20), b = await ptAt(0.60, 0.55);
await drag(cdp, [a, b]);
await sleep(250);
let rc = await ev(RECT);
ok(!!rc, '영역이 잡힌다');
const hs = await ev(`__markerDbg.cropHandlePoints(__markerDbg.cropRect).map(h=>h.c)`);
ok(hs.length === 8, '손잡이가 여덟 개다', hs);
ok(['nw','n','ne','e','se','s','sw','w'].every(k=> hs.includes(k)), '네 모서리와 네 변 모두에 손잡이가 있다', hs);
ok(await ev(`!!__markerDbg.cropHandleHitTest(__markerDbg.cropRect.x, __markerDbg.cropRect.y, false)`),
   '모서리 자리에서 손잡이가 잡힌다');
ok(await ev(`!__markerDbg.cropHandleHitTest(__markerDbg.cropRect.x + __markerDbg.cropRect.w/2, __markerDbg.cropRect.y + __markerDbg.cropRect.h/2, false)`),
   '상자 한가운데는 손잡이가 아니다(거기서는 옮겨진다)');

/* ── 2. 상자 안을 끌면 옮겨진다 (크기는 그대로) ─────────────────────── */
const before = rc;
let from = await screenOf(before.x + before.w/2, before.y + before.h/2);
let to = { x: from.x + 60, y: from.y + 40 };
await drag(cdp, [from, to]);
await sleep(250);
rc = await ev(RECT);
near(rc.w, before.w, 1.5, '옮겨도 가로 크기는 그대로다', { 전: before.w, 후: rc.w });
near(rc.h, before.h, 1.5, '옮겨도 세로 크기는 그대로다', { 전: before.h, 후: rc.h });
ok(rc.x > before.x + 20 && rc.y > before.y + 10, '끈 방향으로 실제로 옮겨졌다', { 전: before, 후: rc });

/* ── 3. Shift를 누른 채 옮기면 한 축으로만 간다 ─────────────────────── */
const b3 = rc;
from = await screenOf(b3.x + b3.w/2, b3.y + b3.h/2);
to = { x: from.x - 70, y: from.y + 25 };
await drag(cdp, [from, to], { modifiers: 8 }); // 8 = Shift
await sleep(250);
rc = await ev(RECT);
near(rc.y, b3.y, 1.5, 'Shift+옮기기: 많이 끈 쪽(가로)만 움직이고 세로는 붙박인다', { 전: b3.y, 후: rc.y });
ok(rc.x < b3.x - 30, 'Shift+옮기기: 가로로는 끈 만큼 움직인다', { 전: b3.x, 후: rc.x });

/* ── 4. 모서리 손잡이 — 반대쪽 모서리가 제자리에 붙박인다 ───────────── */
const b4 = await ev(RECT);
from = await screenOf(b4.x + b4.w, b4.y + b4.h);   // se 손잡이
to = { x: from.x + 55, y: from.y + 35 };
await drag(cdp, [from, to]);
await sleep(250);
rc = await ev(RECT);
near(rc.x, b4.x, 1.5, '오른쪽 아래를 끌어도 왼쪽 위 x는 붙박인다', { 전: b4.x, 후: rc.x });
near(rc.y, b4.y, 1.5, '오른쪽 아래를 끌어도 왼쪽 위 y는 붙박인다', { 전: b4.y, 후: rc.y });
ok(rc.w > b4.w + 20 && rc.h > b4.h + 10, '끈 만큼 커진다', { 전: b4, 후: rc });

/* ── 5. 왼쪽 위 손잡이 — 오른쪽 아래가 붙박인다 ─────────────────────── */
const b5 = await ev(RECT);
from = await screenOf(b5.x, b5.y);
to = { x: from.x + 40, y: from.y + 30 };
await drag(cdp, [from, to]);
await sleep(250);
rc = await ev(RECT);
near(rc.x + rc.w, b5.x + b5.w, 1.5, '왼쪽 위를 끌어도 오른쪽 변은 붙박인다', { 전: b5.x + b5.w, 후: rc.x + rc.w });
near(rc.y + rc.h, b5.y + b5.h, 1.5, '왼쪽 위를 끌어도 아래 변은 붙박인다', { 전: b5.y + b5.h, 후: rc.y + rc.h });
ok(rc.w < b5.w - 20, '왼쪽 위를 안쪽으로 끌면 작아진다', { 전: b5.w, 후: rc.w });

/* ── 6. 변 손잡이는 한 축만 바꾼다 ──────────────────────────────────── */
const b6 = await ev(RECT);
from = await screenOf(b6.x + b6.w, b6.y + b6.h/2);   // e 손잡이
to = { x: from.x + 45, y: from.y + 30 };             // 위아래로도 흔들어 본다
await drag(cdp, [from, to]);
await sleep(250);
rc = await ev(RECT);
near(rc.h, b6.h, 1.5, '오른쪽 변 손잡이는 세로를 건드리지 않는다', { 전: b6.h, 후: rc.h });
near(rc.y, b6.y, 1.5, '오른쪽 변 손잡이는 위쪽 자리도 건드리지 않는다', { 전: b6.y, 후: rc.y });
ok(rc.w > b6.w + 20, '오른쪽 변 손잡이로 가로만 늘어난다', { 전: b6.w, 후: rc.w });

/* ── 7. Shift + 크기 조절 = 지금 가로:세로를 지킨다 ─────────────────── */
const b7 = await ev(RECT);
const ratio7 = b7.w / b7.h;
from = await screenOf(b7.x + b7.w, b7.y + b7.h);
to = { x: from.x + 60, y: from.y + 5 };   // 가로로만 끌어도 세로가 따라와야 한다
await drag(cdp, [from, to], { modifiers: 8 });
await sleep(250);
rc = await ev(RECT);
near(rc.w / rc.h, ratio7, 0.02, 'Shift로 크기를 바꾸면 지금 가로:세로가 그대로 유지된다', { 전: ratio7, 후: rc.w / rc.h });
ok(rc.w > b7.w + 20, 'Shift로도 실제로 커진다', { 전: b7.w, 후: rc.w });

/* ── 8. 비율을 걸어 두면 손잡이를 어느 쪽으로 끌어도 그 비율이다 ─────── */
await pick('4:3');
await sleep(250);
let b8 = await ev(RECT);
near(b8.원본비율, 4 / 3, 0.01, '비율을 고르면 잡아 둔 영역이 4:3이 된다', b8);
from = await screenOf(b8.x, b8.y + b8.h);            // sw 손잡이
to = { x: from.x - 40, y: from.y + 10 };
await drag(cdp, [from, to]);
await sleep(250);
rc = await ev(RECT);
near(rc.원본비율, 4 / 3, 0.01, '비율이 걸린 채로 모서리를 끌어도 4:3이 유지된다', rc);
b8 = rc;
from = await screenOf(b8.x + b8.w / 2, b8.y);        // n 손잡이(변)
to = { x: from.x, y: from.y - 30 };
await drag(cdp, [from, to]);
await sleep(250);
rc = await ev(RECT);
near(rc.원본비율, 4 / 3, 0.01, '변 손잡이로 늘여도 4:3이 유지된다(반대 축이 함께 따라온다)', rc);
ok(rc.x >= -0.5 && rc.y >= -0.5 && rc.x + rc.w <= rc.canvasW + 0.5 && rc.y + rc.h <= rc.canvasH + 0.5,
   '크기를 바꿔도 영역이 도면 안에 머문다', rc);

/* ── 9. 옮기기는 도면 밖으로 나가지 않는다 ──────────────────────────── */
const b9 = await ev(RECT);
from = await screenOf(b9.x + b9.w / 2, b9.y + b9.h / 2);
to = { x: from.x - 1000, y: from.y - 1000 };
await drag(cdp, [from, to]);
await sleep(250);
rc = await ev(RECT);
ok(rc.x >= -0.5 && rc.y >= -0.5, '왼쪽 위로 멀리 끌어도 도면 안에서 멈춘다', rc);
near(rc.w, b9.w, 1.5, '밖으로 끌어도 크기는 변하지 않는다', { 전: b9.w, 후: rc.w });

/* ── 10. 크기(px) 직접 입력 ─────────────────────────────────────────── */
const setSize = async (id, v) => ev(`(()=>{const el=document.getElementById('${id}');
  el.value='${v}'; el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
const sizeVals = () => ev(`(()=>({ w:document.getElementById('cropSizeW').value, h:document.getElementById('cropSizeH').value }))()`);
let sv = await sizeVals();
rc = await ev(RECT);
ok(Number(sv.w) === rc.원본W && Number(sv.h) === rc.원본H, '크기 칸이 지금 영역의 원본 px를 보여준다', { 칸: sv, 상자: rc });
await setSize('cropSizeW', 800);
await sleep(250);
rc = await ev(RECT);
near(rc.원본W, 800, 2, '가로 800을 넣으면 영역이 원본 800px가 된다', rc);
near(rc.원본비율, 4 / 3, 0.01, '비율이 걸려 있으면 세로가 알아서 따라온다', rc);
await setSize('cropSizeH', 300);
await sleep(250);
rc = await ev(RECT);
near(rc.원본H, 300, 2, '세로 300을 넣으면 영역이 원본 300px가 된다', rc);
near(rc.원본비율, 4 / 3, 0.01, '세로를 넣어도 비율은 그대로다', rc);
ok(await ev(`(()=>{const el=document.getElementById('cropSizeW');
  el.value='12a3'; el.dispatchEvent(new Event('input',{bubbles:true})); return el.value==='123';})()`),
   '크기 칸에서 숫자가 아닌 글자는 걸러진다');
await ev(`(()=>{const el=document.getElementById('cropSizeW'); el.value='999999';
  el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(250);
rc = await ev(RECT);
ok(rc.x + rc.w <= rc.canvasW + 0.5 && rc.y + rc.h <= rc.canvasH + 0.5,
   '도면보다 큰 수를 넣어도 영역이 도면 안에 머문다', rc);

/* ── 11. 「가운데」 ─────────────────────────────────────────────────── */
await setSize('cropSizeW', 700);
await sleep(200);
const b11 = await ev(RECT);
await ev(`(()=>{document.getElementById('btnCropCenter').click(); return true;})()`);
await sleep(250);
rc = await ev(RECT);
near(rc.x + rc.w / 2, rc.canvasW / 2, 1.5, '「가운데」를 누르면 가로 한가운데로 온다', rc);
near(rc.y + rc.h / 2, rc.canvasH / 2, 1.5, '「가운데」를 누르면 세로 한가운데로 온다', rc);
near(rc.w, b11.w, 1.5, '「가운데」는 크기를 건드리지 않는다', { 전: b11.w, 후: rc.w });
near(rc.원본비율, 4 / 3, 0.01, '「가운데」 뒤에도 비율은 그대로다', rc);

await shot(cdp, OUT + 'crop-edit-handles.png');

/* ── 11-2. 상자가 작아지면 변 손잡이는 사라진다(모서리끼리 겹치지 않게) ── */
await setSize('cropSizeW', 200);
await sleep(250);
await ev(`(()=>{ const cv=document.getElementById('mainCanvas');
  __markerDbg.cropRect = { x: 40, y: 40, w: 40, h: 40 }; __markerDbg.renderCanvas(); return true; })()`);
await sleep(200);
const smallHs = await ev(`__markerDbg.cropHandlePoints(__markerDbg.cropRect).map(h=>h.c)`);
ok(smallHs.length === 4 && ['nw','ne','se','sw'].every(k=> smallHs.includes(k)),
   '상자가 작으면 모서리 네 개만 남는다(변 손잡이가 모서리와 겹치지 않게)', smallHs);
await ev(`(()=>{ __markerDbg.cropRect = { x: 40, y: 40, w: 300, h: 40 }; __markerDbg.renderCanvas(); return true; })()`);
await sleep(150);
const flatHs = await ev(`__markerDbg.cropHandlePoints(__markerDbg.cropRect).map(h=>h.c)`);
ok(flatHs.includes('n') && flatHs.includes('s') && !flatHs.includes('e') && !flatHs.includes('w'),
   '납작한 상자에서는 긴 변에만 가운데 손잡이가 남는다', flatHs);

/* ── 11-3. 「새 도면으로」 — 원본은 그대로, 조각만 새 탭으로 ─────────── */
await ev('__markerDbg.exitCropMode(); true'); await sleep(200);
// 조각 안에 들어갈 마커를 하나 찍어 둔다(마커·그린 것이 함께 옮겨져야 한다).
await ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  d.markers = [{ id:'mk1', uid:'mk1', seq:1, typeKey:d.markers[0] ? d.markers[0].typeKey : undefined,
    xPct:40, yPct:40, angle:0 }].filter(m=>m.typeKey!==undefined); return d.markers.length;})()`);
await ev('__markerDbg.enterCropMode(); true'); await sleep(300);
await pick('free'); await sleep(150);
await ev('__markerDbg.cropRect = null; __markerDbg.renderCanvas(); true');
a = await ptAt(0.25, 0.25); b = await ptAt(0.75, 0.75);
await drag(cdp, [a, b]);
await sleep(250);
const beforePiece = await ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  return { n:__markerDbg.drawings.length, w:d.naturalW, h:d.naturalH, name:d.name };})()`);
const wantPiece = await ev(`JSON.stringify(__markerDbg.cropRegionForDrawing(__markerDbg.getActiveDrawing(), __markerDbg.cropRectPct()))`).then(JSON.parse);
await ev(`(()=>{document.getElementById('btnCropToNew').click(); return true;})()`);
await sleep(1200);
const afterPiece = await ev(`(()=>{const d=__markerDbg.getActiveDrawing(); const last=__markerDbg.drawings[__markerDbg.drawings.length-1];
  return { n:__markerDbg.drawings.length, 원본:[d.naturalW,d.naturalH], 원본이름:d.name, 활성:d.id===__markerDbg.getActiveDrawing().id,
    조각:[last.naturalW,last.naturalH], 조각이름:last.name, 조각마커:last.markers.length, crop:__markerDbg.cropMode };})()`);
ok(afterPiece.n === beforePiece.n + 1, '도면이 한 장 늘어난다', afterPiece);
ok(afterPiece.원본[0] === beforePiece.w && afterPiece.원본[1] === beforePiece.h, '원본 도면은 그대로다', afterPiece);
ok(afterPiece.조각[0] === wantPiece.nw && afterPiece.조각[1] === wantPiece.nh, '조각이 잡아 둔 영역 크기다', { 실제: afterPiece.조각, 바람: wantPiece });
ok(/조각 1/.test(afterPiece.조각이름), '조각 이름이 「원본 조각 1」로 붙는다', afterPiece.조각이름);
ok(afterPiece.crop === true, '자르기 모드에 그대로 머문다(이어서 다음 조각을 잡을 수 있다)');
ok(await ev(`__markerDbg.getActiveDrawing().name === ${JSON.stringify(beforePiece.name)}`), '보고 있는 도면은 원본 그대로다(새 탭으로 튀지 않는다)');
// 이어서 한 번 더 — 이름이 2로 늘고, 되돌리면 방금 만든 조각만 사라진다
await ev(`(()=>{document.getElementById('btnCropToNew').click(); return true;})()`);
await sleep(1200);
ok(await ev(`/조각 2/.test(__markerDbg.drawings[__markerDbg.drawings.length-1].name)`), '이어서 만들면 「조각 2」가 된다');
await ev('__markerDbg.undo(); true'); await sleep(600);
ok(await ev('__markerDbg.drawings.length') === beforePiece.n + 1, '실행취소하면 방금 만든 조각만 사라진다');
await ev('__markerDbg.redo(); true'); await sleep(600);
ok(await ev('__markerDbg.drawings.length') === beforePiece.n + 2, '다시하기로 되살아난다');
// 뒷정리 — 아래 「모든 도면 자르기」 검사가 조각들에 방해받지 않도록 지운다
await ev(`(()=>{ const keep = __markerDbg.drawings.filter(d=> !/조각/.test(d.name)).map(d=>d.id);
  __markerDbg.drawings.slice().forEach(d=>{ if(!keep.includes(d.id)) __markerDbg.deleteDrawing(d.id); });
  __markerDbg.setActiveDrawing(keep[0]); return __markerDbg.drawings.length; })()`);
await sleep(400);
await ev('__markerDbg.exitCropMode(); true'); await sleep(200);

/* ── 12. 모든 도면 한꺼번에 자르기 ──────────────────────────────────── */
// 크기가 서로 다른 도면 두 장(사진 도면 2400×1600 + A4 세로 백지 1754×2480)을 두고, 같은 자리를
// 잘랐을 때 "도면 대비 %"가 같아지는지를 본다.
await ev('__markerDbg.exitCropMode(); __markerDbg.addBlankDrawing("a4p"); true');
await sleep(900);
ok(await ev('__markerDbg.drawings.length === 2'), '도면이 두 장이 되었다');
await ev(`(()=>{ __markerDbg.setActiveDrawing(__markerDbg.drawings[0].id); return true; })()`);
await sleep(400);
await ev('__markerDbg.enterCropMode(); true');
await sleep(300);
ok(await ev(`getComputedStyle(document.getElementById('btnCropApplyAll')).display !== 'none'`),
   '도면이 두 장이면 「모든 도면 자르기」 단추가 보인다');
await pick('free');
await sleep(150);
await ev('__markerDbg.cropRect = null; __markerDbg.renderCanvas(); true');
a = await ptAt(0.20, 0.25); b = await ptAt(0.70, 0.65);
await drag(cdp, [a, b]);
await sleep(250);
let pctWanted = await ev(`JSON.stringify(__markerDbg.cropRectPct())`).then(JSON.parse);
const sizesBefore = await ev(`__markerDbg.drawings.map(d=>[d.naturalW, d.naturalH])`);

/* ── 12-1. 먼저 미리보기 창이 뜬다 (확인창 문구 대신 잘릴 자리를 보여준다) ── */
await ev(`(()=>{document.getElementById('btnCropApplyAll').click(); return true;})()`);
await sleep(500);
ok(await ev(`document.getElementById('cropAllBackdrop').style.display !== 'none'`), '「모든 도면 자르기」는 미리보기 창을 먼저 연다');
ok(await ev('__markerDbg.drawings.length') === await ev(`document.querySelectorAll('#cropAllList .crop-all-card').length`),
   '도면 수만큼 축소판이 나온다');
const previewSizes = await ev(`Array.from(document.querySelectorAll('#cropAllList .crop-all-size')).map(e=>e.textContent)`);
ok(previewSizes.length === 2 && previewSizes.every(t=> /→/.test(t) && /px/.test(t)),
   '축소판마다 「지금 크기 → 잘린 뒤 크기」가 적혀 있다', previewSizes);
ok(previewSizes[0] !== previewSizes[1], '도면마다 잘린 뒤 크기가 각자 계산된다', previewSizes);
ok(await ev(`(()=>{const c=document.querySelector('#cropAllList .crop-all-card canvas');
  const g=c.getContext('2d'); const d=g.getImageData(1,1,1,1).data; return d[3]>0;})()`),
   '축소판이 실제로 그려져 있다(잘릴 자리 바깥은 어둡게)');
const foot0 = await ev(`document.getElementById('cropAllFootNote').textContent`);
ok(/2장/.test(foot0) && /MB/.test(foot0), '되돌리기용으로 얼마나 들고 있게 되는지 알려준다', foot0);

/* ── 12-2. 한 장을 빼면 그 도면은 그대로 남는다 ─────────────────────── */
await ev(`(()=>{const cbs=document.querySelectorAll('#cropAllList input[type=checkbox]');
  cbs[1].checked=false; cbs[1].dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(300);
ok(/1장/.test(await ev(`document.getElementById('cropAllFootNote').textContent`)), '뺀 도면은 장수에서 빠진다');
await ev(`(()=>{document.getElementById('btnCropAllRun').click(); return true;})()`);
await sleep(1500);
const partial = await ev(`__markerDbg.drawings.map(d=>[d.naturalW, d.naturalH])`);
ok(partial[0][0] < sizesBefore[0][0], '고른 도면만 잘렸다', { 전: sizesBefore[0], 후: partial[0] });
ok(JSON.stringify(partial[1]) === JSON.stringify(sizesBefore[1]), '뺀 도면은 손대지 않는다', { 전: sizesBefore[1], 후: partial[1] });
await ev('__markerDbg.undo(); true'); await sleep(1000);
ok(JSON.stringify(await ev(`__markerDbg.drawings.map(d=>[d.naturalW, d.naturalH])`)) === JSON.stringify(sizesBefore),
   '되돌리면 원래대로 돌아온다');

/* ── 12-3. 전부 고르고 실행 ─────────────────────────────────────────── */
await ev('__markerDbg.enterCropMode(); true'); await sleep(300);
await pick('free'); await sleep(150);
await ev('__markerDbg.cropRect = null; __markerDbg.renderCanvas(); true');
a = await ptAt(0.20, 0.25); b = await ptAt(0.70, 0.65);
await drag(cdp, [a, b]);
await sleep(250);
pctWanted = await ev(`JSON.stringify(__markerDbg.cropRectPct())`).then(JSON.parse);
await ev(`(()=>{document.getElementById('btnCropApplyAll').click(); return true;})()`);
await sleep(500);
await ev(`(()=>{document.getElementById('btnCropAllSelectAll').click(); return true;})()`);
await sleep(200);
await ev(`(()=>{document.getElementById('btnCropAllRun').click(); return true;})()`);
await sleep(1800);
const sizesAfter = await ev(`__markerDbg.drawings.map(d=>[d.naturalW, d.naturalH])`);
ok(await ev(`document.getElementById('cropAllBackdrop').style.display === 'none'`), '자르고 나면 미리보기 창이 닫힌다');
ok(await ev('__markerDbg.cropMode === false'), '모두 자르고 나면 자르기 모드가 풀린다');
sizesAfter.forEach((s, i) => {
  near(s[0] / sizesBefore[i][0] * 100, pctWanted.w, 0.5, `${i + 1}번째 도면이 잡아 둔 가로 %만큼 잘렸다`, { 전: sizesBefore[i], 후: s });
  near(s[1] / sizesBefore[i][1] * 100, pctWanted.h, 0.5, `${i + 1}번째 도면이 잡아 둔 세로 %만큼 잘렸다`, { 전: sizesBefore[i], 후: s });
});
ok(sizesAfter[0][0] !== sizesAfter[1][0], '원래 크기가 다른 도면은 잘린 뒤에도 각자의 크기를 갖는다', sizesAfter);

/* ── 13. 실행취소 한 번으로 전부 돌아온다 ───────────────────────────── */
await ev('__markerDbg.undo(); true');
await sleep(1200);
const sizesUndone = await ev(`__markerDbg.drawings.map(d=>[d.naturalW, d.naturalH])`);
ok(JSON.stringify(sizesUndone) === JSON.stringify(sizesBefore),
   '실행취소 한 번으로 두 도면이 모두 원래 크기로 돌아온다', { 되돌림: sizesUndone, 원래: sizesBefore });
await ev('__markerDbg.redo(); true');
await sleep(1200);
ok(JSON.stringify(await ev(`__markerDbg.drawings.map(d=>[d.naturalW, d.naturalH])`)) === JSON.stringify(sizesAfter),
   '다시하기도 한 번으로 두 도면이 함께 잘린 상태가 된다');

/* ── 콘솔 오류가 없어야 한다 ─────────────────────────────────────────── */
const errs = [];
for (const e of cdp.events) {
  if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errs.push(e.params.entry.text);
  if (e.method === 'Runtime.exceptionThrown') errs.push(String(e.params.exceptionDetails.text));
}
const real = errs.filter(t => !/manifest|net::ERR_FAILED|favicon/i.test(t));
ok(real.length === 0, '실행 중 콘솔 오류가 없다', real.slice(0, 5));

console.log(`\n통과 ${passes} · 실패 ${fails}`);
finish(cdp, fails ? 1 : 0);
