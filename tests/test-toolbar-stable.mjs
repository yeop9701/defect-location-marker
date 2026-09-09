/* 도구줄이 캔버스를 밀지 않는지 — 실제 브라우저 검사.

   보는 것 : 모드를 어떻게 바꾸어도(마커·선택·그리기 도구·지우개·이동·자르기, 「자세히」 펼침,
   모눈 켬까지) 도구줄 높이와 캔버스 윗변이 한 픽셀도 변하지 않는지. 예전에는 도구줄이 123~320px
   사이를 오가며 도면이 최대 152px 뛰었다 — 모드를 바꿀 때마다 보고 있던 자리를 눈으로 다시
   찾아야 했다. 모드별 조작을 캔버스 위에 떠 있는 바(.canvas-float-bar)로 옮겨 없앤 문제다.
   함께 보는 것 : 떠 있는 바에 그 모드에 맞는 것만 담기는지, 담길 것이 없는 이동 모드에서는 바가
   사라지는지, 접기가 저장되는지, 바 옆 빈 자리를 누르면 그 클릭이 도면에 닿는지(오버레이가
   도면 위쪽 띠를 죽은 영역으로 만들지 않아야 한다), 그리고 좁은 태블릿 세로 화면에서도 같은지.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-toolbar-stable.mjs                                                        */
import { connect, shot, finish } from './cdp.mjs';
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

await cdp.send('DOM.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: APP });
await sleep(1500);
await ev('try{localStorage.clear()}catch(e){}; true');
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);
const r = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#addDrawingInput')` });
await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/plan.png'], objectId: r.result.objectId });
await sleep(1500);

// 도구줄·안내 줄·캔버스의 자리를 한 번에 잰다. 이 셋이 모드마다 같아야 한다.
const metrics = () => ev(`(()=>{
  const tb=document.querySelector('.toolbar2'), w=document.getElementById('canvasWrap');
  const c=document.getElementById('mainCanvas'), hint=document.querySelector('.toolbar-row-hint');
  const bar=document.getElementById('canvasFloatBar');
  const vis=id=>{const e=document.getElementById(id); return !!e && getComputedStyle(e).display!=='none';};
  return { tbH:Math.round(tb.getBoundingClientRect().height),
           hintH:Math.round(hint.getBoundingClientRect().height),
           wrapH:Math.round(w.clientHeight),
           canvasTop:Math.round(c.getBoundingClientRect().top),
           bar:vis('canvasFloatBar'), barH:bar?Math.round(bar.getBoundingClientRect().height):0,
           sketchRow:vis('sketchToolbar'), crop:vis('cropActions'), brush:vis('eraseBrushGroup'),
           leader:vis('leaderShapeGroup'), order:vis('sketchOrderGroup'), grid:vis('sketchGridDivGroup'),
           panel:vis('hintDetailPanel') };})()`);

/* ── 1. 모드를 바꿔도 도구줄과 캔버스가 그대로다 ───────────────────────── */
const steps = [
  ['마커 찍기',    null],
  ['선택(s)',      `document.getElementById('btnSelectMode').click(); true`],
  ['그리기·직선',  `document.querySelector('[data-sketch-tool="line"]').click(); true`],
  ['그리기·글자',  `document.querySelector('[data-sketch-tool="text"]').click(); true`],
  ['그리기·자유선', `document.querySelector('[data-sketch-tool="pen"]').click(); true`],
  ['모눈 켬',      `document.getElementById('btnSketchGrid').click(); true`],
  ['모눈 끔',      `document.getElementById('btnSketchGrid').click(); true`],
  ['지우개(d)',    `document.getElementById('btnEraseMode').click(); true`],
  ['이동(m)',      `document.getElementById('btnMoveMode').click(); true`],
  ['자르기',       `document.getElementById('btnCropMode').click(); true`],
  ['자세히 펼침',  `document.getElementById('btnHintMore').click(); true`],
  ['자르기 취소',  `document.getElementById('btnCropCancel').click(); true`],
  ['자세히 접음',  `document.getElementById('btnHintMore').click(); true`],
];
const got = {};
for (const [label, js] of steps) {
  if (js) { await ev(js); await sleep(420); }
  got[label] = await metrics();
}
const base = got['마커 찍기'];
for (const [label] of steps) {
  const m = got[label];
  ok(m.tbH === base.tbH, `${label} — 도구줄 높이가 그대로 (${base.tbH}px)`, { 지금: m.tbH });
  ok(m.canvasTop === base.canvasTop, `${label} — 도면 윗변이 제자리 (${base.canvasTop}px)`, { 지금: m.canvasTop });
  ok(m.wrapH === base.wrapH, `${label} — 도면 칸 높이가 그대로 (${base.wrapH}px)`, { 지금: m.wrapH });
  ok(m.hintH === base.hintH, `${label} — 안내 줄은 언제나 한 줄 (${base.hintH}px)`, { 지금: m.hintH });
}

/* ── 2. 떠 있는 바에는 그 모드에서 쓸 것만 담긴다 ───────────────────────── */
ok(got['마커 찍기'].leader && !got['마커 찍기'].sketchRow && !got['마커 찍기'].crop,
   '마커 모드에는 인출선 모양만 뜬다', got['마커 찍기']);
