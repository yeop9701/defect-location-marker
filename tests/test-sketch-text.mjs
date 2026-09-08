/* 그리기 「글자」의 글상자 + 인쇄 미리보기가 한눈에 들어오는지 — 실제 브라우저 검사.

   보는 것 : 글자가 흰 바탕 + 회색 테두리 상자로 그려지는지(픽셀을 직접 재서),
   글자가 그 테두리의 한가운데에 놓이는지, 테두리를 빼면 선이 실제로 사라지고 흰 바탕은 남는지,
   테두리 색을 바꾸면 그 색으로 그려지는지, 골라 둔 글자에도 바로 적용되는지,
   상자 범위가 곧 잡히는 범위인지, 저장·불러오기에서 살아남고 예전 파일은 기본값으로 읽히는지,
   그리고 인쇄 미리보기가 세로로 화면 안에 통째로 들어오는지.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-sketch-text.mjs                                                        */
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
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg, { 실제: a, 바람: b, 허용: tol });

await cdp.send('DOM.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: APP });
await sleep(1500);
await ev('try{localStorage.clear()}catch(e){}; true');
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);

const r = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#addDrawingInput')` });
await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/plan.png'], objectId: r.result.objectId });
await sleep(1400);
ok(await ev('!!__markerDbg.getActiveDrawing()'), '도면을 한 장 올렸다');

/* ── 픽셀을 재는 도우미 ────────────────────────────────────────────
   도곽 없이 저장하는 캔버스(=도면 원본 크기)에 그려 놓고, 글상자가 놓인 자리의 픽셀을 직접 본다.
   글상자 좌표는 앱 자신이 쓰는 sketchTextMetricsNatural()에서 그대로 받아 온다 —
   검사에서 따로 계산하면 "코드가 바뀌었는데 검사만 옛 식으로 통과"하는 일이 생긴다. */
const PROBE = `(()=>{
  const d = __markerDbg.getActiveDrawing();
  const s = d.sketch[0];
  const m = __markerDbg.sketchTextMetricsNatural(d, s);
  const ax = s.pts[0].x/100*d.naturalW, ay = s.pts[0].y/100*d.naturalH;
  const bx = ax + m.boxX, by = ay + m.boxY;
  const cv = __markerDbg.buildExportCanvasSimple(d);
  const g = cv.getContext('2d', { willReadFrequently:true });
  const px = (x,y)=>{ const p = g.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [p[0],p[1],p[2]]; };
  const lum = c => (c[0]*299 + c[1]*587 + c[2]*114)/1000;
  // 테두리 선은 얇아 한 점만 집으면 안티에일리어싱에 걸린다 — 윗변 한가운데를 위아래로 훑어
  // 가장 짙은 점을 테두리로 본다(테두리를 뺐다면 안쪽 흰 바탕이 그대로 잡힌다).
  let edge = [255,255,255];
  for(let dy=-1; dy<=3; dy++){
    const c = px(bx + m.boxW/2, by + dy);
    if(lum(c) < lum(edge)) edge = c;
  }
  // 상자 안쪽(글자가 닿지 않는 왼쪽 여백 한가운데)은 흰 바탕이어야 한다.
  const inner = px(bx + m.padX*0.4, by + m.boxH/2);
  // 글자 잉크의 범위 — 테두리에서 3px 안쪽만 훑는다.
  const pad = 3;
  const x0 = Math.round(bx+pad), y0 = Math.round(by+pad);
  const w = Math.round(m.boxW-pad*2), h = Math.round(m.boxH-pad*2);
  const dat = g.getImageData(x0, y0, w, h).data;
  let ix0 = 1e9, iy0 = 1e9, ix1 = -1, iy1 = -1;
  for(let y=0; y<h; y++) for(let x=0; x<w; x++){
    const i = (y*w+x)*4;
    if((dat[i]*299 + dat[i+1]*587 + dat[i+2]*114)/1000 < 120){
      if(x<ix0) ix0=x; if(x>ix1) ix1=x; if(y<iy0) iy0=y; if(y>iy1) iy1=y;
    }
  }
  return { box:{ x:bx, y:by, w:m.boxW, h:m.boxH }, fontPx:m.fontPx, padX:m.padX, padY:m.padY,
    edge, inner, ink: (ix1<0) ? null : { x0:x0+ix0, x1:x0+ix1, y0:y0+iy0, y1:y0+iy1 } };
})()`;

/* ── 글자 한 개를 놓는다 ─────────────────────────────────────────── */
const putText = (extra) => ev(`(()=>{
  const d = __markerDbg.getActiveDrawing();
  d.sketch = [ Object.assign({ id:'t1', tool:'text', color:'#0b0b0b', width:1,
    pts:[{x:30,y:50}], text:'균열', fontSize:10, angle:0 }, ${JSON.stringify(extra || {})}) ];
  return true; })()`);

