/* 프로젝트 파일(.json) 왕복 검사 — "다시 열면 아이콘 크기나 위치가 조금씩 변한다"의 재발 방지.

   마커 배지의 자리(xPct/yPct)는 저장 당시의 「아이콘 크기」(iconSizeMult)를 기준으로 적힌
   수치다. 인출선 길이가 배지 반지름에서 나오므로(r*2.6*…), 다시 열 때 아이콘 크기가 100%로
   돌아가면 배지는 제자리인데 화살표 끝 — 실제 결함 지점 — 이 밀려난다. 예전에는 이 값이
   프로젝트 파일에 담기지 않아 열 때마다 그랬다(150%로 저장한 도면이 100%로 열렸다).

   여기서는 값을 읽어 비교하는 데서 멈추지 않고, 진짜 저장 단추를 눌러 떨어진 파일을 디스크에
   적고, 새로 띄운 화면에서 그 파일을 열어 되돌아온 값을 잰다. 마지막에는 한 번 더 저장해
   두 파일을 통째로 비교한다 — 아이콘 크기 말고 다른 값이 몰래 흘러도 여기서 걸린다.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-project-roundtrip.mjs                                                  */
import { connect, click, finish } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const SAVED = OUT + 'roundtrip-project.json';
const SAVED_V5 = OUT + 'roundtrip-project-v5.json';
// 검사 대상은 '이 검사 파일이 들어 있는 폴더의 index.html' — 어느 폴더에 받아 두었든
// 그대로 돈다. 다른 사본을 시험하려면 APP_URL 환경변수로 덮어쓴다.
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
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1400, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: APP });
await sleep(1500);
await ev('try{localStorage.clear()}catch(e){}; true');
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);