ok(got['선택(s)'].sketchRow && got['선택(s)'].order,
   '선택에서는 그리기 도구줄과 「순서」가 함께 뜬다', got['선택(s)']);
ok(!got['선택(s)'].leader, '그리기·선택에서는 인출선 모양을 내려놓는다(마커에만 뜻이 있다)');
ok(got['모눈 켬'].grid && !got['모눈 끔'].grid, '「모눈 칸」은 모눈을 켰을 때만 뜬다');
ok(got['지우개(d)'].brush && !got['지우개(d)'].sketchRow, '지우개에는 브러시 굵기만 뜬다', got['지우개(d)']);
ok(!got['이동(m)'].bar, '담길 것이 없는 이동 모드에서는 바 자체가 사라진다', got['이동(m)']);
ok(got['자르기'].crop && got['자르기'].bar, '자르기 조작은 떠 있는 바에 있다', got['자르기']);
ok(!got['자르기 취소'].crop, '자르기를 나가면 그 조작은 사라진다');
ok(got['자세히 펼침'].panel && !got['자세히 접음'].panel, '「자세히」는 떠 있는 패널로 펼쳐지고 접힌다');

/* ── 3. 바 옆 빈 자리를 누르면 그 클릭은 도면에 닿는다 ─────────────────── */
// 떠 있는 바를 감싸는 오버레이는 가로로 화면 전체를 덮는다. 그 빈 자리가 클릭을 먹어버리면
// 도면 위쪽 띠 전체가 눌리지 않는 죽은 영역이 된다(pointer-events:none 으로 막아 두었다).
await ev(`document.querySelector('[data-sketch-tool="line"]').click(); true`);
await sleep(300);
const hitTest = await ev(`(()=>{
  const ov=document.getElementById('canvasOverlayTop'), bar=document.getElementById('canvasFloatBar');
  const ob=ov.getBoundingClientRect(), bb=bar.getBoundingClientRect();
  const el=document.elementFromPoint(Math.round(ob.left+12), Math.round(bb.top+bb.height/2));
  return { tag: el ? (el.tagName + '#' + el.id) : '없음' };})()`);
ok(!/canvasOverlayTop|canvasFloatBar/.test(hitTest.tag), '바 옆 빈 자리는 클릭을 가로채지 않는다', hitTest);

/* ── 4. 접기 ─────────────────────────────────────────────────────────── */
const openH = (await metrics()).barH;
await ev(`document.getElementById('btnFloatBarToggle').click(); true`);
await sleep(300);
const shutH = (await metrics()).barH;
ok(shutH < openH, '접으면 바가 작아진다', { 펼침: openH, 접힘: shutH });
ok((await metrics()).canvasTop === base.canvasTop, '접어도 도면은 움직이지 않는다');
ok(await ev(`localStorage.getItem('defectMarkerFloatBarCollapsed_v1') === 'on'`), '접은 상태가 저장된다');
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);
ok(await ev(`document.body.classList.contains('float-bar-collapsed')`), '다시 열어도 접혀 있다');
await ev(`document.getElementById('btnFloatBarToggle').click(); true`);
await sleep(250);
ok(await ev(`localStorage.getItem('defectMarkerFloatBarCollapsed_v1') === 'off'`), '다시 누르면 펼쳐진 상태로 저장된다');

/* ── 5. 좁은 태블릿 세로 화면에서도 같다 ─────────────────────────────── */
// 첫 줄이 한 줄에 안 들어가 감기는 폭에서도, 모드를 바꿀 때 높이가 "변하지 않는" 것이 핵심이다
// (절대 높이는 화면 폭에 따라 달라도 된다).
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);
const r2 = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#addDrawingInput')` });
await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/plan.png'], objectId: r2.result.objectId });
await sleep(1500);
const narrow = await metrics();
const narrowSteps = [
  ['선택', `document.getElementById('btnSelectMode').click(); true`],
  ['지우개', `document.getElementById('btnEraseMode').click(); true`],
  ['자르기', `document.getElementById('btnCropMode').click(); true`],
];
for (const [label, js] of narrowSteps) {
  await ev(js); await sleep(420);
  const m = await metrics();
  ok(m.tbH === narrow.tbH && m.canvasTop === narrow.canvasTop,
     `좁은 화면(820px) — ${label}으로 바꿔도 도구줄·도면이 그대로`,
     { 기준: narrow.tbH, 지금: m.tbH, 윗변: m.canvasTop, 기준윗변: narrow.canvasTop });
}
await shot(cdp, OUT + 'toolbar-stable-tablet.png');

/* ── 콘솔 오류 ───────────────────────────────────────────────────────── */
const errs = [];
for (const e of cdp.events) {
  if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errs.push(e.params.entry.text);
  if (e.method === 'Runtime.exceptionThrown') errs.push(String(e.params.exceptionDetails.text));
}
const real = errs.filter(t => !/manifest|net::ERR_FAILED|favicon/i.test(t));
ok(real.length === 0, '실행 중 콘솔 오류가 없다', real.slice(0, 5));

console.log('\n통과 ' + passes + ' · 실패 ' + fails);
finish(cdp, fails ? 1 : 0);
