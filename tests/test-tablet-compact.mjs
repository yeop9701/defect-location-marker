/* 태블릿 조작줄 다이어트 + 「크게 보기」 검사 — "패드에서 상부 목록과 하부 작업표시줄이 너무
   크다. 이미지를 화면에 꽉 차게 볼 수 없나"의 재발 방지.

   1024×768 아이패드에서 머리줄(61px) + 도구줄(139px) = 200px, 화면의 26%가 단추로 차 있었고,
   아래 떠 있는 조작바(60px)는 그 위에 겹쳐 도면 아래를 가렸다. 여기서 보는 것은 셋이다.
     1) 조작줄이 실제로 얇아졌는가 — 다만 펜으로 누를 수 있는 크기(36px)는 지켰는가
     2) 「크게 보기」가 머리줄·도구줄을 접고, 그만큼 도면이 실제로 커지는가
     3) 접은 상태에서 돌아올 길(단추·Esc)이 항상 있고, 도면이 떠 있는 바에 가리지 않는가
   재는 방법은 전부 화면에 그려진 실제 사각형(getBoundingClientRect)이다.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-tablet-compact.mjs                                                      */
import { connect, key, finish } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP = process.env.APP_URL || new URL('../index.html', import.meta.url).href;

const cdp = await connect(9222);
const ev = (s) => cdp.evaluate(s);
let fails = 0, passes = 0;
const ok = (cond, msg, extra) => {
  if (cond) passes++; else fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + msg + (!cond && extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, { 실제: a, 바람: b });

await cdp.send('DOM.enable');
const openAt = async (w, h) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: APP });
  await sleep(1400);
  await ev('try{localStorage.clear()}catch(e){}; true');
  await cdp.send('Page.navigate', { url: APP });
  await sleep(1800);
  const r = await cdp.send('Runtime.evaluate', { expression: "document.querySelector('#addDrawingInput')" });
  await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/plan.png'], objectId: r.result.objectId });
  await sleep(1500);
};

/* 화면에 그려진 치수를 그대로 잰다 */
const probe = () => ev(`(()=>{
  const H = window.innerHeight, W = window.innerWidth;
  const h = sel => { const e = document.querySelector(sel); if(!e) return 0;
    const b = e.getBoundingClientRect(); return Math.round(b.height); };
  const cv = document.getElementById('mainCanvas').getBoundingClientRect();
  const bar = document.querySelector('.tablet-float-bar');
  const barTop = (bar && getComputedStyle(bar).display !== 'none') ? bar.getBoundingClientRect().top : H;
  const exitEl = document.getElementById('btnCanvasMaxExit');
  const ex = exitEl.getBoundingClientRect();
  const exVisible = getComputedStyle(exitEl).display !== 'none';
  const tabEl = document.getElementById('btnDrawerRight');
  const tab = tabEl.getBoundingClientRect();
  const tabVisible = getComputedStyle(tabEl).display !== 'none';
  return { 화면:H, 폭:W,
    머리줄: h('header.topbar'), 도구줄: h('.toolbar2'),
    상부: h('header.topbar') + h('.toolbar2'),
    플로팅바: h('.tablet-float-bar'),
    도면폭: Math.round(cv.width), 도면높이: Math.round(cv.height),
    바에가림: Math.max(0, Math.round(cv.bottom - barTop)),
    되돌리기단추: exVisible,
    단추가손잡이와겹침: !!(exVisible && tabVisible &&
      ex.right > tab.left && ex.left < tab.right && ex.bottom > tab.top && ex.top < tab.bottom),
    크게보기: document.body.classList.contains('canvas-max'),
    태블릿: document.body.classList.contains('layout-tablet') };})()`);

/* 단추 높이 — 너무 줄여 누르기 어려워지지 않았는지 */
const btnH = (sel) => ev(`(()=>{const e=document.querySelector('${sel}');
  return e ? Math.round(e.getBoundingClientRect().height) : 0;})()`);

