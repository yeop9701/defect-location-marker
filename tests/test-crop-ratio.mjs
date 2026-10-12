/* 자르기의 「비율 고정」 — 실제 브라우저 검사.

   보는 것 : 비율을 고르면 그 비율의 영역이 곧바로 잡히는지, 어느 방향으로 끌어도(가로로만, 위로,
   도면 밖으로) 그 비율이 지켜지면서 도면 안에 머무는지, Alt로 이번만 무시되는지, ⇄ 로 가로·세로가
   바뀌는지, 「직접 입력…」이 먹는지, 그리고 무엇보다 **실제로 잘려 나온 그림**의 가로:세로가
   고른 값과 같은지. 비율은 화면 위 상자가 아니라 원본 픽셀 기준이므로, 전부 원본 크기로 환산해 잰다.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-crop-ratio.mjs                                                          */
import { connect, drag, shot, finish } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';
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

/* 지금 잡혀 있는 영역을 "원본 픽셀"로 환산해 돌려준다 — 비율은 화면이 아니라 원본 기준이다. */
const RECT = `(()=>{
  const d = __markerDbg.getActiveDrawing();
  const cv = document.getElementById('mainCanvas');
  const cr = __markerDbg.cropRect;
  if(!cr) return null;
  const sx = d.naturalW/cv.width, sy = d.naturalH/cv.height;
  return { x:cr.x*sx, y:cr.y*sy, w:cr.w*sx, h:cr.h*sy, 비율:(cr.w*sx)/(cr.h*sy),
    canvasW:cv.width, canvasH:cv.height, cx:cr.x, cy:cr.y, cw:cr.w, ch:cr.h,
    원본W:d.naturalW, 원본H:d.naturalH };
})()`;

/* 캔버스 위 한 점(화면 좌표) */
const ptAt = async (fx, fy) => await ev(`(()=>{const c=document.getElementById('mainCanvas');const r=c.getBoundingClientRect();
  return { x: Math.round(r.left + r.width*${fx}), y: Math.round(r.top + r.height*${fy}) };})()`);

/* ── 1. 자르기 모드에 들어가면 비율 손잡이가 보인다 ───────────────────────── */
await ev('__markerDbg.enterCropMode(); true');
await sleep(300);
const ui0 = await ev(`(()=>({
  actions: getComputedStyle(document.getElementById('cropActions')).display,
  sel: document.getElementById('cropRatioSelect').value,
  swap: getComputedStyle(document.getElementById('btnCropRatioSwap')).display,
  custom: getComputedStyle(document.getElementById('cropRatioCustom')).display,
  hint: document.getElementById('modeHint').textContent,
}))()`);
ok(ui0.actions !== 'none', '자르기 모드에서 「자르기 적용」 줄이 보인다', ui0);
ok(ui0.sel === 'free', '비율은 처음에 「자유」다', ui0);
ok(ui0.swap === 'none', '자유일 때는 ⇄ 단추가 숨어 있다', ui0);
ok(ui0.custom === 'none', '「직접 입력…」 칸은 고르기 전에는 숨어 있다', ui0);
// 안내 줄은 34단계에서 "한 줄 + 자세히 ▾"로 나뉘었다 — 비율이 자유일 때는 한 줄에 비율 이야기가
// 없고(고정했을 때만 적힌다), 자세한 안내는 「자세히」를 눌러야 나온다.
ok(/자르기/.test(ui0.hint) && !/비율 고정/.test(ui0.hint), '안내 줄이 자르기 모드임을 한 줄로 알린다', ui0.hint);

/* ── 2. 자유일 때는 끈 그대로 잡힌다 ──────────────────────────────────── */
let a = await ptAt(0.15, 0.20), b = await ptAt(0.75, 0.40);
await drag(cdp, [a, b]);
await sleep(250);
let rc = await ev(RECT);
ok(!!rc, '자유 비율에서 영역이 잡힌다');
near(rc.cw, (b.x - a.x), 3, '자유: 가로가 끈 만큼이다');
near(rc.ch, (b.y - a.y), 3, '자유: 세로가 끈 만큼이다');