await putText();
let p = await ev(PROBE);
ok(p.ink !== null, '글자가 실제로 그려졌다');

/* 1. 기본값 — 흰 바탕에 회색 테두리 */
ok(p.inner[0] > 245 && p.inner[1] > 245 && p.inner[2] > 245,
   '글자 뒤 바탕이 흰색이다', { 잰값: p.inner });
const lum = c => (c[0]*299 + c[1]*587 + c[2]*114)/1000;
ok(lum(p.edge) < 210, '테두리가 그려져 있다(바탕보다 짙다)', { 잰값: p.edge });
ok(Math.max(...p.edge) - Math.min(...p.edge) <= 12, '기본 테두리는 회색이다(R·G·B가 고르다)', { 잰값: p.edge });
ok(await ev(`__markerDbg.SKETCH_TEXT_BORDER_DEFAULT === '#8a8a8a'`), '기본 테두리 색은 #8a8a8a 회색이다');

/* 2. 글자가 테두리의 한가운데에 있다 */
{
  const left = p.ink.x0 - p.box.x, right = (p.box.x + p.box.w) - p.ink.x1;
  const top = p.ink.y0 - p.box.y, bottom = (p.box.y + p.box.h) - p.ink.y1;
  near(left, right, p.fontPx * 0.14, '글자가 테두리의 좌우 한가운데에 있다');
  near(top, bottom, p.fontPx * 0.12, '글자가 테두리의 위아래 한가운데에 있다');
}

/* 3. 예전 글자(필드 없음)도 기본 모양으로 읽힌다 */
ok(await ev(`__markerDbg.textBorderOn({ tool:'text' }) === true
  && __markerDbg.textBorderColor({ tool:'text' }) === '#8a8a8a'`),
   '글상자 필드가 없는 예전 글자도 테두리 있음·회색으로 읽힌다');

/* 4. 테두리를 빼면 선이 사라지고 흰 바탕은 남는다 */
await putText({ boxBorder: false });
p = await ev(PROBE);
ok(lum(p.edge) > 245, '테두리를 빼면 선이 사라진다', { 잰값: p.edge });
ok(p.inner[0] > 245 && p.inner[2] > 245, '테두리를 빼도 흰 바탕은 남는다', { 잰값: p.inner });
ok(p.ink !== null, '테두리를 빼도 글자는 그대로 그려진다');

/* 5. 테두리 색을 바꾸면 그 색으로 그려진다 */
await putText({ boxBorderColor: '#ff00ff' });
p = await ev(PROBE);
ok(p.edge[0] > 150 && p.edge[2] > 150 && p.edge[1] < 150,
   '테두리 색을 바꾸면 그 색으로 그려진다(자홍)', { 잰값: p.edge });

/* 6. 상자 범위가 곧 잡히는 범위다 */
await putText();
{
  const hit = await ev(`(()=>{
    const d = __markerDbg.getActiveDrawing(), s = d.sketch[0];
    const m = __markerDbg.sketchTextMetricsNatural(d, s);
    const ax = s.pts[0].x/100*d.naturalW, ay = s.pts[0].y/100*d.naturalH;
    const P = (nx,ny)=> ({ x: nx/d.naturalW*100, y: ny/d.naturalH*100 });
    const inBox = P(ax + m.boxX + m.boxW*0.92, ay);          // 상자 오른쪽 끝 안쪽
    const outBox = P(ax + m.boxX + m.boxW + m.fontPx*1.5, ay); // 상자에서 한참 오른쪽
    return { inside: !!__markerDbg.sketchHitTest(d, inBox.x, inBox.y, 0),
             outside: !!__markerDbg.sketchHitTest(d, outBox.x, outBox.y, 0) };
  })()`);
  ok(hit.inside === true, '상자 안쪽을 누르면 글자가 잡힌다');
  ok(hit.outside === false, '상자 밖을 누르면 잡히지 않는다');
}

/* 7. 도구줄 손잡이 — 글자 도구일 때만 뜨고, 골라 둔 글자에 바로 적용된다 */
await ev(`(()=>{ document.querySelector('#sketchToolGroup [data-sketch-tool="text"]').click(); return true; })()`);
await sleep(200);
ok(await ev(`document.getElementById('sketchTextGroup').style.display !== 'none'`),
   '글자 도구를 들면 글상자 손잡이가 나타난다');
ok(await ev(`document.getElementById('btnSketchTextBorder').classList.contains('active')`),
   '테두리 단추가 켜진 상태로 시작한다');
await ev(`(()=>{ document.querySelector('#sketchToolGroup [data-sketch-tool="line"]').click(); return true; })()`);
await sleep(150);
ok(await ev(`document.getElementById('sketchTextGroup').style.display === 'none'`),
   '다른 도구를 들면 글상자 손잡이가 사라진다');

await ev(`(()=>{ document.querySelector('#sketchToolGroup [data-sketch-tool="text"]').click();
  document.getElementById('btnSketchTextBorder').click(); return true; })()`);
