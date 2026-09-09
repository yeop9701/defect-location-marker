/* 통합 선택(s) · 그리기 도구 단축키 · Shift 곧게 옮기기 · Ctrl 복제 · 도면 사이 복사 —
   실제 브라우저 검사.

   보는 것 : w를 거치지 않고 도구 키(l·r·c·a·p·t·e)만으로 그리기가 켜지는지, s 하나로 마커와
   그린 것을 함께 고를 수 있는지(범위로도, 클릭으로도), Delete 한 번에 둘 다 지워지고 실행취소
   한 번에 둘 다 돌아오는지, Shift로 끌면 곧게 가는지, Ctrl로 끌면 복제되는지, Ctrl+C/Ctrl+V로
   다른 도면에 붙여넣어지는지, 그리고 새로 넣은 「아주 가는 선」이 실제로 그 굵기로 그려지는지.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-select-copy.mjs                                                          */
import { connect, drag, click, key, shot, finish } from './cdp.mjs';
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

const VK = { KeyA:65, KeyC:67, KeyE:69, KeyL:76, KeyP:80, KeyR:82, KeyS:83, KeyT:84, KeyV:86, KeyW:87, Escape:27, Delete:46 };
const tap = async (code, ch) => key(cdp, { code, keyStr: ch, windowsVirtualKeyCode: VK[code] });
/* 조합키(Ctrl+C 등) — cdp.key는 수식키를 받지 않으므로 직접 흘려보낸다. modifiers: 2 = Ctrl. */
const tapCtrl = async (code, ch) => {
  await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', code, key: ch, windowsVirtualKeyCode: VK[code], modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type:'keyUp', code, key: ch, windowsVirtualKeyCode: VK[code], modifiers: 2 });
};

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

const ptAt = async (fx, fy) => await ev(`(()=>{const c=document.getElementById('mainCanvas');const r=c.getBoundingClientRect();
  return { x: Math.round(r.left + r.width*${fx}), y: Math.round(r.top + r.height*${fy}) };})()`);
/* 도면 대비 %좌표 → 화면 좌표. 도구줄의 줄 수가 바뀌면(선택하면 「순서」 단추가 생기고 안내 줄
   문구가 길어진다) 캔버스가 위아래로 밀리므로, 누르기 직전에 그때 자리로 다시 계산해야 한다. */
const screenOfPct = async (xPct, yPct) => await ev(`(()=>{const c=document.getElementById('mainCanvas');
  const r=c.getBoundingClientRect();
  return { x: Math.round(r.left + ${xPct}/100*r.width), y: Math.round(r.top + ${yPct}/100*r.height) };})()`);
const nStrokes = () => ev(`(__markerDbg.getActiveDrawing().sketch||[]).length`);
const nMarkers = () => ev(`__markerDbg.getActiveDrawing().markers.length`);
const state = () => ev(`(()=>({ tool:__markerDbg.sketchTool, select:__markerDbg.selectMode,
  strokes:__markerDbg.selectedSketchIds.length, markers:__markerDbg.selectedIds.length,
  badge:document.getElementById('modeBadge').textContent }))()`);

/* 캔버스에 포커스를 주고 시작한다 — 단축키는 window에서 받지만, 입력칸에 포커스가 남아 있으면
   일부러 무시하도록 되어 있다(글자를 치는 중에 도구가 바뀌면 안 되기 때문). */
let p = await ptAt(0.5, 0.5);
await click(cdp, p.x, p.y);
await sleep(200);
await ev('__markerDbg.getActiveDrawing().markers = []; __markerDbg.renderCanvas(); true');

/* ── 1. w를 거치지 않고 도구 키만으로 그리기가 켜진다 ───────────────── */
await tap('Escape', 'Escape'); await sleep(150);
ok((await state()).tool === null, '처음에는 그리기가 꺼져 있다', await state());
await tap('KeyL', 'l'); await sleep(200);
ok((await state()).tool === 'line', 'l 하나로 그리기가 켜지고 직선 도구가 잡힌다', await state());
await tap('KeyR', 'r'); await sleep(150);
ok((await state()).tool === 'rect', 'r → 사각형');
await tap('KeyC', 'c'); await sleep(150);
ok((await state()).tool === 'ellipse', 'c → 원');
await tap('KeyA', 'a'); await sleep(150);
ok((await state()).tool === 'arrow', 'a → 화살표');
await tap('KeyP', 'p'); await sleep(150);
ok((await state()).tool === 'pen', 'p → 자유선');
await tap('KeyE', 'e'); await sleep(150);
ok((await state()).tool === 'sketchErase', 'e → 선 지우개');
await tap('KeyT', 't'); await sleep(150);
ok((await state()).tool === 'text', 't → 글자');
ok(await ev(`document.body.classList.contains('mode-sketch')`), '도구 키만 눌러도 그리기 도구줄이 함께 열린다');

