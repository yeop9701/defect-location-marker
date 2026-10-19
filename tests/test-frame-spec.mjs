/* 세 요소(도면틀·표제란·범례)의 절대 치수 검사 — "내보내면 도면틀·표제란·범례가 넣은 도면
   이미지에 따라 달라진다"의 재발 방지.

   치수의 단위는 mm이고 기준은 "고른 용지"다(index.html의 FRAME_SPEC_DEFAULT 위 설명 참고).
   그래서 여기서 보는 것은 세 가지다.
     1) 도면을 바꿔도 세 요소가 같은 자리·같은 크기인가 (이 기능을 만든 이유)
     2) 용지를 A4↔A3, 가로↔세로로 바꿔도 같은 mm인가 (= 종이에 인쇄했을 때 같은 물리 크기)
     3) 적어 넣은 수치가 저장 결과·미리보기에 그대로 나타나고, 프로젝트 파일에 담기는가
   재는 방법은 "값이 그렇게 되어 있다"가 아니라 그려진 픽셀이다 — 저장용 캔버스를 실제로 만들고,
   바깥에서 안으로 들어오며 처음 만나는 검은 점(= 도곽 테두리)을 찾아 mm로 되재운다.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-frame-spec.mjs                                                         */
import { connect, finish } from './cdp.mjs';
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
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg, { 실제: a, 바람: b, 허용: tol });

