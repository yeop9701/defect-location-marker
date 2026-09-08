/* 결함 목록(오른쪽 카드 표)과 「표로 입력」 창의 「엑셀식 칸 조작」 검사.
   방향키·F2 편집 모드·Ctrl+D·▼ 목록이 다른 현장조사 앱들과 똑같이 움직이는지,
   그리고 목록 칸을 ▼ 로 바꾼 뒤에도 카드의 열 정렬이 그대로인지 실제 브라우저에서 확인한다.

   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
   node tests/test-input.mjs                                                              */
import { connect, click, shot, finish } from './cdp.mjs';
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
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, { 실제: a, 바람: b });

await cdp.send('DOM.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: APP });
await sleep(1500);
await ev('try{localStorage.clear()}catch(e){}; true');
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);

/* ── 도면 한 장을 올리고 마커 네 개를 찍는다 ─────────────── */
const pickFile = async (sel, file) => {
  const r = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(sel)})` });
  await cdp.send('DOM.setFileInputFiles', { files: [ROOT + file], objectId: r.result.objectId });
};
await pickFile('#addDrawingInput', 'test-fixtures/plan.png');
await sleep(1200);
const box = await ev(`(()=>{const r=document.getElementById('mainCanvas').getBoundingClientRect();
  return {x:r.left,y:r.top,w:r.width,h:r.height};})()`);
for (let i = 0; i < 4; i++) { await click(cdp, box.x + 90 + i * 110, box.y + 70 + i * 70); await sleep(150); }
await sleep(400);
ok(await ev('document.querySelectorAll(".marker-card").length') === 4, '마커 네 개를 찍었다',
   await ev('document.querySelectorAll(".marker-card").length'));

/* ── 도우미 ──────────────────────────────────────────────── */
const rawKey = (o) => cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...o })
  .then(() => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...o }));
const KEY = {
  right: { code: 'ArrowRight', key: 'ArrowRight', windowsVirtualKeyCode: 39 },
  left:  { code: 'ArrowLeft',  key: 'ArrowLeft',  windowsVirtualKeyCode: 37 },
  down:  { code: 'ArrowDown',  key: 'ArrowDown',  windowsVirtualKeyCode: 40 },
  up:    { code: 'ArrowUp',    key: 'ArrowUp',    windowsVirtualKeyCode: 38 },
  f2:    { code: 'F2',         key: 'F2',         windowsVirtualKeyCode: 113 },
  esc:   { code: 'Escape',     key: 'Escape',     windowsVirtualKeyCode: 27 },
  enter: { code: 'Enter',      key: 'Enter',      windowsVirtualKeyCode: 13 },
};
const ctrlD = () => rawKey({ modifiers: 2, key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
const nowAt = () => ev(`(()=>{const a=document.activeElement;
  if(!a || !a.getAttribute) return String(a && a.tagName);
  const role = a.getAttribute('data-role') || a.getAttribute('data-col');
  if(!role) return String(a.tagName);
  const card = a.closest('.marker-card'), tr = a.closest('tr');
  const row = card ? [...document.querySelectorAll('.marker-card')].indexOf(card)
                   : (tr ? [...tr.parentElement.children].indexOf(tr) : -1);
  return row + '|' + role + '|' + (a.classList.contains('editing') ? 'E' : '-');})()`);
const cardCell = (i, role) => ev(`(()=>{const c=document.querySelectorAll('.marker-card')[${i}];
  const i2=c.querySelector('[data-role="${role}"]'); i2.focus(); i2.select(); return true;})()`);
const setCardCell = (i, role, v) => ev(`(()=>{const c=document.querySelectorAll('.marker-card')[${i}];
  const i2=c.querySelector('[data-role="${role}"]'); i2.focus(); i2.value=${JSON.stringify(v)};
  i2.dispatchEvent(new Event('input',{bubbles:true}));
  i2.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
const cardVal = (i, role) => ev(`document.querySelectorAll('.marker-card')[${i}].querySelector('[data-role="${role}"]').value`);
const cardDrop = (i, role) => ev(`(()=>{document.querySelectorAll('.marker-card')[${i}]
  .querySelector('button[data-drop="${role}"]').click(); return true;})()`);
const menuOpen = () => ev('!!document.querySelector(".cell-menu")');
const menuItems = () => ev('[...document.querySelectorAll(".cell-menu button")].map(b=>b.textContent)');

/* ══ 1. 칸의 생김새 ══════════════════════════════════════════ */
console.log('\n══ 1. 입력칸의 생김새 ══');
ok(await ev('document.querySelectorAll("datalist").length') === 0,
   'datalist 를 하나도 쓰지 않는다 (칸을 누르기만 해도 열려 칸 이동을 방해한다)');
eq(await ev('document.querySelectorAll(".marker-card")[0].querySelectorAll(".cwrap").length'), 3,
   '카드의 부재·자재·결함이 목록 칸(▼)이다');
ok(await ev(`[...document.querySelectorAll('.marker-card select')].every(s=>s.tabIndex===-1)`),
   '남아 있는 select(마킹 유형)는 tabindex="-1" 이라 키보드 흐름 밖에 있다');

/* 카드가 subgrid 라 열이 어긋나면 표 전체가 틀어진다 — 목록 칸을 넣은 뒤에도 그대로인지 본다 */
const align = await ev(`(()=>{
  const head=[...document.querySelector('.marker-list-head').children];
  const rows=[...document.querySelectorAll('.marker-card')].map(c=>[...c.children]);
  const L=e=>Math.round(e.getBoundingClientRect().left);
  return { headCount: head.length, rowCounts: rows.map(r=>r.length),
    drift: head.map((h,i)=>{ const xs=[L(h), ...rows.map(r=>r[i]?L(r[i]):L(h))];
      return Math.max(...xs)-Math.min(...xs); }) };})()`);
ok(align.rowCounts.every((c) => c === align.headCount), '카드의 칸 수가 머리글과 같다', align);
ok(align.drift.every((d) => d <= 1), '머리글과 모든 줄의 열 시작 자리가 1px 안으로 맞는다', align.drift);

/* ══ 2. 결함 목록 — 방향키는 늘 한 번에 ═════════════════════ */
console.log('\n══ 2. 결함 목록의 칸 사이 이동 ══');
await setCardCell(0, 'rptType', '벽체');
await setCardCell(0, 'rptMember', '콘크리트');
await cardCell(0, 'rptType');
await ev('document.activeElement.setSelectionRange(1,1); true');     // 글 가운데에 커서를 두고
await rawKey(KEY.right);
eq(await nowAt(), '0|rptMember|-', '글 가운데서도 → 는 한 번에 오른쪽 칸');
await ev('document.activeElement.setSelectionRange(document.activeElement.value.length,document.activeElement.value.length); true');
await rawKey(KEY.left);
eq(await nowAt(), '0|rptType|-', '글 끝에서도 ← 는 한 번에 왼쪽 칸');
await rawKey(KEY.down); eq(await nowAt(), '1|rptType|-', '↓ 는 아래 결함의 같은 칸');
await rawKey(KEY.up);   eq(await nowAt(), '0|rptType|-', '↑ 는 위 결함의 같은 칸');

/* ══ 3. F2 편집 모드 ════════════════════════════════════════ */
console.log('\n══ 3. 편집 모드 (F2 · 칸을 두 번 누르기) ══');
await cardCell(0, 'rptType');
await rawKey(KEY.f2);
eq(await nowAt(), '0|rptType|E', 'F2 로 편집 모드에 들어간다');
ok(await ev('document.activeElement.selectionStart === document.activeElement.value.length'),
   'F2 는 커서를 글 끝에 둔다 (지우지 않고 이어 고친다)');
await rawKey(KEY.left);
eq(await nowAt(), '0|rptType|E', '편집 모드에서는 ← 가 칸을 옮기지 않는다');
ok(await ev('document.activeElement.selectionStart < document.activeElement.value.length'),
   '편집 모드에서 ← 는 글자 사이를 옮긴다');
await rawKey(KEY.esc);
eq(await nowAt(), '0|rptType|-', 'Esc 로 편집 모드가 풀린다');
await rawKey(KEY.right);
eq(await nowAt(), '0|rptMember|-', '풀린 뒤에는 → 가 다시 칸 이동');
await ev(`(()=>{const c=document.querySelectorAll('.marker-card')[0];
  const i=c.querySelector('[data-role="rptType"]'); i.focus();
  i.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return true;})()`);
eq(await nowAt(), '0|rptType|E', '칸을 두 번 눌러도 편집 모드');
await cardCell(1, 'rptType');
eq(await ev('document.querySelectorAll("#markerTable input.editing").length'), 0,
   '다른 칸으로 옮기면 편집 모드가 저절로 풀린다');

/* ══ 4. ▼ 목록 ═════════════════════════════════════════════ */
console.log('\n══ 4. 목록은 ▼ 를 눌렀을 때에만 ══');
await cardCell(1, 'rptType');
ok(!(await menuOpen()), '칸에 들어서기만 해서는 목록이 열리지 않는다');
await cardDrop(1, 'rptType');
ok(await menuOpen(), '▼ 를 누르면 목록이 열린다');
eq((await menuItems())[0], '(비움)', '목록 맨 위는 「(비움)」');
ok((await menuItems()).includes('벽체'), '이미 표에 적힌 값도 목록에 들어 있다', await menuItems());
await cardDrop(1, 'rptType');
ok(!(await menuOpen()), '▼ 를 한 번 더 누르면 닫힌다');
await cardDrop(1, 'rptType');
await ev(`[...document.querySelectorAll('.cell-menu button')].find(b=>b.textContent==='벽체').click()`);
eq(await cardVal(1, 'rptType'), '벽체', '목록에서 고른 값이 칸에 들어간다');
ok(!(await menuOpen()), '고르고 나면 목록이 닫힌다');
await setCardCell(2, 'rptDefect', '망상균열');
await cardDrop(0, 'rptDefect');
ok((await menuItems()).includes('망상균열'), '새로 친 값이 곧바로 목록에 오른다', await menuItems());
await ev(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
ok(!(await menuOpen()), '바깥을 누르면 목록이 닫힌다');

/* ══ 5. Ctrl+D ═════════════════════════════════════════════ */
console.log('\n══ 5. Ctrl+D (바로 위 결함의 값 가져오기) ══');
await setCardCell(0, 'rptMember', '조적');
await cardCell(1, 'rptMember');
await ctrlD();
eq(await cardVal(1, 'rptMember'), '조적', 'Ctrl+D 로 바로 위 결함의 값이 내려온다');
eq(await nowAt(), '1|rptMember|-', 'Ctrl+D 뒤에도 그 칸에 그대로 서 있다');

/* ══ 6. 「표로 입력」 창 ════════════════════════════════════ */
console.log('\n══ 6. 「표로 입력」 창 ══');
await ev(`document.getElementById('btnTableInput').click()`);
await sleep(500);
ok(await ev(`document.getElementById('tableInputBackdrop').style.display !== 'none'`), '「표로 입력」 창이 열린다');
ok(await ev('document.querySelectorAll("#inputTableBody select").length') === 0,
   '표에 select 가 없다 (↑↓ 가 값 고르기로 새 버린다)');
eq(await ev('document.querySelectorAll("#inputTableBody tr:first-child .cwrap").length'), 4,
   '유형·부재·자재·결함이 목록 칸(▼)이다');
const tiCell = (r, col) => ev(`(()=>{const t=document.getElementById('inputTableBody').children[${r}];
  const i=t.querySelector('[data-col="${col}"]'); i.focus(); i.select(); return true;})()`);
const tiVal = (r, col) => ev(`document.getElementById('inputTableBody').children[${r}].querySelector('[data-col="${col}"]').value`);
await ev(`document.getElementById('btnAddInputRow').click(); document.getElementById('btnAddInputRow').click(); true`);
await tiCell(0, 'x');
await ev('document.activeElement.setSelectionRange(0,0); true');
await rawKey(KEY.right);
eq(await nowAt(), '0|y|-', '글 앞에서도 → 는 한 번에 오른쪽 칸');
await rawKey(KEY.down);
eq(await nowAt(), '1|y|-', '↓ 는 아래 줄의 같은 칸');
await rawKey(KEY.f2);
eq(await nowAt(), '1|y|E', 'F2 로 편집 모드');
await rawKey(KEY.esc);
eq(await nowAt(), '1|y|-', 'Esc 로 편집 모드가 풀린다');
await ev(`(()=>{const t=document.getElementById('inputTableBody').children[0];
  const i=t.querySelector('[data-col="rptType"]'); i.focus(); i.value='기둥';
  i.dispatchEvent(new Event('input',{bubbles:true}));
  i.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
eq(await tiVal(0, 'rptType'), '기둥', '윗줄에 값을 넣었다');
await tiCell(1, 'rptType');
await ctrlD();
eq(await tiVal(1, 'rptType'), '기둥', 'Ctrl+D 로 바로 위 줄의 값이 내려온다');
/* 유형 칸은 이제 「이름」을 담는다 — 붙여넣기도 이름 그대로 */
const PASTE = ['벽체(선)\t10\t20\t0\t1\t벽체\t콘크리트\t균열\t비고1',
               '벽체(선)\t30\t40\t0\t1\t기둥\t조적\t박리\t비고2'].join('\n');
await ev(`(() => {
  const el = document.getElementById('inputTableBody').children[0].querySelector('[data-col="type"]');
  el.focus();
  const dt = new DataTransfer(); dt.setData('text', ` + JSON.stringify(PASTE) + `);
  el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
  return true;})()`);
await sleep(200);
eq([await tiVal(0, 'rptType'), await tiVal(0, 'rptDefect'), await tiVal(1, 'rptMember')],
   ['벽체', '균열', '조적'], '붙여넣은 값이 열 차례대로 들어간다');
await ev(`document.getElementById('inputTableBody').children[0].querySelector('button[data-drop="type"]').click(); true`);
ok((await menuItems()).length > 1, '유형 칸의 ▼ 목록에 마킹 유형 이름이 들어 있다', await menuItems());
await ev(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);

/* 표의 값이 실제 마커로 옮겨지는지 — 유형 이름이 키로 잘 되돌아가는지 */
const before = await ev('document.querySelectorAll(".marker-card").length');
await ev(`document.getElementById('btnTableInputApply').click(); true`);
await sleep(600);
ok(await ev('document.querySelectorAll(".marker-card").length') > before,
   '「현재 도면에 추가」로 표의 줄이 마커가 된다');
eq(await ev(`(()=>{const cs=[...document.querySelectorAll('.marker-card')];
  const c=cs[cs.length-1]; return [c.querySelector('[data-role="rptType"]').value,
    c.querySelector('[data-role="rptDefect"]').value];})()`),
   ['기둥', '박리'], '표에 적은 부재·결함이 마커에 그대로 들어간다');


/* Ctrl+D 는 원래 「현재 도면 저장(PNG)」 단축키다. 입력칸에서는 「위 칸 값 가져오기」라야 한다 —
   화면의 사용법 상자에도 그 규칙이 적혀 있어야 한다(태블릿에서는 보이지 않는 규칙은 없는 것과 같다). */
ok((await ev('document.getElementById("helpBox").textContent')).includes('바로 위 칸의 값 가져오기'),
   '사용법 상자에 칸 조작 규칙이 적혀 있다');

/* ══ 7. 갈무리 · 콘솔 오류 ═════════════════════════════════ */
console.log('\n══ 7. 화면 갈무리 · 콘솔 오류 ══');
await cardDrop(0, 'rptDefect');
await sleep(200);
await shot(cdp, OUT + 'marker-list.png');
await ev(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
await cdp.send('Emulation.clearDeviceMetricsOverride');

/* file:// 로 열면 브라우저가 <link rel=manifest> 와 서비스워커를 CORS 로 막는다 —
   웹 서버에 올려 두면 나지 않는 것이라 앱의 오류로 세지 않는다. */
const noise = (t) => /manifest|service ?worker|ServiceWorker|net::ERR_FAILED|Failed to load resource/i.test(t);
const errs = [];
for (const e of cdp.events) {
  if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !noise(e.params.entry.text)) errs.push(e.params.entry.text);
  if (e.method === 'Runtime.exceptionThrown') errs.push(String(e.params.exceptionDetails.text));
}
ok(errs.length === 0, '실행 중 콘솔 오류가 없다', errs.slice(0, 5));

console.log('\n' + '─'.repeat(60));
console.log(`  통과 ${passes} · 실패 ${fails}`);
console.log('  결과물 : ' + OUT);
finish(cdp, fails ? 1 : 0);