/* ══ 1. 태블릿 조작줄이 얇아졌다 ══════════════════════════════════════════ */
console.log('\n══ 1. 태블릿 조작줄 (아이패드 1024×768) ══');
await openAt(1024, 768);
const p0 = await probe();
ok(p0.태블릿, '화면 폭 1024에서 태블릿 모드가 켜진다');
ok(p0.머리줄 <= 42, `머리줄이 ${p0.머리줄}px다 (예전 61px)`, p0.머리줄);
ok(p0.상부 <= 125, `머리줄+도구줄이 ${p0.상부}px다 (예전 200px = 화면의 26%)`, p0.상부);
ok(p0.플로팅바 <= 48, `아래 떠 있는 바가 ${p0.플로팅바}px다 (예전 60px)`, p0.플로팅바);
// 설명줄은 "지금의 반으로"가 그대로 요청이었다 — 56px의 절반인 28px 아래여야 한다.
// 56px이었던 까닭은 글(18px)이 아니라 오른쪽 「자세히」 단추가 44px 규칙에 걸려 있던 것이다.
const hintH = await ev(`(()=>{const e=document.querySelector('.mode-hint');
  return getComputedStyle(e).display==='none' ? 0 : Math.round(e.getBoundingClientRect().height);})()`);
ok(hintH > 0 && hintH <= 28, `설명줄이 ${hintH}px다 (예전 56px의 절반 이하)`, hintH);
ok(await ev("Math.round(document.getElementById('btnHintMore').getBoundingClientRect().height) <= 24"),
   '그 안의 「자세히」가 더는 줄 높이를 정하지 않는다');
// 얇아졌어도 펜으로 누를 수 있어야 한다 — 30px 아래로는 내려가지 않는다.
// (자주 누르는 순서대로 크기를 두었다 — 떠 있는 조작바 36 · 도구줄 34 · 머리줄 32)
for (const [sel, name, floor] of [['#btnSaveProject', '프로젝트 저장', 30], ['#btnZoomFit', '화면 맞춤', 32],
                                  ['#btnFloatUndo', '떠 있는 바의 실행취소', 34], ['#btnSettingsMenuToggle', '설정', 30]]) {
  const v = await btnH(sel);
  ok(v >= floor, `「${name}」 단추 높이 ${v}px — 펜으로 누를 수 있는 크기다`, v);
}
// 첫 마커를 찍으면 안내 줄이 접히고, 그만큼 도면이 커진다(예전에는 빈 여백으로 남았다)
const beforeMark = p0.도면높이;
await ev(`(()=>{ const d=__markerDbg.getActiveDrawing();
  d.markers.push({ id:'t1', uid:'t1', seq:1, typeKey:'wall', xPct:50, yPct:50, angle:0, lenMult:1 });
  document.body.classList.add('has-markers'); __markerDbg.renderCanvas(); return true; })()`);
await sleep(600);
const p1 = await probe();
ok(p1.상부 <= 95, `마커를 찍으면 설명줄이 통째로 접혀 상부가 ${p1.상부}px가 된다`, p1.상부);
ok(await ev("getComputedStyle(document.querySelector('.toolbar-row-hint')).display === 'none'"),
   '접힌 설명줄은 줄째로 빠진다(빈 줄이 칸 간격 하나를 차지하지 않는다)');
ok(p1.도면높이 > beforeMark, '접혀서 생긴 자리를 도면이 실제로 가져간다(자동으로 다시 맞춘다)',
   { 전: beforeMark, 후: p1.도면높이 });
ok(p1.바에가림 === 0, '도면이 떠 있는 조작바에 가리지 않는다', p1);

/* ══ 2. 「크게 보기」 ═══════════════════════════════════════════════════════ */
console.log('\n══ 2. 「크게 보기」 ══');
await ev("document.getElementById('btnCanvasMax').click(); true");
await sleep(700);
const p2 = await probe();
ok(p2.크게보기, '도구줄의 「크게 보기」로 켜진다');
eq([p2.머리줄, p2.도구줄], [0, 0], '머리줄과 도구줄이 접힌다');
ok(p2.도면높이 >= p1.도면높이 * 1.08,
   `도면이 ${p1.도면높이}px → ${p2.도면높이}px로 커진다`, { 전: p1.도면높이, 후: p2.도면높이 });
ok(p2.바에가림 === 0, '커진 뒤에도 떠 있는 조작바에 가리지 않는다', p2);
ok(p2.되돌리기단추, '돌아올 단추가 화면에 보인다');
ok(!p2.단추가손잡이와겹침, '그 단추가 오른쪽 서랍 손잡이와 겹치지 않는다');
ok(await ev("getComputedStyle(document.getElementById('btnDrawerLeft')).display !== 'none'"),
   '접은 뒤에도 서랍 손잡이로 도면 목록을 열 수 있다');
ok(await ev("getComputedStyle(document.querySelector('.tablet-float-bar')).display !== 'none'"),
   '접은 뒤에도 떠 있는 조작바는 그대로 있다(조작을 잃지 않는다)');