/* ── 2. s = 통합 선택 (마커·그린 것 하나의 도구) ────────────────────── */
await tap('KeyS', 's'); await sleep(200);
let st = await state();
ok(st.tool === 'pick' && st.select === true, 's 하나로 통합 선택이 켜진다', st);
ok(/선택/.test(st.badge) && /마커/.test(st.badge), '도면 위 이름표가 「선택」이라고 알린다', st.badge);
await tap('KeyV', 'v'); await sleep(150);
ok((await state()).tool === null, '같은 키를 다시 누르면(v도 같은 뜻) 선택이 꺼진다');
await tap('KeyV', 'v'); await sleep(150);
ok((await state()).tool === 'pick', '옛 키 v로도 같은 통합 선택이 켜진다');

/* ── 3. 선 두 개를 긋는다 ───────────────────────────────────────────── */
await tap('KeyL', 'l'); await sleep(150);
let a = await ptAt(0.15, 0.20), b = await ptAt(0.45, 0.20);
await drag(cdp, [a, b]); await sleep(250);
a = await ptAt(0.15, 0.32); b = await ptAt(0.45, 0.32);
await drag(cdp, [a, b]); await sleep(250);
ok(await nStrokes() === 2, '직선 두 개를 그었다', await nStrokes());

/* ── 4. 마커를 두 개 찍는다 ─────────────────────────────────────────── */
await tap('Escape', 'Escape'); await sleep(200);
p = await ptAt(0.65, 0.55); await click(cdp, p.x, p.y); await sleep(300);
p = await ptAt(0.75, 0.62); await click(cdp, p.x, p.y); await sleep(300);
ok(await nMarkers() >= 2, '마커를 두 개 찍었다', await nMarkers());

/* ── 5. 통합 선택으로 그린 선을 고른다 ──────────────────────────────── */
await tap('KeyS', 's'); await sleep(200);
p = await ptAt(0.30, 0.20);   // 첫 번째 직선 위
await click(cdp, p.x, p.y); await sleep(250);
st = await state();
ok(st.strokes === 1 && st.markers === 0, '선을 누르면 그 선만 골라진다', st);

/* ── 6. 같은 도구로 마커도 고른다 ───────────────────────────────────── */
const mk = await ev(`(()=>{const d=__markerDbg.getActiveDrawing();const cv=document.getElementById('mainCanvas');
  const r=cv.getBoundingClientRect();const m=d.markers[0];
  return { x: Math.round(r.left + m.xPct/100*r.width), y: Math.round(r.top + m.yPct/100*r.height) };})()`);
await click(cdp, mk.x, mk.y); await sleep(250);
st = await state();
ok(st.markers === 1, '마커를 누르면 마커가 골라진다(같은 「선택」 도구로)', st);
ok(st.strokes === 0, '마커를 고르면 그린 선 선택은 놓아준다', st);

/* ── 7. 범위로 끌면 둘 다 잡힌다 ────────────────────────────────────── */
a = await ptAt(0.05, 0.08); b = await ptAt(0.95, 0.85);
await drag(cdp, [a, b]); await sleep(300);
st = await state();
ok(st.strokes === 2 && st.markers >= 2, '빈 곳을 끌어 범위로 고르면 마커와 그린 선이 함께 잡힌다', st);

/* ── 8. Delete 한 번에 둘 다 지워지고, 실행취소 한 번에 둘 다 돌아온다 ─ */
const before = { s: await nStrokes(), m: await nMarkers() };
await tap('Delete', 'Delete'); await sleep(350);
ok(await nStrokes() === 0 && await nMarkers() === 0, 'Delete 한 번에 골라 둔 마커와 그린 선이 함께 지워진다',
   { 선: await nStrokes(), 마커: await nMarkers() });
await ev('__markerDbg.undo(); true'); await sleep(400);
ok(await nStrokes() === before.s && await nMarkers() === before.m,
   '실행취소 한 번으로 둘 다 되살아난다', { 선: await nStrokes(), 마커: await nMarkers(), 원래: before });