await cdp.send('DOM.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1400, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: APP });
await sleep(1500);
await ev('try{localStorage.clear()}catch(e){}; true');
await cdp.send('Page.navigate', { url: APP });
await sleep(1900);

const r = await cdp.send('Runtime.evaluate', { expression: "document.querySelector('#addDrawingInput')" });
await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/plan.png'], objectId: r.result.objectId });
await sleep(1400);
ok(await ev('__markerDbg.drawings.length === 1'), '도면을 한 장 올렸다');

/* 표제란에 실제 글자를 넣어 둔다 — 값이 비어 있으면 '-' 한 글자만 그려져 글자 크기 항목이
   무뎌진다. 도면틀도 켜 둔다(미리보기가 함께 열리므로 바로 닫는다). */
const setField = (id, v) => ev(`(()=>{const i=document.getElementById('${id}');
  i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
await setField('projectNameInput', '2026년 정밀안전점검 용역');
await setField('siteNameInput', 'OO아파트 101동');
await setField('structureTypeInput', '철근콘크리트 벽식구조');
await setField('docTitleInput', '외관조사망도');
await ev(`(()=>{const c=document.getElementById('titleBlockToggle');
  if(!c.checked){ c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true})); } return true;})()`);
await sleep(700);
await ev("document.getElementById('tbPreviewBackdrop').style.display='none'; true");

/* 도면을 결정론적인 그림(1px 격자)으로 갈아 끼운다 — 축소 리샘플링이 일어나면 바로 드러난다 */
const setDrawing = (w, h) => ev(`(async()=>{
  const d = __markerDbg.getActiveDrawing();
  const c = document.createElement('canvas'); c.width=${w}; c.height=${h};
  const g = c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,${w},${h});
  g.fillStyle='#000';
  for(let x=0;x<${w};x+=7) g.fillRect(x,0,1,${h});
  for(let y=0;y<${h};y+=7) g.fillRect(0,y,${w},1);
  const url = c.toDataURL('image/png');
  await new Promise(res=>{ const im=new Image();
    im.onload=()=>{ d.imgEl=im; d.naturalW=${w}; d.naturalH=${h}; res(); }; im.src=url; });
  return true; })()`);
const setPage = (v) => ev(`(()=>{const s=document.getElementById('exportPageSizeSelect');
  s.value='${v}'; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);

/* 저장용 캔버스를 실제로 그려, 세 요소를 mm로 되재운다.
     frame  : 도곽 테두리까지의 네 변 여백 (바깥에서 들어오며 처음 만나는 검은 점)
     tbRows : 표제란 가로선들의 y — 표 상단·구분선·표 하단이 여기에 잡힌다
     legend : 범례 상자, title : 도면 제목 글자, image : 도면이 놓인 자리 */
const measure = () => ev(`(()=>{
  const d = __markerDbg.getActiveDrawing();
  const cv = __markerDbg.buildExportCanvasTitleBlock(d, { superSample:false });
  const W = cv.width, H = cv.height;
  const g = cv.getContext('2d', { willReadFrequently:true });
  const k = __markerDbg.paperWidthMM(__markerDbg.exportPageSizeKey()) / W;  /* 배치 px → mm */
  const dark = (a,i)=> a[i]<110 && a[i+1]<110 && a[i+2]<110;
  const row = g.getImageData(0, Math.round(H*0.62), W, 1).data;   /* 표제란을 피한 높이 */
  const col = g.getImageData(Math.round(W*0.5), 0, 1, H).data;
  let left=-1,right=-1,top=-1,bottom=-1;
  for(let x=0;x<W;x++){ if(dark(row,x*4)){ left=x; break; } }
  for(let x=W-1;x>=0;x--){ if(dark(row,x*4)){ right=x; break; } }
  for(let y=0;y<H;y++){ if(dark(col,y*4)){ top=y; break; } }
  for(let y=H-1;y>=0;y--){ if(dark(col,y*4)){ bottom=y; break; } }
  /* 표제란 가로선 — "내용 폭의 대부분을 가로지르는 가로선"을 위에서부터 찾는다. 세로줄 하나만
     보면 가는 선(구분선 0.13mm)이 안티앨리어싱으로 흐려져 놓치므로, 줄마다 점을 세어 폭의
     75% 이상이 어두우면 선으로 본다. 표의 아래 선(contentY0)까지만 훑으므로, 위에서부터
     [도곽 테두리, 표 상단, 가운데 구분선, 표 하단] 네 줄이 잡힌다. */
  const G = __markerDbg.frameGeometry();
  const x0 = Math.max(0, Math.round(G.cm.left)), cw = Math.round(G.contentW);
  const yEnd = Math.min(H-1, Math.round(G.contentY0 + 3));
  const band = g.getImageData(x0, 0, cw, yEnd+1).data;
  const rows = []; let run = -1;
  for(let y=0;y<=yEnd;y++){
    let cnt = 0;
    for(let i=0;i<cw;i++){ if(band[(y*cw+i)*4] < 200) cnt++; }
    const on = cnt >= cw*0.75;
    if(on && run<0) run = y; else if(!on && run>=0){ rows.push((run + y-1)/2); run = -1; } }
  if(run>=0) rows.push((run + yEnd)/2);
  const n = v => (v===null||v===undefined) ? null : +(v*k).toFixed(2);
  const b = d.__tbLegendBox, a = d.__tbDrawArea, t = d.__tbTitleBox;
  const out = {
    canvas:[W,H], mmPerPx:+k.toFixed(6),
    frame:{ left:n(left), right:n(W-1-right), top:n(top), bottom:n(H-1-bottom) },
    tbRows: rows.slice(0,4).map(n),
    legend: b ? { x:n(b.x), y:n(b.y), w:n(b.w), h:n(b.h) } : null,
    title: t ? { cx:n(t.x+t.w/2), cy:n(t.y+t.h/2), h:n(t.h) } : null,
    image: a ? { x:n(a.x), y:n(a.y), w:n(a.w), h:n(a.h) } : null,
  };
  cv.width=1; cv.height=1;
  return out; })()`);

/* 그려야 __tbLegendAnchor·__tbLegendBox가 채워진다 — 값이 필요 없을 때 쓰는 가벼운 호출 */
const measure0 = () => ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  const cv = __markerDbg.buildExportCanvasFor(d, 'png', document.getElementById('titleBlockToggle').checked);
  cv.width=1; cv.height=1; return true;})()`);

const SPEC = await ev('__markerDbg.FRAME_SPEC_DEFAULT');
const RANGE = await ev('__markerDbg.FRAME_SPEC_RANGE');

/* ══ 1. 기본값은 "예전 도면틀을 mm로 환산한 것"이다 ══════════════════════════
   기준 용지(A4 가로)에서 절대 치수 × 1900/297 이 예전 기준자(FRAME_BASE)의 px와 같아야
   한다 — 같지 않으면 이 변경만으로 도면틀 모습이 달라졌다는 뜻이다. */
console.log('\n══ 1. 기본 절대 치수 = 예전 도면틀의 환산값 ══');
const B = await ev('__markerDbg.FRAME_BASE');
const u0 = await ev("__markerDbg.framePxPerMM('a4l')");
near(SPEC.marginLeft * u0, B.marginLeft, 0.001, `여백 왼쪽 ${SPEC.marginLeft.toFixed(2)}mm = ${B.marginLeft}px`);
near(SPEC.marginTop * u0, B.marginTop, 0.001, `여백 위 ${SPEC.marginTop.toFixed(2)}mm = ${B.marginTop}px`);
near(SPEC.gapBottom * u0, B.gapBottom, 0.001, `간격 아래 ${SPEC.gapBottom.toFixed(2)}mm = ${B.gapBottom}px`);
near(SPEC.lineFrame * u0, 3 * B.lineScale, 0.001, `테두리 굵기 ${SPEC.lineFrame.toFixed(2)}mm = ${3*B.lineScale}px`);
{ // 예전 공식 : clamp(종이높이 × 0.135, 142, 220) × titleBarScale(0.8)
  const refH = Math.round(1900 / (297/210));
  const want = Math.max(142, Math.min(220, refH*0.135)) * B.titleBarScale;
  near(SPEC.titleBarH * u0, want, 0.01,
       `표제란 높이 ${SPEC.titleBarH.toFixed(2)}mm = ${want.toFixed(2)}px(예전 clamp 결과 × ${B.titleBarScale})`);
}
near(SPEC.titleFont * u0, 22, 0.001, `표제란 글자 ${SPEC.titleFont.toFixed(2)}mm = 22px`);
near(SPEC.legendFont * u0, 11.5 * 1.5, 0.001, '범례 글자 = 예전 기본 배율(1.5)의 크기');
ok(Object.keys(SPEC).length === Object.keys(RANGE).length, '치수마다 입력 범위가 하나씩 있다',
   { 치수: Object.keys(SPEC).length, 범위: Object.keys(RANGE).length });

/* ══ 2. 도면을 바꿔도 세 요소가 그대로다 (이 기능을 만든 이유) ══════════════ */
console.log('\n══ 2. 도면 4종 × 용지 5종에서 세 요소가 같은 mm다 ══');
const PAGES = ['original', 'a4l', 'a4p', 'a3l', 'a3p'];
const IMGS = [[2400,1600], [1600,2400], [800,600], [3600,2000]];
const byPage = {};
for (const page of PAGES) {
  await setPage(page);
  const got = [];
  for (const [w, h] of IMGS) { await setDrawing(w, h); got.push(await measure()); }
  byPage[page] = got;
  const spread = (sel) => {
    const v = got.map(sel).filter(x => x !== null);
    return +(Math.max(...v) - Math.min(...v)).toFixed(3);
  };
  const s = { 도곽좌: spread(m => m.frame.left), 도곽위: spread(m => m.frame.top),
              도곽우: spread(m => m.frame.right), 도곽아래: spread(m => m.frame.bottom),
              표제란: spread(m => m.tbRows[3] - m.tbRows[1]), 범례폭: spread(m => m.legend.w),
              범례자리: spread(m => m.legend.x), 제목자리: spread(m => m.title.cy) };
  const worst = Math.max(...Object.values(s));
  // 되재는 자가 1px이라 0.25mm 미만의 차이는 측정 눈금에서 온다(A3는 1px = 0.22mm).
  ok(worst <= 0.25, `${page}: 도면 4종에서 도곽·표제란·범례·제목이 모두 같은 자리다`, s);
}

/* ══ 3. 용지를 바꿔도 같은 물리 크기다 ══════════════════════════════════════
   A4 가로 → A4 세로 → A3 가로 → A3 세로. 예전에는 표제란 높이가 종이 높이에서 파생되고
   142~220px 상한에 걸려 용지마다 비율이 달라졌고, 범례·도면 제목 글자도 함께 흔들렸다. */
console.log('\n══ 3. 용지를 바꿔도 세 요소가 같은 mm다 ══');
const first = (page) => byPage[page][0];
for (const key of [['frame','left','도곽 여백 왼쪽'], ['frame','top','도곽 여백 위'],
                   ['legend','w','범례 상자 폭'], ['legend','h','범례 상자 높이'],
                   ['title','h','도면 제목 글자 높이']]) {
  const vals = PAGES.map(p => key[1] === undefined ? null : first(p)[key[0]][key[1]]);
  const d = +(Math.max(...vals) - Math.min(...vals)).toFixed(3);
  ok(d <= 0.3, `${key[2]}가 용지 5종에서 같다 (편차 ${d}mm)`, Object.fromEntries(PAGES.map((p,i)=>[p, vals[i]])));
}
{
  const vals = PAGES.map(p => +(first(p).tbRows[3] - first(p).tbRows[1]).toFixed(2));
  const d = +(Math.max(...vals) - Math.min(...vals)).toFixed(3);
  ok(d <= 0.3, `표제란 높이가 용지 5종에서 같다 (편차 ${d}mm)`, Object.fromEntries(PAGES.map((p,i)=>[p, vals[i]])));
  near(vals[1], SPEC.titleBarH, 0.3, `잰 표제란 높이가 적어 둔 ${SPEC.titleBarH.toFixed(2)}mm와 같다`);
}
/* 도면은 반대로 — 커진 용지만큼 더 크게 들어가야 한다(세 요소가 고정이므로 남는 자리가 늘어난다) */
ok(first('a3l').image.w > first('a4l').image.w * 1.3,
   'A3로 바꾸면 도면만 더 크게 들어간다(세 요소가 고정이라 남은 자리가 그만큼 늘어난다)',
   { a4l: first('a4l').image.w, a3l: first('a3l').image.w });

/* ══ 4. 적어 넣은 수치가 저장 결과에 그대로 나타난다 ════════════════════════ */
console.log('\n══ 4. 입력한 mm가 저장 결과에 그대로 나온다 ══');
await setPage('a4l');
await setDrawing(2400, 1600);
const setSpec = (o) => ev(`(()=>{ __markerDbg.frameSpec =
  Object.assign({}, __markerDbg.frameSpec, ${JSON.stringify(o)}); return true; })()`);
const base = await measure();
await setSpec({ marginLeft: 30, marginTop: 25, titleBarH: 40 });
const m4 = await measure();
near(m4.frame.left, 30, 0.3, '여백 왼쪽 30mm를 적으면 도곽선이 왼쪽에서 30mm에 온다');
near(m4.frame.top, 25, 0.3, '여백 위 25mm도 그대로다');
near(m4.tbRows[3] - m4.tbRows[1], 40, 0.4, '표제란 높이 40mm도 그대로다');
near(m4.frame.right, base.frame.right, 0.25, '건드리지 않은 오른쪽 여백은 그대로다');
await setSpec({ legendFont: 5 });
const m5 = await measure();
near(m5.legend.h / base.legend.h, 5 / SPEC.legendFont, 0.03,
     '범례 글자 크기를 올리면 상자 높이가 같은 비로 커진다');
/* 도면틀을 바꿔도 도면은 그 안에 맞춰 들어간다 */
ok(m4.image.x >= m4.frame.left && m4.image.x + m4.image.w <= 297 - m4.frame.right + 0.5,
   '여백을 크게 넓혀도 도면은 도곽 안에 맞춰 들어간다', { 도면: m4.image, 도곽: m4.frame });
await ev('__markerDbg.frameSpec = __markerDbg.FRAME_SPEC_DEFAULT; true');

/* ══ 5. 입력칸 — 숫자를 치면 그대로 먹히고, 범위를 벗어나면 다듬어 받는다 ══ */
console.log('\n══ 5. 「절대 치수」 입력칸 ══');
await ev('__markerDbg.syncFrameTuneUI(); true');
ok(await ev("!!document.getElementById('fs-marginLeft') && !!document.getElementById('fs-titleBarH') && !!document.getElementById('fs-legendFont')"),
   '도면틀·표제란·범례의 입력칸이 패널에 있다');
near(await ev("parseFloat(document.getElementById('fs-marginLeft').value)"), SPEC.marginLeft, 0.01,
     '입력칸이 지금 값(mm)을 가리킨다');
const typeIn = (key, v) => ev(`(()=>{const i=document.getElementById('fs-${key}');
  i.value='${v}'; i.dispatchEvent(new Event('input',{bubbles:true}));
  i.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await typeIn('marginLeft', 18.5);
near(await ev('__markerDbg.frameSpec.marginLeft'), 18.5, 0.0001, '칸에 18.5를 치면 값이 18.5mm가 된다');
near((await measure()).frame.left, 18.5, 0.3, '저장 결과의 도곽선도 18.5mm로 옮겨졌다');
await typeIn('marginLeft', 9999);
near(await ev('__markerDbg.frameSpec.marginLeft'), RANGE.marginLeft[1], 0.0001,
     '범위를 넘는 값은 최대값으로 다듬어 받는다');
near(await ev("parseFloat(document.getElementById('fs-marginLeft').value)"), RANGE.marginLeft[1], 0.01,
     '칸을 떠나면 실제로 쓰인 값이 칸에 비친다');
await ev(`(()=>{document.getElementById('btnFrameReset').click(); return true;})()`);
await sleep(200);
eq(await ev('JSON.stringify(__markerDbg.frameSpec) === JSON.stringify(__markerDbg.FRAME_SPEC_DEFAULT)'),
   true, '「기본값으로」가 절대 치수까지 되돌린다');

/* ══ 6. 범례 자리를 mm로 적고, 끌어 옮기면 mm가 따라온다 ═══════════════════ */
console.log('\n══ 6. 범례 자리(mm) ══');
await measure();   // __tbLegendBox 를 채워 둔다
const lp0 = await ev('(()=>{const p=__markerDbg.legendPosMM(__markerDbg.getActiveDrawing()); return p;})()');
ok(lp0.x > 0 && lp0.y > 0, '한 번도 옮기지 않은 범례도 지금 자리를 mm로 알려 준다', lp0);
await ev(`(()=>{ __markerDbg.setLegendPosMM(__markerDbg.getActiveDrawing(), 'x', 20);
  __markerDbg.setLegendPosMM(__markerDbg.getActiveDrawing(), 'y', 15); return true;})()`);
const m6 = await measure();
const area6 = await ev('(()=>{const a=__markerDbg.frameGeometry().legendArea; const u=__markerDbg.frameGeometry().u; return {x:a.x/u, y:a.y/u};})()');
near(m6.legend.x - area6.x, 20, 0.3, '범례 가로 자리 20mm를 적으면 그 자리에 그려진다');
near(m6.legend.y - area6.y, 15, 0.3, '세로 자리 15mm도 그대로다');
const back = await ev("(()=>{const p=__markerDbg.legendPosMM(__markerDbg.getActiveDrawing()); return p;})()");
near(back.x, 20, 0.01, '되읽어도 같은 mm다(입력칸 ↔ 저장값이 1:1로 오간다)');
/* 끌어 옮기기(저장되는 값은 % 쪽)와 mm 읽기가 같은 자리를 가리킨다 */
await ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  d.legendFramePct = { x:50, y:40 }; return true;})()`);
const m6b = await measure();
const lp2 = await ev('__markerDbg.legendPosMM(__markerDbg.getActiveDrawing())');
near(m6b.legend.x - area6.x, lp2.x, 0.3, '끌어 옮긴 자리도 mm 읽기와 일치한다');

/* ══ 6-2. 범례 자리 칸은 "종이가 있을 때만" 열린다 ════════════════════════
   자리의 단위가 mm이므로 기준이 될 종이가 있어야 한다. 도면틀을 켜면 도곽이, 도면틀을 꺼도
   「용지 크기」를 고르면 그 용지가 종이다. 둘 다 아니면(도면틀 끔 + 원본 비율) 캔버스가 곧
   도면 픽셀이라 mm로 말할 기준이 없다 — 예전에는 그때도 칸이 열려 있어서, 적어 넣으면 값만
   조용히 바뀌고 그림은 꿈쩍도 하지 않았다(= 먹지 않는 칸). */
console.log('\n══ 6-2. 범례 자리 칸의 기준(종이) ══');
const legendCell = () => ev(`(()=>{const d=__markerDbg.getActiveDrawing();
  const a = d.__tbLegendAnchor || {}, i = document.getElementById('fs-legendX');
  return { 필드:a.field, pxPerMM:a.pxPerMM ? +a.pxPerMM.toFixed(3) : a.pxPerMM,
    상자mm: (d.__tbLegendBox && a.pxPerMM) ? +((d.__tbLegendBox.x-a.area.x)/a.pxPerMM).toFixed(2) : null,
    잠김: i.disabled, 안내: (i.title||'').slice(0,12) };})()`);
const setTb = (on) => ev(`(()=>{const c=document.getElementById('titleBlockToggle');
  if(c.checked !== ${on}){ c.checked = ${on}; c.dispatchEvent(new Event('change',{bubbles:true})); }
  return true;})()`);
await setTb(false);
await setPage('original');
await sleep(600);
await ev('__markerDbg.getActiveDrawing().legendFramePct = null; true');
await measure0();
await ev('__markerDbg.syncFrameSpecValues(); true');
const c1 = await legendCell();
ok(c1.잠김, '도면틀 끔 + 원본 비율 → 칸이 잠긴다(종이가 없다)', c1);
ok(c1.안내.length > 0, '잠긴 이유가 칸의 설명으로 붙어 있다');
await setPage('a4l');
await sleep(600);
await measure0();
await ev('__markerDbg.syncFrameSpecValues(); true');
const c2 = await legendCell();
ok(!c2.잠김 && c2.pxPerMM > 0, '도면틀을 꺼도 용지를 고르면 칸이 열린다', c2);
await typeIn('legendX', 15);
await measure0();
const c3 = await legendCell();
near(c3.상자mm, 15, 0.4, '그 상태에서 적어 넣은 15mm가 실제로 먹는다(예전에는 먹지 않았다)');
await setTb(true);
await sleep(700);
await measure0();
await ev('__markerDbg.syncFrameSpecValues(); true');
await typeIn('legendX', 22);
await measure0();
const c4 = await legendCell();
near(c4.상자mm, 22, 0.4, '도면틀을 켠 상태에서도 그대로 먹는다');
eq(c4.필드, 'legendFramePct', '그때의 기준은 도곽 안쪽(legendFramePct)이다');
ok(await ev("(()=>{const d=__markerDbg.getActiveDrawing();" +
   "return !!(d.legendPct && typeof d.legendPct.x==='number');})()"),
   '적어 넣은 자리가 도면 기준 좌표(legendPct)에도 따라 적힌다 — 끌어 옮겼을 때와 같다');

/* ══ 7. 미리보기 = 내보내기 ════════════════════════════════════════════════ */
console.log('\n══ 7. 미리보기와 저장 결과가 같다 ══');
const pv = await ev(`(()=>{ const d=__markerDbg.getActiveDrawing();
  const prev = __markerDbg.buildExportCanvasTitleBlock(d, { superSample:false });
  const pb = d.__tbLegendBox, pa = d.__tbDrawArea;
  const prevW = prev.width, prevH = prev.height;
  prev.width=1; prev.height=1;
  const save = __markerDbg.buildExportCanvasFor(d, 'png', true);
  const sb = d.__tbLegendBox, sa = d.__tbDrawArea, ls = save.__layoutScale || 1;
  const o = { prev:[prevW, prevH], save:[save.width, save.height], ls,
    legendPrev: pb && +(pb.x/prevW).toFixed(5), legendSave: sb && +(sb.x/prevW).toFixed(5),
    imgPrev: pa && +(pa.w/prevW).toFixed(5), imgSave: sa && +(sa.w/prevW).toFixed(5) };
  save.width=1; save.height=1; return o; })()`);
near(pv.legendSave, pv.legendPrev, 0.0005, '범례 자리가 미리보기와 저장 결과에서 같다(종이 대비 비율)', pv);
near(pv.imgSave, pv.imgPrev, 0.0005, '도면이 놓인 자리도 같다', pv);
ok(pv.save[0] === 3508 && pv.save[1] === 2480, 'A4 가로 PNG은 300dpi 용지 픽셀로 정확히 떨어진다', pv);

/* ══ 8. 화질 — 도면은 원본 픽셀과 1:1로 찍힌다 ════════════════════════════ */
console.log('\n══ 8. 화질 ══');
// 6번에서 범례를 도면 가운데로 옮겨 두었다 — 재는 줄을 덮지 않게 기본 자리로 돌린다.
await ev('__markerDbg.getActiveDrawing().legendFramePct = null; true');
const sharp = await ev(`(()=>{
  const d = __markerDbg.getActiveDrawing();
  const cv = __markerDbg.buildExportCanvasTitleBlock(d);
  const a = d.__tbDrawArea, k = cv.__layoutScale || 1;
  const px = Math.round(a.x*k), py = Math.round((a.y + a.h/2)*k), pw = Math.round(a.w*k);
  const row = cv.getContext('2d', { willReadFrequently:true }).getImageData(px, py, pw, 1).data;
  let black=0, gray=0;
  for(let i=0;i<pw;i++){ const v=row[i*4]; if(v<60) black++; else if(v<235) gray++; }
  const o = { devScale:+((a.w*k)/d.naturalW).toFixed(4), black, gray,
              lines: Math.ceil(d.naturalW/7), mpx:+((cv.width*cv.height)/1e6).toFixed(1) };
  cv.width=1; cv.height=1; return o; })()`);
near(sharp.devScale, 1, 0.002, '도면이 원본 픽셀과 1:1로 찍힌다(도면틀에 맞추느라 줄이지 않는다)', sharp);
ok(sharp.black === sharp.lines && sharp.gray === 0,
   '1px 격자가 원본 그대로 선명하다(회색으로 뭉갠 선이 없다)', sharp);
ok(sharp.mpx <= 38.1, '종이 픽셀 수가 상한(38M) 안이다', sharp.mpx);

/* ══ 9. 프로젝트 저장·불러오기 ════════════════════════════════════════════ */
console.log('\n══ 9. 프로젝트 파일에 담기고, 예전 파일도 열린다 ══');
await ev(`(()=>{ __markerDbg.frameSpec = Object.assign({}, __markerDbg.frameSpec,
  { marginLeft: 22.2, titleBarH: 33.3, legendFont: 4.4 }); return true;})()`);
const snap = await ev('(()=>{const s=__markerDbg.buildProjectSnapshot(); return {version:s.version, spec:s.frameSpec};})()');
eq(snap.version, 7, '프로젝트 파일 버전이 7이다(절대 치수가 담기는 버전)');
near(snap.spec.marginLeft, 22.2, 0.0001, '적어 둔 절대 치수가 프로젝트 파일에 담긴다');
near(snap.spec.titleBarH, 33.3, 0.0001, '표제란 높이도 담긴다');
near(snap.spec.legendFont, 4.4, 0.0001, '범례 글자 크기도 담긴다');
const meta = await ev('(()=>{const s=__markerDbg.buildProjectMetaSnapshot(); return !!s.frameSpec && s.frameSpec.marginLeft;})()');
near(meta, 22.2, 0.0001, '자동저장(가벼운 메타)에도 함께 담긴다');
/* 되돌아오는가 */
const round = await ev(`(()=>{
  const s = __markerDbg.buildProjectSnapshot();
  __markerDbg.frameSpec = __markerDbg.FRAME_SPEC_DEFAULT;
  __markerDbg.applyProjectData(s);
  return { marginLeft: __markerDbg.frameSpec.marginLeft, titleBarH: __markerDbg.frameSpec.titleBarH };})()`);
near(round.marginLeft, 22.2, 0.0001, '저장했다 다시 열면 같은 값으로 돌아온다');
near(round.titleBarH, 33.3, 0.0001, '표제란 높이도 그대로다');
/* v6 이하 파일 — 절대 치수가 없다. 기본값으로 열려야 한다(그 기본값이 곧 그 시절 모습이다) */
const legacy = await ev(`(()=>{
  const s = __markerDbg.buildProjectSnapshot();
  s.version = 6; delete s.frameSpec;
  __markerDbg.applyProjectData(s);
  return { spec: __markerDbg.frameSpec, def: __markerDbg.FRAME_SPEC_DEFAULT };})()`);
eq(JSON.stringify(legacy.spec), JSON.stringify(legacy.def),
   'v6 이하 파일(절대 치수 없음)은 기본값으로 열린다 = 저장 당시 모습 그대로');
/* 깨진 값·장난 값을 넣어도 범위 안으로 다듬어 받는다 */
const dirty = await ev(`(()=>{
  const s = __markerDbg.buildProjectSnapshot();
  s.frameSpec = { marginLeft: -500, titleBarH: 'abc', legendFont: 1e9, gapTop: null };
  __markerDbg.applyProjectData(s);
  return __markerDbg.frameSpec;})()`);
near(dirty.marginLeft, RANGE.marginLeft[0], 0.0001, '음수 여백은 최소값으로 다듬어 받는다');
near(dirty.legendFont, RANGE.legendFont[1], 0.0001, '터무니없는 값은 최대값으로 다듬어 받는다');
near(dirty.titleBarH, SPEC.titleBarH, 0.0001, '수가 아닌 값은 기본값으로 받는다');
near(dirty.gapTop, SPEC.gapTop, 0.0001, '빠진 값도 기본값으로 받는다');

/* 예전 프로젝트 파일(v2 픽스처)이 그대로 열린다. 이 파일에는 도면틀 설정이 아예 없으므로
   "없는 항목은 지금 설정을 그대로 둔다"는 이 앱의 방침대로, 쓰고 있던 치수가 살아 있어야 한다. */
await ev("__markerDbg.frameSpec = Object.assign({}, __markerDbg.FRAME_SPEC_DEFAULT, { marginLeft: 17.7 }); true");
const r2 = await cdp.send('Runtime.evaluate', { expression: "document.querySelector('#loadProjectInput')" });
await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/legacy-project.json'], objectId: r2.result.objectId });
await sleep(1600);
ok(await ev('__markerDbg.drawings.length >= 2'), 'v2 프로젝트 파일이 오류 없이 열린다(도면 2장)',
   await ev('__markerDbg.drawings.length'));
near(await ev('__markerDbg.frameSpec.marginLeft'), 17.7, 0.0001,
   '도면틀 설정이 없는 예전 파일은 쓰고 있던 치수를 건드리지 않는다');

/* ══ 10. 콘솔 오류가 없어야 한다 ══════════════════════════════════════════ */
console.log('\n══ 10. 콘솔 ══');
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