/* 되돌아가기 — 단추 / Esc / Shift+F */
await ev("document.getElementById('btnCanvasMaxExit').click(); true");
await sleep(600);
ok(!(await probe()).크게보기, '되돌리기 단추로 꺼진다');
await ev("document.getElementById('mainCanvas').focus(); true");
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyF', key: 'F', windowsVirtualKeyCode: 70, modifiers: 8 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyF', key: 'F', windowsVirtualKeyCode: 70, modifiers: 8 });
await sleep(600);
ok((await probe()).크게보기, 'Shift+F로 켜진다');
await key(cdp, { code: 'Escape', keyStr: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(600);
ok(!(await probe()).크게보기, 'Esc로 꺼진다');
// 맨 F(화면 맞춤)는 예전 그대로여야 한다 — Shift 조합에 먹히지 않았는지 본다
await key(cdp, { code: 'KeyF', keyStr: 'f', windowsVirtualKeyCode: 70 });
await sleep(500);
ok(!(await probe()).크게보기, '맨 F는 「화면 맞춤」 그대로다(크게 보기가 켜지지 않는다)');

/* 떠 있는 바의 같은 단추로도 켜지고, 그 상태가 다음 방문에 남는다 */
await ev("document.getElementById('btnFloatCanvasMax').click(); true");
await sleep(700);
ok((await probe()).크게보기, '떠 있는 조작바의 단추로도 켜진다');
await cdp.send('Page.navigate', { url: APP });
await sleep(1900);
ok(await ev("document.body.classList.contains('canvas-max')"), '켜 둔 상태가 다음 방문에도 남는다');
ok(await ev("getComputedStyle(document.getElementById('btnCanvasMaxExit')).display !== 'none'"),
   '도면이 없는 첫 화면에서도 돌아올 단추는 보인다(갇히지 않는다)');
await ev("__markerDbg.setCanvasMax(false); true");
await sleep(400);

/* ══ 2-2. 접은 채로 서랍을 열면 — 되돌리기 단추가 서랍을 덮지 않는다 ══════
   이 단추는 서랍보다 위층(z 59 > 55)이라, 숨기지 않으면 열어 둔 결함 목록 위에 그대로 떠
   있었다. 떠 있는 조작바가 같은 이유로 이미 숨는다 — 같은 규칙을 따른다. */
console.log('\n══ 2-2. 접은 채로 서랍 열기 ══');
// 바로 위에서 "다음 방문에도 남는가"를 보려고 화면을 새로 띄웠다 — 그 화면에는 도면이 없다.
// 떠 있는 것들은 도면이 없으면 잠기거나 숨으므로, 여기서 한 장 다시 올리고 이어 간다.
await openAt(1024, 768);
await ev("__markerDbg.setCanvasMax(true); true");
await sleep(600);
await ev("document.getElementById('btnDrawerRight').click(); true");
await sleep(700);
const dr = await ev(`(()=>{
  const ex = document.getElementById('btnCanvasMaxExit');
  const sb = document.querySelector('.sidebar.right');
  const e = ex.getBoundingClientRect(), s = sb.getBoundingClientRect();
  return { 보임: getComputedStyle(ex).display !== 'none',
    겹침: e.right > s.left && e.left < s.right && e.bottom > s.top && e.top < s.bottom };})()`);
ok(!dr.보임 && !dr.겹침, '서랍이 열려 있는 동안에는 되돌리기 단추가 서랍을 덮지 않는다', dr);
await ev("document.getElementById('btnDrawerRight').click(); true");
await sleep(700);
ok(await ev("getComputedStyle(document.getElementById('btnCanvasMaxExit')).display !== 'none'"),
   '서랍을 닫으면 단추가 다시 보인다');
await ev("__markerDbg.setCanvasMax(false); true");
await sleep(500);

/* ══ 2-3. 떠 있는 것들이 조작바 바로 위에 붙는가 ══════════════════════════
   바를 60px에서 50px로 줄였는데 떠 있는 줄(78px)과 퀵입력 시트(74px)는 옛 숫자가 남아
   20px·16px씩 떠 있었다. 셋이 같은 값(--float-bar-reserve)을 보게 묶었다. */
console.log('\n══ 2-3. 떠 있는 것들의 아래 자리 ══');
const gaps = await ev(`(()=>{
  const H = window.innerHeight;
  const bar = document.querySelector('.tablet-float-bar').getBoundingClientRect();
  const layer = document.querySelector('.canvas-float-layer').getBoundingClientRect();
  const sh = document.getElementById('quickInputSheet');
  sh.style.display = 'flex';
  const sheet = sh.getBoundingClientRect();
  sh.style.display = 'none';
  return { 떠있는줄틈: Math.round(bar.top - layer.bottom),
           퀵입력틈: Math.round(bar.top - sheet.bottom) };})()`);
ok(gaps.떠있는줄틈 >= 0 && gaps.떠있는줄틈 <= 10,
   '모드별 조작 묶음이 조작바 바로 위에 붙는다', gaps);
ok(gaps.퀵입력틈 >= 0 && gaps.퀵입력틈 <= 10,
   '퀵입력 시트도 조작바 바로 위에 붙는다', gaps);

/* ══ 2-4. 패드를 돌리면 배율이 따라 맞는가 ════════════════════════════════
   가로→세로로 돌리면 도면 칸이 통째로 좁아진다. 예전에는 배율이 그대로라 도면이 칸 밖으로
   잘린 채 남았고(「화면 맞춤」을 손으로 다시 눌러야 했다), "지금 배율이 맞춤보다 큰가"로
   짐작하던 판정은 바로 이 경우를 "사용자가 확대해 둔 것"으로 잘못 읽었다. */
console.log('\n══ 2-4. 화면 회전 ══');
const zoomNow = () => ev("(()=>{const c=document.getElementById('mainCanvas');" +
  "const d=__markerDbg.getActiveDrawing(); return +(parseFloat(c.style.width)/d.baseW).toFixed(4);})()");
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
await sleep(900);
const rot = { 배율: await zoomNow(), 맞춤: await ev('+__markerDbg.computeFitZoom().toFixed(4)') };
ok(Math.abs(rot.배율 - rot.맞춤) < 0.01, '가로 → 세로로 돌리면 배율이 따라 맞는다', rot);
ok(await ev('__markerDbg.zoomIsFit'), '그 뒤에도 "맞춤으로 보는 중"이 유지된다');
// 직접 당겨 둔 배율은 돌려도 그대로다
await ev(`(()=>{const s=document.getElementById('zoomSelect');
  s.value='2'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(500);
ok(!(await ev('__markerDbg.zoomIsFit')), '배율을 직접 고르면 "맞춤으로 보는 중"이 풀린다');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
await sleep(900);
ok(Math.abs((await zoomNow()) - 2) < 0.01,
   '직접 당겨 둔 200%는 화면을 돌려도 그대로다(마킹하던 자리를 잃지 않는다)', await zoomNow());

/* ══ 3. 확대해 둔 배율은 건드리지 않는다 ══════════════════════════════════ */
console.log('\n══ 3. 직접 확대해 둔 배율 ══');
await openAt(1024, 768);
await ev(`(()=>{const s=document.getElementById('zoomSelect');
  s.value='2'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(500);
const zoomed = await ev("document.getElementById('mainCanvas').getBoundingClientRect().width");
await ev("__markerDbg.setCanvasMax(true); true");
await sleep(700);
const zoomed2 = await ev("document.getElementById('mainCanvas').getBoundingClientRect().width");
ok(Math.abs(zoomed2 - zoomed) < 2,
   '200%로 당겨 둔 배율은 「크게 보기」를 눌러도 그대로다(마킹하던 자리를 잃지 않는다)',
   { 전: Math.round(zoomed), 후: Math.round(zoomed2) });
await ev("__markerDbg.setCanvasMax(false); true");
await sleep(400);

/* ══ 4. 데스크톱에서도 동작한다 ═══════════════════════════════════════════ */
console.log('\n══ 4. 데스크톱(태블릿 모드 꺼짐) ══');
// 세로가 좁은 창을 고른다 — 도면이 "세로에 걸려" 작아지는 상황이라야 머리줄·도구줄을
// 접어 생긴 세로 자리가 도면 크기로 실제로 드러난다(넓은 창에서는 가로가 먼저 걸린다).
await openAt(1600, 640);
const d0 = await probe();
ok(!d0.태블릿, '화면 폭 1600에서는 태블릿 모드가 꺼져 있다');
ok(d0.플로팅바 === 0, '떠 있는 조작바는 데스크톱에 없다');
await ev("document.getElementById('btnCanvasMax').click(); true");
await sleep(700);
const d1 = await probe();
eq([d1.머리줄, d1.도구줄], [0, 0], '데스크톱에서도 머리줄·도구줄이 접힌다');
ok(d1.도면높이 > d0.도면높이, '도면이 커진다', { 전: d0.도면높이, 후: d1.도면높이 });
ok(d1.되돌리기단추, '떠 있는 바가 없는 데스크톱에서는 되돌리기 단추가 유일한 길이다 — 보인다');
await ev("document.getElementById('btnCanvasMaxExit').click(); true");
await sleep(600);
eq((await probe()).머리줄 > 0, true, '되돌리면 머리줄이 다시 보인다');

/* ══ 4-2. 아이패드가 아닌 태블릿(갤럭시탭 등)에서도 같은 배치인가 ═══════════
   조작줄 다이어트는 전부 body.layout-tablet 에 걸려 있고, 그 모드는 화면 폭이 아니라
   "굵은 포인터"(pointer: coarse)로도 켜진다 — 그래서 가로로 들어 1280px이 되는 갤럭시탭에서도
   똑같이 켜진다. 폭으로만 판정하는 규칙을 누가 다시 넣으면 이 항목이 깨진다.
   (삼성 덱스처럼 마우스를 붙이면 pointer가 fine이 되어 자동 판정은 데스크톱으로 간다 —
   그때는 머리줄의 「태블릿 모드」를 「켬」으로 고정하면 같은 배치가 된다.) */
console.log('\n══ 4-2. 폭이 넓은 터치 태블릿(갤럭시탭) ══');
const openTouch = async (w, h, touch) => {
  await cdp.send('Emulation.setTouchEmulationEnabled', touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  await cdp.send('Page.navigate', { url: APP });
  await sleep(1300);
  await ev('try{localStorage.clear()}catch(e){}; true');
  await cdp.send('Page.navigate', { url: APP });
  await sleep(1700);
};
const rowSet = () => ev(`(()=>{
  const h = sel => { const e = document.querySelector(sel); if(!e) return 0;
    const cs = getComputedStyle(e); if(cs.display === 'none') return 0;
    return Math.round(e.getBoundingClientRect().height); };
  return { 태블릿: document.body.classList.contains('layout-tablet'),
    coarse: window.matchMedia('(pointer: coarse)').matches, 폭: window.innerWidth,
    줄: [h('header.topbar'), h('.toolbar2'), h('.toolbar-row-main'), h('.mode-hint'), h('.tablet-float-bar')] };})()`);

await openTouch(1024, 768, true);
const base = await rowSet();
ok(base.태블릿, '기준 — 1024×768 터치에서 태블릿 모드다', base);
for (const [w, h, name] of [[1280, 800, '갤럭시탭 S9 가로'], [800, 1280, '갤럭시탭 S9 세로'],
                            [1480, 924, '갤럭시탭 S9 Ultra 가로']]) {
  await openTouch(w, h, true);
  const m = await rowSet();
  ok(m.태블릿, `${name}(${w}px) — 폭이 1100px을 넘어도 터치 기기면 태블릿 모드다`, m);
  eq(m.줄, base.줄, `  → 줄 높이가 아이패드와 한 픽셀도 다르지 않다 [${base.줄.join('·')}]`);
}
/* 마우스를 붙이면(덱스) 자동은 데스크톱으로 가고, 「켬」으로 고정하면 되돌아온다 */
await openTouch(1280, 800, false);
const dex = await rowSet();
ok(!dex.태블릿 && !dex.coarse, '마우스를 붙이면(덱스) 자동 판정은 데스크톱 배치다', dex);
for (let i = 0; i < 3; i++) {
  await ev("document.getElementById('btnTabletModeToggle').click(); true");
  await sleep(500);
  if (await ev("document.body.classList.contains('layout-tablet')")) break;
}
const fixed = await rowSet();
ok(fixed.태블릿, '「태블릿 모드: 켬」으로 고정할 수 있다', fixed);
eq(fixed.줄, base.줄, '  → 고정하면 터치 때와 똑같은 배치가 된다');
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });

/* ══ 5. 콘솔 오류 ════════════════════════════════════════════════════════ */
console.log('\n══ 5. 콘솔 ══');
const errors = cdp.events
  .filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  .map(e => e.params.entry.text)
  .concat(cdp.events.filter(e => e.method === 'Runtime.exceptionThrown')
    .map(e => String(e.params.exceptionDetails.text)))
  .filter(t => !/manifest|net::ERR_FAILED|favicon/i.test(t));
ok(errors.length === 0, '실행 중 콘솔 오류가 없다', errors.slice(0, 5));

console.log('\n' + '─'.repeat(60));
console.log('  통과 ' + passes + ' · 실패 ' + fails);
finish(cdp, fails ? 1 : 0);