/* ── 9. Shift로 끌면 곧게 옮겨진다 ──────────────────────────────────── */
// 여기서부터는 s가 토글이라는 사실에 기대지 않고 도구를 못박아 둔다(앞의 2번에서 토글은 이미 봤다).
await ev("__markerDbg.setSketchTool('pick'); true"); await sleep(150);
// 첫 번째 직선의 한가운데를 그 순간의 화면 좌표로 집는다.
const line0 = await ev(`(()=>{const d=__markerDbg.getActiveDrawing(); const s=d.sketch[0];
  return { x:(s.pts[0].x+s.pts[1].x)/2, y:(s.pts[0].y+s.pts[1].y)/2 };})()`);
p = await screenOfPct(line0.x, line0.y);
await click(cdp, p.x, p.y); await sleep(250);
ok((await state()).strokes === 1, '옮길 선 하나를 골랐다', await state());
const y0 = await ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  const s=d.sketch.find(s=>s.id===__markerDbg.selectedSketchIds[0]); return s.pts[0].y;})()`);
const x0 = await ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  const s=d.sketch.find(s=>s.id===__markerDbg.selectedSketchIds[0]); return s.pts[0].x;})()`);
p = await screenOfPct(line0.x, line0.y);   // 고르면서 도구줄이 한 줄 늘어날 수 있어 다시 잡는다
await drag(cdp, [p, { x: p.x + 80, y: p.y + 30 }], { modifiers: 8 }); // 8 = Shift
await sleep(300);
const moved = await ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  const s=d.sketch.find(s=>s.id===__markerDbg.selectedSketchIds[0]); return { x:s.pts[0].x, y:s.pts[0].y };})()`);
near(moved.y, y0, 0.05, 'Shift+드래그: 세로는 그대로다(곧게 간다)', { 전: y0, 후: moved.y });
ok(moved.x > x0 + 2, 'Shift+드래그: 가로로는 끈 만큼 간다', { 전: x0, 후: moved.x });

/* ── 9-2. 마커(아이콘)도 Shift로 끌면 곧게 옮겨진다 ─────────────────── */
const m0 = await ev(`(()=>{const d=__markerDbg.getActiveDrawing(); const m=d.markers[0];
  return { id:m.id, x:m.xPct, y:m.yPct };})()`);
let mp = await screenOfPct(m0.x, m0.y);
await click(cdp, mp.x, mp.y); await sleep(250);
ok((await state()).markers === 1, '옮길 마커 하나를 골랐다', await state());
mp = await screenOfPct(m0.x, m0.y);
await drag(cdp, [mp, { x: mp.x + 90, y: mp.y + 35 }], { modifiers: 8 });
await sleep(300);
const mMoved = await ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  const m=d.markers.find(m=>m.id==='${m0.id}'); return { x:m.xPct, y:m.yPct };})()`);
near(mMoved.y, m0.y, 0.05, 'Shift+드래그: 마커도 세로는 그대로다', { 전: m0.y, 후: mMoved.y });
ok(mMoved.x > m0.x + 2, 'Shift+드래그: 마커도 가로로는 끈 만큼 간다', { 전: m0.x, 후: mMoved.x });
// 골라 둔 마커를 Shift로 눌렀다 그대로 떼면(끌지 않으면) 고르기에서 빠진다
mp = await screenOfPct(mMoved.x, mMoved.y);
await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x:mp.x, y:mp.y, button:'left', buttons:1, clickCount:1, modifiers:8 });
await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:mp.x, y:mp.y, button:'left', buttons:0, clickCount:1, modifiers:8 });
await sleep(250);
ok((await state()).markers === 0, 'Shift로 눌렀다 그대로 떼면 고르기에서 빠진다(끌면 옮기기)', await state());

/* ── 10. Ctrl로 끌면 복제된다 ───────────────────────────────────────── */
// 앞 단계에서 마커를 고르며 그린 선 선택이 풀렸으므로 다시 하나를 고른다.
p = await screenOfPct(line0.x + 8, line0.y);
await click(cdp, p.x, p.y); await sleep(250);
const n10 = await nStrokes();
p = await ev(`(()=>{const d=__markerDbg.getActiveDrawing();const cv=document.getElementById('mainCanvas');
  const r=cv.getBoundingClientRect();const s=d.sketch.find(s=>s.id===__markerDbg.selectedSketchIds[0]);
  const mx=(s.pts[0].x+s.pts[1].x)/2, my=(s.pts[0].y+s.pts[1].y)/2;
  return { x: Math.round(r.left + mx/100*r.width), y: Math.round(r.top + my/100*r.height) };})()`);
await drag(cdp, [p, { x: p.x + 20, y: p.y + 60 }], { modifiers: 2 }); // 2 = Ctrl
await sleep(300);
ok(await nStrokes() === n10 + 1, 'Ctrl+드래그로 복제본이 하나 늘어난다', { 전: n10, 후: await nStrokes() });
ok((await state()).strokes === 1, '복제본이 곧바로 「고른 것」이 된다', await state());

