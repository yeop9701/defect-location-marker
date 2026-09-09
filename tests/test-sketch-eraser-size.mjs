/* 선 지우개의 굵기가 실제로 변하는지 — 실제 브라우저 검사.

   보는 것 : 선 지우개(E)를 들면 「굵기」 자리에 「지우개 굵기」가 대신 나오는지, 그 값이 실제
   지우는 반경과 커서의 점선 동그라미에 그대로 반영되는지, 그리고 굵게 해 두었다가 직선으로
   돌아왔을 때 그리는 선까지 굵어져 있지는 않은지.

   왜 : 예전에는 지우개를 든 채로도 「굵기」 단추(그리는 선의 굵기)만 떠 있었고, 그것을 눌러도
   지우개는 조금도 변하지 않았다 — 화면에 있는 유일한 굵기 조절이 듣지 않으니 "지우개 굵기가
   변하지 않는다"고 할 수밖에 없었다. 이제 도구에 따라 굵기 조절이 바뀌어 달린다.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-sketch-eraser-size.mjs                                                    */
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

const vis = (id) => ev(`(()=>{const e=document.getElementById('${id}'); return !!e && getComputedStyle(e).display!=='none';})()`);
const dbg = () => ev(`(()=>{const d=window.__markerDbg; return { mult:d.sketchEraseMult, tol:d.sketchEraseTol, width:d.sketchWidthMult };})()`);

/* ── 1. 지우개를 들면 굵기 조절이 지우개의 것으로 바뀐다 ─────────────────── */
await ev(`document.querySelector('[data-sketch-tool="line"]').click(); true`);
await sleep(300);
ok(await vis('sketchWidthGroup'), '직선에서는 선 굵기 단추가 보인다');
ok(!(await vis('sketchEraseSizeGroup')), '직선에서는 지우개 굵기가 숨는다');

await ev(`document.querySelector('[data-sketch-tool="sketchErase"]').click(); true`);
await sleep(300);
ok(await vis('sketchEraseSizeGroup'), '선 지우개를 들면 「지우개 굵기」가 나온다');
ok(!(await vis('sketchWidthGroup')), '그때 선 굵기 단추는 숨는다(듣지 않는 조절을 띄워 두지 않는다)');

/* ── 2. 슬라이더를 움직이면 실제 지우는 반경이 그만큼 변한다 ─────────────── */
const base = await dbg();
ok(Math.abs(base.mult - 1) < 0.001, '기본 배율은 100%다', base);
const setSlider = (v) => ev(`(()=>{const s=document.getElementById('sketchEraseSizeSlider');
  s.value='${v}'; s.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
await setSlider(3); await sleep(200);
const big = await dbg();
ok(Math.abs(big.mult - 3) < 0.001, '슬라이더 값이 배율에 그대로 들어간다', big);
ok(Math.abs(big.tol / base.tol - 3) < 0.02, '지우는 반경이 3배가 된다', { 기본: base.tol, 지금: big.tol });
ok(await ev(`document.getElementById('sketchEraseSizeVal').textContent === '300%'`), '옆의 숫자도 300%로 바뀐다');
await setSlider(0.4); await sleep(200);
const small = await dbg();
ok(Math.abs(small.tol / base.tol - 0.4) < 0.02, '가늘게도 그만큼 줄어든다', { 기본: base.tol, 지금: small.tol });

/* ── 3. −/+ 단추(태블릿용)도 같은 값을 움직인다 ─────────────────────────── */
await ev(`document.getElementById('btnSketchErasePlus').click(); true`); await sleep(150);
const stepped = await dbg();
ok(stepped.mult > small.mult, '+ 단추로 한 단계 굵어진다', { 전: small.mult, 후: stepped.mult });
await ev(`document.getElementById('btnSketchEraseMinus').click(); true`); await sleep(150);
ok(Math.abs((await dbg()).mult - small.mult) < 0.001, '− 단추로 되돌아온다');

/* ── 4. 그리는 선의 굵기는 건드리지 않는다 ──────────────────────────────── */
// 지우개를 굵게 쓰다 직선으로 돌아왔을 때 선까지 굵어져 있으면 곤란하다 — 그래서 값을 따로 둔다.
await setSlider(4); await sleep(200);
await ev(`document.querySelector('[data-sketch-tool="line"]').click(); true`);
await sleep(300);
ok(Math.abs((await dbg()).width - base.width) < 0.001, '지우개를 굵게 해도 그리는 선의 굵기는 그대로다');
await ev(`document.querySelector('[data-sketch-tool="sketchErase"]').click(); true`);
await sleep(300);
ok(Math.abs((await dbg()).mult - 4) < 0.001, '지우개로 돌아오면 굵게 해 둔 값이 그대로 살아 있다');

/* ── 5. 굵게 한 지우개는 실제로 더 많이 지운다 ──────────────────────────── */
// 같은 자리를 한 번 훑었을 때, 가는 지우개는 비껴가고 굵은 지우개는 걸리는 선을 준비한다.
const canvasBox = await ev(`(()=>{const c=document.getElementById('markerCanvas').getBoundingClientRect();
  return { l:Math.round(c.left), t:Math.round(c.top), w:Math.round(c.width), h:Math.round(c.height) };})()`);
const cx = canvasBox.l + Math.round(canvasBox.w * 0.35), cy = canvasBox.t + Math.round(canvasBox.h * 0.35);
const strokes = () => ev(`(()=>{const d=window.__markerDbg.getActiveDrawing(); return (d && d.sketch) ? d.sketch.length : -1;})()`);
await ev(`document.querySelector('[data-sketch-tool="line"]').click(); true`);
await sleep(250);
await drag(cdp, [{ x: cx, y: cy }, { x: cx + 220, y: cy }]);
await sleep(300);
const drawn = await strokes();
ok(drawn >= 1, '지울 선을 하나 그었다', { 획: drawn });

// 선에서 살짝 떨어진 자리를 훑는다. 가늘 때는 안 걸리고, 굵을 때는 걸려야 한다.
await ev(`document.querySelector('[data-sketch-tool="sketchErase"]').click(); true`);
await sleep(250);
await setSlider(0.4); await sleep(200);
const off = await ev(`(()=>{const d=window.__markerDbg.getActiveDrawing();
  const c=document.getElementById('markerCanvas').getBoundingClientRect();
  // 지우개 반경(원본 px)을 화면 px로 옮겨, 그 1.6배만큼 선에서 떨어진 자리를 고른다.
  return Math.round(window.__markerDbg.sketchEraseTol * (c.width / d.naturalW) * 1.6);})()`);
await drag(cdp, [{ x: cx + 60, y: cy - off }, { x: cx + 160, y: cy - off }]);
await sleep(300);
ok((await strokes()) === drawn, '가는 지우개는 조금 떨어진 선을 지나쳐 간다', { 획: await strokes() });
await setSlider(4); await sleep(200);
await drag(cdp, [{ x: cx + 60, y: cy - off }, { x: cx + 160, y: cy - off }]);
await sleep(300);
ok((await strokes()) < drawn, '굵게 하면 같은 자리를 훑어도 그 선이 지워진다', { 전: drawn, 후: await strokes() });

await shot(cdp, OUT + 'sketch-eraser-size.png');

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