/* ── 도면 한 장 + 마커 두 개(각도가 다른 둘) ───────────────────── */
const pickFile = async (sel, file) => {
  const r = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(sel)})` });
  await cdp.send('DOM.setFileInputFiles', { files: [file], objectId: r.result.objectId });
};
await pickFile('#addDrawingInput', ROOT + 'test-fixtures/plan.png');
await sleep(1400);
const box = await ev(`(()=>{const r=document.getElementById('mainCanvas').getBoundingClientRect();
  return { x:r.left, y:r.top, w:r.width, h:r.height };})()`);
await click(cdp, box.x + box.w * 0.3, box.y + box.h * 0.4); await sleep(250);
await click(cdp, box.x + box.w * 0.6, box.y + box.h * 0.7); await sleep(250);
ok(await ev('__markerDbg.getActiveDrawing().markers.length') === 2, '마커 두 개를 찍었다');
// 두 번째 마커는 인출선 방향·길이도 바꿔 둔다 — 끝점 계산에 angle·lenMult가 함께 걸리게 하려고.
await ev(`(()=>{ const d=__markerDbg.getActiveDrawing();
  d.markers[1].angle = 45; d.markers[1].lenMult = 1.6;
  __markerDbg.renderCanvas(); return true;})()`);
await sleep(300);

/* 재는 자 — 아이콘 반지름(크기)과 배지 자리, 그리고 화살표 끝(실제 결함 지점) */
const probe = () => ev(`(()=>{ const d=__markerDbg.getActiveDrawing(); if(!d) return null;
  return { mult: __markerDbg.iconSizeMult,
           label: (document.getElementById('sizeVal')||{}).textContent,
           r: +__markerDbg.markerRadiusNatural(d).toFixed(4),
           nat: [d.naturalW, d.naturalH],
           badges: d.markers.map(m=>[+m.xPct.toFixed(4), +m.yPct.toFixed(4)]),
           tips: d.markers.map(m=>{ const t=__markerDbg.badgeToTipPct(d, m);
             return [+t.xPct.toFixed(4), +t.yPct.toFixed(4)]; }) };})()`);

/* ── 아이콘 크기를 150%로 올린다 ───────────────────────────────── */
await ev(`(()=>{ const s=document.getElementById('sizeSlider'); s.value='1.5';
  s.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
await sleep(400);
const before = await probe();
ok(before.mult === 1.5 && before.label === '150%', '아이콘 크기를 150%로 올렸다', before);

/* ── 저장 — 진짜 단추를 누르고 떨어진 파일을 디스크에 적는다 ───── */
const hookBlob = () => ev(`(()=>{ window.__saved=null; const o=URL.createObjectURL.bind(URL);
  URL.createObjectURL = b => { window.__saved=b; return o(b); }; return true;})()`);
const savedText = async () => {
  await ev("document.getElementById('btnSaveProject').click(); true");
  await sleep(2500);
  return ev("(async()=>{ return window.__saved ? await window.__saved.text() : null; })()");
};
await hookBlob();
const text1 = await savedText();
ok(!!text1, '프로젝트 파일이 저장됐다');
writeFileSync(SAVED, text1, 'utf8');
const json1 = JSON.parse(text1);
eq(json1.version, 6, '파일 버전이 6이다(아이콘 크기가 담기는 버전)');
eq(json1.iconSizeMult, 1.5, '파일에 아이콘 크기가 담겼다');

/* 자동저장(복구) 쪽 스냅샷에도 같이 담겨야 한다 — 복구해 열어도 같은 모습이어야 하므로 */
eq(await ev('__markerDbg.buildProjectMetaSnapshot().iconSizeMult'), 1.5,
   '자동저장 스냅샷에도 아이콘 크기가 담긴다');

/* ── 새로 띄운 화면에서 그 파일을 열고 전부 비교한다 ───────────── */
await cdp.send('Page.navigate', { url: APP });
await sleep(2000);
await pickFile('#loadProjectInput', SAVED);
await sleep(2500);
const after = await probe();
eq(after.mult, before.mult, '다시 열어도 아이콘 크기가 그대로다');
eq(after.label, before.label, '손잡이 표시값도 함께 돌아온다');
eq(after.r, before.r, '마커 반지름(아이콘 크기)이 저장 당시와 같다');
eq(after.badges, before.badges, '배지 자리가 저장 당시와 같다');
eq(after.tips, before.tips, '화살표 끝(실제 결함 지점)이 저장 당시와 같다');

/* ── 한 번 더 저장해 두 파일을 통째로 비교 ─────────────────────── */
await hookBlob();
const text2 = await savedText();
const diff = [];
(function walk(a, b, path){
  if(JSON.stringify(a) === JSON.stringify(b)) return;
  if(a && b && typeof a === 'object' && typeof b === 'object'){
    for(const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path + '/' + k);
    return;
  }
  diff.push(path + ': ' + JSON.stringify(a) + ' → ' + JSON.stringify(b));
})(json1, JSON.parse(text2), '');
ok(diff.length === 0, '열었다가 그대로 다시 저장하면 파일 내용이 한 글자도 달라지지 않는다', diff.slice(0, 8));

/* ── 아이콘 크기가 없는 예전 파일(v5)도 그대로 열린다 ──────────── */
const v5 = JSON.parse(text1);
delete v5.iconSizeMult;
v5.version = 5;
writeFileSync(SAVED_V5, JSON.stringify(v5), 'utf8');
await cdp.send('Page.navigate', { url: APP });
await sleep(2000);
await ev(`(()=>{ const s=document.getElementById('sizeSlider'); s.value='1.2';
  s.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
await sleep(300);
await pickFile('#loadProjectInput', SAVED_V5);
await sleep(2500);
const old = await probe();
ok(!!old && old.badges.length === 2, '아이콘 크기가 없는 예전 파일도 정상적으로 열린다', old);
eq(old.mult, 1.2, '그런 파일은 지금 쓰고 있는 아이콘 크기를 그대로 둔다(100%로 되돌리지 않는다)');
eq(old.badges, before.badges, '예전 파일의 배지 자리도 적힌 그대로 들어온다');

/* ── 엉뚱한 값이 담긴 파일(외부에서 온 파일)은 범위 안으로 다듬는다 ── */
const rangeCheck = await ev(`(()=>{ const R=__markerDbg.ICON_SIZE_RANGE;
  const probe = v => { __markerDbg.applyIconSizeMult(v); return __markerDbg.iconSizeMult; };
  return { range:R, big:probe(99), small:probe(0.0001), bad:probe('이상한값'), nul:probe(null) };})()`);
eq(rangeCheck.range, [0.6, 2], '아이콘 크기의 범위는 손잡이와 같은 0.6~2배다');
eq(rangeCheck.big, 2, '너무 큰 값은 상한으로 조인다');
eq(rangeCheck.small, 0.6, '너무 작은 값은 하한으로 조인다');
ok(rangeCheck.bad === 1 && rangeCheck.nul === 1, '숫자가 아니면 기본값(100%)으로 둔다', rangeCheck);

/* ── 콘솔 오류 ─────────────────────────────────────────────────── */
const errs = [];
for(const e of cdp.events){
  if(e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errs.push(e.params.entry.text);
  if(e.method === 'Runtime.exceptionThrown') errs.push(String(e.params.exceptionDetails.text));
}
const real = errs.filter(t => !/manifest|net::ERR_FAILED|favicon/i.test(t));
ok(real.length === 0, '실행 중 콘솔 오류가 없다', real.slice(0, 5));

console.log('\n' + '─'.repeat(60));
console.log('  통과 ' + passes + ' · 실패 ' + fails);
finish(cdp, fails ? 1 : 0);