/* ── 11. 도면 사이 복사 (Ctrl+C → 다른 도면 → Ctrl+V) ───────────────── */
await ev(`(()=>{ __markerDbg.selectedSketchIds = __markerDbg.getActiveDrawing().sketch.map(s=>s.id); return true; })()`);
await ev('__markerDbg.renderCanvas(); true');
const srcCount = await nStrokes();
await tapCtrl('KeyC', 'c'); await sleep(300);
ok(await ev('__markerDbg.sketchClipboard.length') === srcCount, `그린 것 ${srcCount}개가 복사판에 담긴다`);
await ev('__markerDbg.addBlankDrawing("a4l"); true');
await sleep(1000);
ok(await ev('__markerDbg.drawings.length === 2'), '다른 도면(백지)이 하나 더 생겼다');
ok(await nStrokes() === 0, '새 도면에는 아직 그린 것이 없다');
await ev("__markerDbg.setSketchTool('pick'); true"); await sleep(200);
await tapCtrl('KeyV', 'v'); await sleep(400);
ok(await nStrokes() === srcCount, `다른 도면에 그린 것 ${srcCount}개가 붙여넣어진다`, await nStrokes());
st = await state();
ok(st.strokes === srcCount, '붙여넣은 것이 곧바로 골라져 있어 바로 끌어 옮길 수 있다', st);
ok(await ev(`__markerDbg.drawings[0].sketch.length === ${srcCount}`), '복사해 온 원래 도면은 그대로다');
/* 같은 도면에 다시 붙이면 겹치지 않게 비껴 놓인다 */
await tapCtrl('KeyV', 'v'); await sleep(400);
ok(await nStrokes() === srcCount * 2, '같은 도면에 한 번 더 붙이면 그만큼 더 늘어난다', await nStrokes());

/* ── 12. 「아주 가는 선」 ────────────────────────────────────────────── */
const thin = await ev(`(()=>{const b=document.querySelector('#sketchWidthGroup [data-sketch-width="0.35"]');
  if(!b) return null; b.click(); return __markerDbg.sketchWidthMult;})()`);
ok(thin === 0.35, '「아주 가는 선」 단추가 있고 누르면 그 굵기가 잡힌다', thin);
await tap('KeyL', 'l'); await sleep(150);
a = await ptAt(0.20, 0.70); b = await ptAt(0.60, 0.70);
await drag(cdp, [a, b]); await sleep(300);
const w12 = await ev(`(()=>{const d=__markerDbg.getActiveDrawing(); const s=d.sketch[d.sketch.length-1];
  return s.width;})()`);
ok(w12 === 0.35, '새로 그은 선이 그 굵기로 저장된다', w12);
ok(await ev(`(()=>{const b=document.querySelector('#sketchWidthGroup [data-sketch-width="0.35"]');
  return b.classList.contains('active');})()`), '도구줄에서 지금 굵기가 「아주 가는 선」으로 표시된다');

/* ── 13. 방향키 = 옮기기 · Alt+방향키 = 돌리기 (마커·그린 것 같은 약속) ─ */
const arrow = async (dir, mods) => {
  const vk = { ArrowLeft:37, ArrowUp:38, ArrowRight:39, ArrowDown:40 }[dir];
  await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', code:dir, key:dir, windowsVirtualKeyCode:vk, modifiers: mods||0 });
  await cdp.send('Input.dispatchKeyEvent', { type:'keyUp', code:dir, key:dir, windowsVirtualKeyCode:vk, modifiers: mods||0 });
  await sleep(160);
};
// 검사할 도면을 깨끗하게 다시 만든다 — 앞 단계에서 붙여넣기로 획이 여럿 겹쳐 있다.
await ev(`(()=>{const d=__markerDbg.getActiveDrawing(); d.sketch=[]; d.markers=[]; __markerDbg.renderCanvas(); return true;})()`);
await ev("__markerDbg.setSketchTool('line'); true"); await sleep(150);
a = await ptAt(0.20, 0.30); b = await ptAt(0.50, 0.30);
await drag(cdp, [a, b]); await sleep(250);
await tap('Escape', 'Escape'); await sleep(150);
p = await ptAt(0.70, 0.45); await click(cdp, p.x, p.y); await sleep(300);
await ev("__markerDbg.setSketchTool('pick'); true"); await sleep(150);
// 그린 것과 마커를 함께 골라 둔 상태를 만든다(둘을 함께 고르는 것 자체는 7번에서 이미 확인했으므로,
// 여기서는 방향키의 뜻만 보기 위해 상태를 곧바로 세운다).
await ev(`(()=>{ const d=__markerDbg.getActiveDrawing();
  __markerDbg.selectedSketchIds = d.sketch.map(s=>s.id);
  __markerDbg.selectedIds = d.markers.map(m=>m.id);
  __markerDbg.renderCanvas(); __markerDbg.updateModeHint(); return true; })()`);