await sleep(200);
ok(await ev(`__markerDbg.sketchTextBorder === false`), '단추를 누르면 테두리 설정이 꺼진다');
ok(await ev(`!document.getElementById('btnSketchTextBorder').classList.contains('active')`),
   '꺼진 것이 단추에도 보인다');

/* 골라 둔 글자에 바로 적용 */
await ev(`(()=>{ document.getElementById('sketchTextBorderColor').value = '#1188cc';
  document.getElementById('sketchTextBorderColor').dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
await sleep(200);
ok(await ev(`__markerDbg.sketchTextBorderColor === '#1188cc' && __markerDbg.sketchTextBorder === true`),
   '색을 고르면 그 색으로 바뀌고 테두리도 함께 켜진다');

/* 8. 지난번 설정이 새로고침 뒤에도 이어진다 */
await cdp.send('Page.navigate', { url: APP });
await sleep(1600);
ok(await ev(`__markerDbg.sketchTextBorderColor === '#1188cc'`), '고른 테두리 색이 다음 방문에도 이어진다');
await ev(`(()=>{ __markerDbg.setSketchTextBorderColor('#8a8a8a'); return true; })()`);

/* ── 인쇄 미리보기가 한눈에 들어온다 ─────────────────────────────── */
const r2 = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#addDrawingInput')` });
await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/plan.png'], objectId: r2.result.objectId });
await sleep(1400);
await ev(`(()=>{const c=document.getElementById('titleBlockToggle');
  c.checked = true; c.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(1000);

const FIT = `(()=>{
  const bd = document.getElementById('tbPreviewBackdrop');
  const body = bd.querySelector('.modal-body');
  const cv = document.getElementById('tbPreviewCanvas');
  const rc = cv.getBoundingClientRect(), rb = body.getBoundingClientRect();
  return { open: bd.style.display !== 'none',
    canvasH: rc.height, canvasW: rc.width, bodyH: rb.height,
    scrollExtra: body.scrollHeight - body.clientHeight,
    ratio: rc.width / rc.height, natRatio: cv.width / cv.height,
    panelH: bd.querySelector('.modal-panel').getBoundingClientRect().height,
    winH: window.innerHeight };
})()`;

let fit = await ev(FIT);
ok(fit.open, '인쇄 미리보기가 열렸다');
ok(fit.canvasH <= fit.bodyH + 1, '도면 한 장이 미리보기 안에 세로로 다 들어온다',
   { 그림높이: Math.round(fit.canvasH), 본문높이: Math.round(fit.bodyH) });
ok(fit.scrollExtra <= 1, '스크롤을 내리지 않아도 된다', { 넘친높이: Math.round(fit.scrollExtra) });
near(fit.ratio, fit.natRatio, 0.02, '가로세로 비율은 저장 결과 그대로다');
ok(fit.panelH <= fit.winH + 1, '창이 화면 밖으로 자라지 않는다',
   { 창높이: Math.round(fit.panelH), 화면: fit.winH });

/* 「도면틀 조절」을 펼쳐 아래줄이 길어져도 여전히 들어온다 */
await ev(`(()=>{ document.getElementById('tbFrameToggle').click(); return true; })()`);
await sleep(500);
fit = await ev(FIT);
ok(fit.canvasH <= fit.bodyH + 1, '「도면틀 조절」을 펼쳐도 도면이 다 들어온다',
   { 그림높이: Math.round(fit.canvasH), 본문높이: Math.round(fit.bodyH) });
ok(fit.panelH <= fit.winH + 1, '펼친 뒤에도 창이 화면 밖으로 자라지 않는다',
   { 창높이: Math.round(fit.panelH), 화면: fit.winH });
await ev(`(()=>{ document.getElementById('tbFrameToggle').click(); return true; })()`);
await sleep(400);

/* 화면이 낮아져도 따라 맞춘다 */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(500);
fit = await ev(FIT);
ok(fit.canvasH <= fit.bodyH + 1, '화면이 낮아지면 그림도 함께 줄어든다',
   { 그림높이: Math.round(fit.canvasH), 본문높이: Math.round(fit.bodyH) });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);

await shot(cdp, OUT + 'sketch-text-preview.png');

/* ── 콘솔 오류가 없어야 한다 ─────────────────────────────────────── */
const errs = [];
for (const e of cdp.events) {
  if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errs.push(e.params.entry.text);
  if (e.method === 'Runtime.exceptionThrown') errs.push(String(e.params.exceptionDetails.text));
}
const real = errs.filter(t => !/manifest|net::ERR_FAILED|favicon/i.test(t));
ok(real.length === 0, '실행 중 콘솔 오류가 없다', real.slice(0, 5));

console.log(`\n통과 ${passes} · 실패 ${fails}`);
finish(cdp, fails ? 1 : 0);
