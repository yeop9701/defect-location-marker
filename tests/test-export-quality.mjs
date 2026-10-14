/* 저장 해상도(화질) 검사 — "도면틀을 넣으면 화질이 떨어진다"의 재발 방지.

   도면틀을 켜면 도면이 도곽 안쪽에 맞춰 줄어드는데, 예전에는 종이(캔버스)의 픽셀 수가 도면
   폭에 맞춰져 있어서 줄어든 배율만큼 도면의 픽셀이 실제로 버려졌다(가로 도면 0.86배, 세로
   도면 0.36배). 지금은 줄어드는 만큼 종이의 픽셀 수를 늘려(ctx.scale) 도면이 원본과 1:1로
   찍힌다. 여기서 보는 것은 "값이 그렇게 되어 있다"가 아니라 실제로 찍힌 픽셀이다 —
   원본에 1px 격자를 그려 넣고, 저장 결과에서 그 선이 회색으로 뭉갰는지 센다.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-export-quality.mjs                                                     */
import { connect, finish } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
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
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg, { 실제: a, 바람: b, 허용: tol });

await cdp.send('DOM.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1400, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: APP });
await sleep(1500);
await ev('try{localStorage.clear()}catch(e){}; true');
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);

const r = await cdp.send('Runtime.evaluate', { expression: "document.querySelector('#addDrawingInput')" });
await cdp.send('DOM.setFileInputFiles', { files: [ROOT + 'test-fixtures/plan.png'], objectId: r.result.objectId });
await sleep(1400);
ok(await ev('__markerDbg.drawings.length === 1'), '도면을 한 장 올렸다');

/* 도면을 "1px 격자"로 바꿔 끼운다 — 축소 리샘플링이 일어나면 바로 드러나는 그림이다.
   superSample 을 끈 캔버스(미리보기가 쓰는 길)는 예전 방식과 똑같으므로, 둘을 나란히 재면
   고친 효과가 그대로 보인다. 재는 자리는 도면이 그려진 영역의 가운데 가로 한 줄이다. */
const probe = (w, h, superSample) => ev(`(async()=>{
  const d = __markerDbg.getActiveDrawing();
  const c = document.createElement('canvas'); c.width=${w}; c.height=${h};
  const g = c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,${w},${h});
  g.fillStyle='#000';
  for(let x=0;x<${w};x+=7) g.fillRect(x,0,1,${h});   /* 1px 세로선, 7px 간격 */
  for(let y=0;y<${h};y+=7) g.fillRect(0,y,${w},1);
  const url = c.toDataURL('image/png');
  await new Promise(res=>{ const im=new Image();
    im.onload=()=>{ d.imgEl=im; d.naturalW=${w}; d.naturalH=${h}; res(); }; im.src=url; });
  const cv = __markerDbg.buildExportCanvasTitleBlock(d, ${superSample ? 'undefined' : '{ superSample:false }'});
  const a = d.__tbDrawArea, k = cv.__layoutScale || 1;
  const px = Math.round(a.x*k), py = Math.round((a.y + a.h/2)*k), pw = Math.round(a.w*k);
  const row = cv.getContext('2d', { willReadFrequently:true }).getImageData(px, py, pw, 1).data;
  let black=0, gray=0;
  for(let i=0;i<pw;i++){ const v=row[i*4]; if(v<60) black++; else if(v<235) gray++; }
  return { page:[cv.width, cv.height], ss:k, layoutScale:+(a.w/${w}).toFixed(4),
           devScale:+((a.w*k)/${w}).toFixed(4), mpx:+((cv.width*cv.height)/1e6).toFixed(1),
           black, gray, lines: Math.ceil(${w}/7) };
})()`);

for (const [w, h, label] of [[2400, 1600, '가로로 긴 도면'], [1600, 2400, '세로로 긴 도면']]) {
  console.log('\n══ ' + label + ' (' + w + '×' + h + ') ══');
  const was = await probe(w, h, false);   // 예전 방식 = 종이 픽셀을 늘리지 않음
  const now = await probe(w, h, true);    // 지금 방식 = 줄어드는 만큼 늘림
  near(now.devScale, 1, 0.002, '도면이 원본 픽셀과 1:1로 찍힌다');
  ok(now.devScale > was.devScale * 1.1, '예전보다 촘촘해졌다', { 예전: was.devScale, 지금: now.devScale });
  near(now.layoutScale, was.layoutScale, 0.0001, '배치(도면이 차지하는 자리)는 조금도 달라지지 않았다');
  ok(now.black === now.lines && now.gray === 0,
     '1px 격자가 원본 그대로 선명하다(회색으로 뭉갠 선이 없다)', now);
  ok(was.gray > 0, '예전 방식에서는 같은 격자가 회색으로 뭉갰다', was);
  ok(now.mpx <= 38.1, '종이 픽셀 수가 상한(38M) 안이다', now.mpx);
  near(now.ss, 1 / was.layoutScale, 0.01, '늘린 배수는 줄어든 배율의 역수다');
}