await sleep(250);
st = await state();
ok(st.strokes === 1 && st.markers === 1, '그린 것 하나와 마커 하나를 함께 골랐다', st);
const snap = () => ev(`(()=>{const d=__markerDbg.getActiveDrawing(); const s=d.sketch[0]; const m=d.markers[0];
  return { sx:s.pts[0].x, sy:s.pts[0].y, sAng:s.angle||0, mx:m.xPct, my:m.yPct, mAng:m.angle||0 };})()`);
const s0 = await snap();
await arrow('ArrowRight');
const s1 = await snap();
ok(s1.sx > s0.sx && s1.mx > s0.mx, '방향키 한 번에 그린 것과 마커가 함께 오른쪽으로 간다', { 전: s0, 후: s1 });
near(s1.sAng, s0.sAng, 0.001, '방향키는 돌리지 않는다(그린 것)', { 전: s0.sAng, 후: s1.sAng });
near(s1.mAng, s0.mAng, 0.001, '방향키는 돌리지 않는다(마커) — 예전에는 ←/→가 마커를 회전시켰다', { 전: s0.mAng, 후: s1.mAng });
await arrow('ArrowDown', 8); // Shift = 10px
const s2 = await snap();
ok((s2.my - s1.my) > (s1.mx - s0.mx) * 3, 'Shift+방향키는 한 번에 10px씩 간다', { 한칸: s1.mx - s0.mx, 열칸: s2.my - s1.my });
await arrow('ArrowRight', 1); // Alt = 돌리기
const s3 = await snap();
near(s3.mAng, s0.mAng + 10, 0.001, 'Alt+→ 는 마커를 10° 돌린다', { 전: s2.mAng, 후: s3.mAng });
ok(Math.abs(s3.sAng - s2.sAng) > 0.5 || Math.abs(s3.sy - s2.sy) > 0.05, 'Alt+→ 는 그린 것도 함께 돌린다', { 전: s2, 후: s3 });
near(s3.mx, s2.mx, 0.001, 'Alt+방향키는 옮기지 않는다', { 전: s2.mx, 후: s3.mx });

/* ── 14. 안내 줄은 한 줄 + 「자세히」 ────────────────────────────────── */
const hintState = () => ev(`(()=>{const h=document.getElementById('modeHint');
  return { text:h.textContent, more:!!h.querySelector('.hint-more'),
    moreText: h.querySelector('.hint-more') ? h.querySelector('.hint-more').textContent : '',
    detail:!!h.querySelector('.hint-detail'), expanded:__markerDbg.modeHintExpanded };})()`);
let hs2 = await hintState();
ok(hs2.more, '안내 줄에 「자세히」 단추가 있다', hs2);
ok(!hs2.detail && !hs2.expanded, '처음에는 접혀 있다', hs2);
ok(hs2.text.length < 150, '접힌 안내 줄은 한 줄로 짧다', { 길이: hs2.text.length, 글: hs2.text });
await ev(`(()=>{document.querySelector('#modeHint .hint-more').click(); return true;})()`);
await sleep(250);
hs2 = await hintState();
ok(hs2.detail && hs2.expanded, '누르면 자세한 안내가 펼쳐진다', hs2);
ok(/간단히/.test(hs2.moreText), '펼친 뒤에는 단추가 「간단히」로 바뀐다', hs2.moreText);
ok(hs2.text.length > 150, '펼치면 전체 안내가 보인다', { 길이: hs2.text.length });
// 도구를 바꿔도 펼친 상태는 이어진다(다시 그릴 때마다 접히면 읽던 중에 사라진다)
await tap('KeyL', 'l'); await sleep(200);
ok((await hintState()).detail, '도구를 바꿔도 펼친 상태가 이어진다');
await ev(`(()=>{document.querySelector('#modeHint .hint-more').click(); return true;})()`);
await sleep(200);
ok(!(await hintState()).detail, '다시 누르면 접힌다');
ok(await ev(`localStorage.getItem('defectMarkerHintExpanded_v1') === 'off'`), '접고 편 상태가 저장된다');

await shot(cdp, OUT + 'select-copy.png');

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