/* ── 3. 비율을 고르면 그 자리에서 영역이 그 비율로 바뀐다 ───────────────── */
const pick = (v) => ev(`(()=>{const s=document.getElementById('cropRatioSelect');
  s.value='${v}'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await pick('4:3');
await sleep(250);
rc = await ev(RECT);
near(rc.비율, 4 / 3, 0.01, '4:3을 고르면 이미 잡아 둔 영역이 곧바로 4:3이 된다', rc);
ok(rc.w <= rc.원본W + 1 && rc.h <= rc.원본H + 1, '비율을 맞춘 영역이 도면을 넘지 않는다', rc);
const ui1 = await ev(`(()=>({ swap:getComputedStyle(document.getElementById('btnCropRatioSwap')).display,
  hint:document.getElementById('modeHint').textContent }))()`);
ok(ui1.swap !== 'none', '비율을 고르면 ⇄ 단추가 나타난다', ui1);
ok(/4 : 3/.test(ui1.hint), '안내 줄이 지금 걸린 비율을 알린다', ui1.hint);

/* ── 4. 가로로만 끌어도 4:3 상자가 된다 ───────────────────────────────── */
a = await ptAt(0.10, 0.50); b = await ptAt(0.60, 0.52);
await drag(cdp, [a, b]);
await sleep(250);
rc = await ev(RECT);
near(rc.비율, 4 / 3, 0.01, '가로로만 끌어도 4:3이 유지된다', rc);
ok(rc.w > 10, '가로로만 끌어도 영역이 생긴다', rc);

/* ── 5. 위·왼쪽으로 끌어도(음의 방향) 비율이 지켜진다 ─────────────────── */
a = await ptAt(0.80, 0.80); b = await ptAt(0.40, 0.60);
await drag(cdp, [a, b]);
await sleep(250);
rc = await ev(RECT);
near(rc.비율, 4 / 3, 0.01, '왼쪽 위로 끌어도 4:3이 유지된다', rc);
ok(rc.cx >= -0.5 && rc.cy >= -0.5, '왼쪽 위로 끌어도 도면 밖으로 나가지 않는다', rc);

/* ── 6. 도면 밖까지 끌면 안쪽에서 멈춘다(비율은 그대로) ────────────────── */
a = await ptAt(0.05, 0.10); b = await ptAt(1.6, 1.6);
await drag(cdp, [a, b]);
await sleep(250);
rc = await ev(RECT);
near(rc.비율, 4 / 3, 0.01, '도면 밖까지 끌어도 4:3이 유지된다', rc);
ok(rc.cx + rc.cw <= rc.canvasW + 0.5 && rc.cy + rc.ch <= rc.canvasH + 0.5,
   '도면 밖까지 끌어도 영역이 도면 안에 머문다', rc);

/* ── 7. Alt를 누른 채 끌면 이번만 비율을 무시한다 ─────────────────────── */
// 잡아 둔 영역 안에서 끌면 이제 "새로 잡기"가 아니라 "옮기기"다(34단계) — 새로 끄는 동작을 보려면
// 먼저 잡아 둔 것을 놓아야 한다. 앞의 6번이 도면 거의 전체를 잡아 두었으므로 여기서 비워 준다.
await ev('__markerDbg.cropRect = null; __markerDbg.renderCanvas(); true');
a = await ptAt(0.20, 0.20); b = await ptAt(0.80, 0.35);
await drag(cdp, [a, b], { modifiers: 1 }); // 1 = Alt
await sleep(250);
rc = await ev(RECT);
near(rc.cw, (b.x - a.x), 3, 'Alt+드래그: 가로가 끈 만큼이다(비율 무시)', rc);
near(rc.ch, (b.y - a.y), 3, 'Alt+드래그: 세로가 끈 만큼이다(비율 무시)', rc);
ok(await ev('__markerDbg.cropRatioValue() > 0'), 'Alt로 무시해도 고정한 비율 자체는 남아 있다');

/* ── 8. ⇄ 로 가로·세로가 뒤집힌다 ─────────────────────────────────────── */
await ev(`(()=>{document.getElementById('btnCropRatioSwap').click(); return true;})()`);
await sleep(250);
const sw = await ev(`(()=>({ w:__markerDbg.cropRatioW, h:__markerDbg.cropRatioH,
  sel:document.getElementById('cropRatioSelect').value }))()`);
ok(sw.w === 3 && sw.h === 4, '⇄ 를 누르면 4:3 이 3:4 가 된다', sw);
ok(sw.sel === '3:4', '뒤집힌 값에 맞는 항목이 목록에도 골라진다', sw);
rc = await ev(RECT);
near(rc.비율, 3 / 4, 0.01, '⇄ 직후 잡혀 있던 영역도 새 비율로 바뀐다', rc);

/* ── 9. 「직접 입력…」 ─────────────────────────────────────────────────── */
await pick('custom');
await sleep(200);
const cus = await ev(`(()=>({ custom:getComputedStyle(document.getElementById('cropRatioCustom')).display,
  sel:document.getElementById('cropRatioSelect').value }))()`);
ok(cus.custom !== 'none', '「직접 입력…」을 고르면 숫자 칸이 나타난다', cus);
await ev(`(()=>{const w=document.getElementById('cropRatioW'), h=document.getElementById('cropRatioH');
  w.value='16'; w.dispatchEvent(new Event('input',{bubbles:true}));
  h.value='10'; h.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
await sleep(250);
ok(await ev('__markerDbg.cropRatioW===16 && __markerDbg.cropRatioH===10'), '직접 입력한 16:10 이 걸린다');
rc = await ev(RECT);
near(rc.비율, 1.6, 0.01, '직접 입력한 비율로 영역이 잡힌다', rc);
ok(await ev(`(()=>{const w=document.getElementById('cropRatioW');
  w.value='1a2'; w.dispatchEvent(new Event('input',{bubbles:true})); return w.value==='12';})()`),
   '숫자가 아닌 글자는 칸에서 걸러진다');
ok(await ev(`document.getElementById('cropRatioSelect').value === 'custom'`),
   '값이 프리셋과 같아져도 「직접 입력…」 칸이 닫히지 않는다');

/* ── 10. 실제로 잘려 나온 그림의 비율 ────────────────────────────────── */
// 앞의 검사들이 비율을 여러 번 갈아 끼우며 영역을 조금씩 줄여, 여기까지 오면 상자가 원본 50px
// 남짓밖에 되지 않는다. 그만한 크기에서는 정수 픽셀로 딱 떨어지는 16:9가 아예 존재하지 않아
// (54×30 = 1.800) 반올림 오차가 비율 자체보다 커진다 — 잘려 나온 그림의 비율을 보려는 검사이므로
// 여기서는 넉넉한 크기로 다시 잡는다.
await ev('__markerDbg.cropRect = null; __markerDbg.renderCanvas(); true');
a = await ptAt(0.10, 0.12); b = await ptAt(0.85, 0.80);
await drag(cdp, [a, b]);
await sleep(250);
await pick('16:9');
await sleep(250);
const before = await ev(RECT);
near(before.비율, 16 / 9, 0.01, '16:9 를 고르면 영역이 16:9 가 된다', before);
await ev(`(()=>{document.getElementById('btnCropApply').click(); return true;})()`);
await sleep(1200);
const after = await ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  return { w:d.naturalW, h:d.naturalH, 비율:d.naturalW/d.naturalH, crop:__markerDbg.cropMode };})()`);
near(after.비율, 16 / 9, 0.004, '잘려 나온 그림 자체가 정확히 16:9 다', after);
ok(after.h === Math.round(after.w / (16 / 9)), '원본 픽셀에서도 반올림 오차 없이 비율이 맞는다', after);
ok(after.crop === false, '적용하면 자르기 모드가 풀린다', after);
ok(!/자르기 모드/.test(await ev(`document.getElementById('modeHint').textContent`)),
   '적용 뒤 안내 줄이 자르기 안내에서 돌아온다');

/* ── 11. 자르기 모드에 다시 들어가면 고른 비율이 그대로 살아 있다 ───────── */
await ev('__markerDbg.enterCropMode(); true');
await sleep(300);
rc = await ev(RECT);
ok(!!rc, '다시 들어가면 비율에 맞는 영역이 미리 잡혀 있다');
near(rc.비율, 16 / 9, 0.01, '미리 잡힌 영역이 고른 비율이다', rc);
await shot(cdp, OUT + 'crop-ratio.png');
await ev('__markerDbg.exitCropMode(); true');
await sleep(200);
ok(await ev(`getComputedStyle(document.getElementById('cropActions')).display === 'none'`),
   '취소하면 비율 손잡이도 함께 사라진다');
ok(await ev('__markerDbg.cropRatioValue() > 0'), '취소해도 고른 비율은 지워지지 않는다');

/* ── 12. 다음에 열어도 그대로 ─────────────────────────────────────────── */
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);
const kept = await ev(`(()=>({ w:__markerDbg.cropRatioW, h:__markerDbg.cropRatioH,
  sel:document.getElementById('cropRatioSelect').value }))()`);
ok(kept.w === 16 && kept.h === 9, '다시 열어도 고른 비율이 남아 있다', kept);
ok(kept.sel === '16:9', '목록에도 그 값이 골라진 채로 뜬다', kept);

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