/* ── 작은 도면은 원본보다 크게 늘려 그리지 않는다(비트맵을 확대하면 흐려진다) ── */
console.log('\n══ 도곽보다 작은 도면 ══');
const small = await probe(800, 600, true);
near(small.devScale, 1, 0.002, '원본 크기 그대로 찍힌다');
ok(small.ss === 1, '늘릴 이유가 없으면 종이 픽셀도 그대로다', small);

/* ── 미리보기는 1배 캔버스를 쓴다 — 화면에 축소해 보여줄 뿐이고, 범례·제목을 끌 때 쓰는
      좌표가 캔버스 픽셀 그대로여야 셈이 간단하기 때문이다 ── */
console.log('\n══ 미리보기 ══');
await probe(1600, 2400, true); // 종이 픽셀을 늘릴 이유가 있는 도면으로 되돌려 둔다
await ev(`(()=>{const c=document.getElementById('titleBlockToggle');
  c.checked = true; c.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(900);
ok(await ev("document.getElementById('tbPreviewBackdrop').style.display !== 'none'"),
   '도면틀을 켜면 미리보기가 열린다');
const pv = await ev(`(()=>{ const d=__markerDbg.getActiveDrawing();
  const cv=document.getElementById('tbPreviewCanvas');
  const save=__markerDbg.buildExportCanvasTitleBlock(d);
  return { pvW:cv.width, saveW:save.width, ss:save.__layoutScale||1,
           boxX:d.__tbLegendBox?d.__tbLegendBox.x:null, areaW:d.__tbLegendAnchor.area.w };})()`);
ok(pv.pvW < pv.saveW, '저장용 캔버스가 미리보기 캔버스보다 촘촘하다', pv);
ok(pv.boxX === null || pv.boxX < pv.areaW,
   '저장용으로 그린 뒤에도 끌기 좌표는 배치 단위로 남는다 — 미리보기 캔버스와 같은 자', pv);

/* ── PNG·PDF가 실제로 떨어지는지(한 장 · 전체 모두) ── */
console.log('\n══ 실제 저장 — PNG · PDF (한 장 · 전체) ══');
await ev(`(()=>{ document.getElementById('tbPreviewBackdrop').style.display='none';
  window.__blobs=[]; const o=URL.createObjectURL.bind(URL);
  URL.createObjectURL = b => { window.__blobs.push({ type:b.type, kb:Math.round(b.size/1024) }); return o(b); };
  return true;})()`);
const setSel = (id, v) => ev(`(()=>{const s=document.getElementById('${id}'); s.value='${v}';
  s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
const blobs = () => ev('window.__blobs');
await setSel('exportFormatSelect', 'pdf');
await setSel('exportPageSizeSelect', 'a4l');
await ev("document.getElementById('btnExportPNG').click(); true");
await sleep(6000);
let bs = await blobs();
ok(bs.length === 1 && bs[0].type === 'application/pdf' && bs[0].kb > 20, 'PDF 한 장이 만들어졌다', bs);
await ev("document.getElementById('btnExportAll').click(); true");
await sleep(8000);
bs = await blobs();
ok(bs.length === 2 && bs[1].type === 'application/pdf' && bs[1].kb > 20,
   '「전체 도면」도 PDF 한 파일로 만들어졌다(한 장씩 만들어 압축하는 길)', bs);
await setSel('exportFormatSelect', 'png');
await ev("document.getElementById('btnExportPNG').click(); true");
await sleep(5000);
bs = await blobs();
ok(bs.length === 3 && bs[2].type === 'image/png' && bs[2].kb > 20, 'PNG 한 장도 만들어졌다', bs);
await ev("document.getElementById('btnExportAll').click(); true");
await sleep(6000);
bs = await blobs();
ok(bs.length === 4 && bs[3].type === 'image/png' && bs[3].kb > 20,
   '「전체 도면」 PNG도 빈 그림이 아니다(다 쓴 캔버스를 비우는 시점이 맞다)', bs);
ok(!(await ev("!!document.querySelector('.import-progress-toast')")),
   '저장이 끝나면 진행 알림이 사라진다');

/* ── 콘솔 오류가 없어야 한다 ── */
// file:// 로 열면 manifest.json 이 CORS 로 막히는 것은 이 앱의 문제가 아니다(다른 검사와 같은 기준)
const errors = cdp.events
  .filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  .map(e => e.params.entry.text)
  .concat(cdp.events.filter(e => e.method === 'Runtime.exceptionThrown')
    .map(e => String(e.params.exceptionDetails.text)))
  .filter(t => !/manifest|net::ERR_FAILED|favicon/i.test(t));
ok(errors.length === 0, '실행 중 콘솔 오류가 없다', errors);

console.log('\n' + '─'.repeat(60));
console.log('  통과 ' + passes + ' · 실패 ' + fails);
finish(cdp, fails ? 1 : 0);
