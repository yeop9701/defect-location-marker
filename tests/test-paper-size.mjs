/* 「용지 크기」(A4·A3) 내보내기 검사 — "PNG·PDF로 내보내면 도면마다 크기가 다 다르다"의 재발 방지.

   예전에는 용지 선택이 PDF에만 있어서, PNG은 도면 원본 픽셀 그대로(도면틀을 켜면 도면 폭에서
   계산한 크기로) 떨어졌다 — 도면 10장을 저장하면 10가지 크기가 나와 보고서에 붙일 때마다
   손으로 맞춰야 했다. 지금은 「용지 크기」가 PNG·PDF 공통이고, 고르면
     · PNG : 정확히 그 용지의 300dpi 픽셀 크기(A4 가로 3508×2480 · A3 가로 4961×3508)
     · PDF : 정확히 그 용지의 pt 크기(MediaBox)
   로 떨어진다. 도면틀도 고른 용지 비율로 그려지므로 도곽이 종이를 꽉 채운다.

   여기서 보는 것은 "값이 그렇게 되어 있다"가 아니라 실제로 만들어진 캔버스의 픽셀 수와
   실제로 떨어진 PDF 파일의 MediaBox다.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     node tests/test-paper-size.mjs                                                         */
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

/* 도면의 원본 크기를 갈아 끼운다 — "도면이 무엇이든 저장 크기는 같다"를 보려면 크기가
   다른 도면 여러 개가 필요하다(내보내기는 d.imgEl/naturalW·naturalH만 본다). */
const setDrawingSize = (w, h) => ev(`(async()=>{
  const d = __markerDbg.getActiveDrawing();
  const c = document.createElement('canvas'); c.width=${w}; c.height=${h};
  const g = c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,${w},${h});
  g.fillStyle='#000'; g.fillRect(0,0,${w},6); g.fillRect(0,${h}-6,${w},6);      /* 위·아래 띠 */
  g.fillRect(0,0,6,${h}); g.fillRect(${w}-6,0,6,${h});                          /* 좌·우 띠 */
  const url = c.toDataURL('image/png');
  await new Promise(res=>{ const im=new Image();
    im.onload=()=>{ d.imgEl=im; d.naturalW=${w}; d.naturalH=${h}; res(); }; im.src=url; });
  return [d.naturalW, d.naturalH];
})()`);

const setPage = (key) => ev(`(()=>{ const s=document.getElementById('exportPageSizeSelect');
  s.value='${key}'; s.dispatchEvent(new Event('change',{bubbles:true})); return s.value; })()`);
const setTitleBlock = (on) => ev(`(()=>{ document.getElementById('titleBlockToggle').checked=${on}; return true; })()`);

/* 저장용 캔버스를 실제 저장과 똑같은 길(buildExportCanvasFor)로 만들어 재고 비운다.
   흰 여백 여부까지 보려면 네 꼭지점 픽셀도 함께 읽는다. */
const canvasOf = (format) => ev(`(()=>{
  const d = __markerDbg.getActiveDrawing();
  const tb = document.getElementById('titleBlockToggle').checked;
  const cv = __markerDbg.buildExportCanvasFor(d, '${format}', tb);
  const g = cv.getContext('2d', { willReadFrequently:true });
  const px = (x,y)=>{ const p=g.getImageData(x,y,1,1).data; return [p[0],p[1],p[2]]; };
  const mid = px(Math.round(cv.width/2), Math.round(cv.height/2));
  const corner = px(2,2);
  const out = { w:cv.width, h:cv.height, ratio:+(cv.width/cv.height).toFixed(4),
                ls:+(cv.__layoutScale||1).toFixed(4), mid, corner,
                area: d.__tbDrawArea ? { w:+d.__tbDrawArea.w.toFixed(1), h:+d.__tbDrawArea.h.toFixed(1),
                                         x:+d.__tbDrawArea.x.toFixed(1), y:+d.__tbDrawArea.y.toFixed(1) } : null,
                anchor: d.__tbLegendAnchor ? { w:d.__tbLegendAnchor.area.w, h:d.__tbLegendAnchor.area.h } : null };
  cv.width = 1; cv.height = 1;
  return out;
})()`);

const PAPER_PX = { a4l:[3508,2480], a4p:[2480,3508], a3l:[4961,3508], a3p:[3508,4961] };
const PAPER_PT = { a4l:[841.89,595.28], a4p:[595.28,841.89], a3l:[1190.55,841.89], a3p:[841.89,1190.55] };

/* ── 1. PNG은 고른 용지의 픽셀 크기로 정확히 떨어진다 (도면틀 끔/켬, 도면 크기 3가지) ── */
for (const [dw, dh, label] of [[2400,1600,'가로로 긴 도면'], [1600,2400,'세로로 긴 도면'], [800,600,'작은 도면']]) {
  await setDrawingSize(dw, dh);
  for (const tb of [false, true]) {
    console.log('\n══ PNG · ' + label + ' (' + dw + '×' + dh + ') · 도면틀 ' + (tb ? '켬' : '끔') + ' ══');
    await setTitleBlock(tb);
    for (const key of ['a4l','a4p','a3l','a3p']) {
      await setPage(key);
      const c = await canvasOf('png');
      ok(c.w === PAPER_PX[key][0] && c.h === PAPER_PX[key][1],
         key + ' → ' + PAPER_PX[key][0] + '×' + PAPER_PX[key][1] + 'px', c);
      // 도면이 종이 안에서 찌그러지지 않는다(그려진 자리의 비율 = 도면 원본 비율)
      if (c.area) near(c.area.w/c.area.h, dw/dh, 0.02, '  도면 비율이 그대로다(찌그러지지 않는다)');
      // 종이는 흰 바탕이다 — 도면이 용지 비율과 달라 남는 자리가 투명하면 PDF에서 검게 나온다
      ok(c.corner[0] === 255 && c.corner[1] === 255 && c.corner[2] === 255,
         '  종이 바탕이 흰색이다', c.corner);
    }
  }
}

/* ── 2. 도면이 무엇이든 저장 크기가 같다 (이 기능을 만든 이유) ── */
console.log('\n══ 도면마다 크기가 달라지지 않는다 ══');
await setPage('a4l');
const sizes = [];
for (const [dw, dh] of [[2400,1600], [1600,2400], [800,600], [3600,2000]]) {
  await setDrawingSize(dw, dh);
  for (const tb of [false, true]) {
    await setTitleBlock(tb);
    const c = await canvasOf('png');
    sizes.push(`${c.w}×${c.h}`);
  }
}
ok(new Set(sizes).size === 1 && sizes[0] === '3508×2480',
   '도면 4종 × 도면틀 끔/켬 = 8장이 모두 3508×2480px', sizes);

/* ── 3. 도면틀은 고른 용지 비율로 그려진다 → 종이에 여백이 더 붙지 않는다 ── */
console.log('\n══ 도면틀이 용지를 꽉 채운다 ══');
await setDrawingSize(2400, 1600);
await setTitleBlock(true);
for (const key of ['a4l','a4p','a3l','a3p']) {
  await setPage(key);
  const g = await ev(`(()=>{
    const d=__markerDbg.getActiveDrawing();
    const cv=__markerDbg.buildExportCanvasTitleBlock(d, { superSample:false });
    const paperRatio = __markerDbg.PAPER_SIZES_PT['${key}'][0]/__markerDbg.PAPER_SIZES_PT['${key}'][1];
    const [W,H] = __markerDbg.paperPixelSize('${key}');
    const r = __markerDbg.layoutOnPaper(cv.width, cv.height, W, H, __markerDbg.PAPER_MARGIN_PT*(__markerDbg.EXPORT_PAPER_DPI/72));
    const out = { ratio:+(cv.width/cv.height).toFixed(4), paperRatio:+paperRatio.toFixed(4),
                  fill:+(r.w/W).toFixed(4), x:+r.x.toFixed(2) };
    cv.width=1; cv.height=1; return out;
  })()`);
  near(g.ratio, g.paperRatio, 0.002, key + ' 도곽 비율이 용지 비율과 같다');
  // 종이 픽셀이 정수라 한 변에 1px 미만이 남을 수 있다 — 그 이상 남으면 "비율이 안 맞아
  // 둘레에 흰 띠가 생긴다"는 뜻이다(PAPER_MARGIN_PT 100px이 붙으면 fill이 0.94로 떨어진다).
  ok(g.fill >= 0.999 && g.x <= 1.01, '  → 용지를 꽉 채운다(둘레 여백 1px 미만)', g);
}

/* ── 4. 「원본 비율」은 예전 그대로다 ── */
console.log('\n══ 원본 비율(예전 동작) ══');
await setPage('original');
ok((await ev('__markerDbg.exportPageSizeKey()')) === null, '용지를 고르지 않은 상태로 돌아간다');
await setTitleBlock(false);
const orig = await canvasOf('png');
ok(orig.w === 2400 && orig.h === 1600, '도면틀 끔 → 도면 원본 픽셀 그대로(2400×1600)', orig);
await setTitleBlock(true);
const origTb = await canvasOf('png');
near(origTb.ratio, 297/210, 0.002, '도면틀 켬 → 예전처럼 A4 가로 비율');
ok(origTb.w !== 3508, '예전 동작에서는 용지 픽셀로 맞추지 않는다', origTb);

/* ── 5. PDF는 실제 용지 크기(MediaBox)로 떨어진다 ── */
console.log('\n══ PDF 용지 크기(MediaBox) ══');
await ev(`(()=>{ window.__blobs=[]; const o=URL.createObjectURL.bind(URL);
  URL.createObjectURL = b => { window.__blobs.push(b); return o(b); }; return true; })()`);
await ev(`(()=>{ const s=document.getElementById('exportFormatSelect'); s.value='pdf';
  s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
for (const [key, tb] of [['a4l',true], ['a4p',false], ['a3l',true], ['a3p',false]]) {
  await setPage(key);
  await setTitleBlock(tb);
  await ev("document.getElementById('btnExportPNG').click(); true");
  await sleep(7000);
  const got = await ev(`(async()=>{ const b=window.__blobs.at(-1);
    const t = await b.slice(0, 1200).text();
    const m = t.match(/MediaBox \\[([^\\]]+)\\]/);
    return { type:b.type, kb:Math.round(b.size/1024), box:m ? m[1] : null, n:window.__blobs.length };
  })()`);
  const want = `0 0 ${PAPER_PT[key][0].toFixed(2)} ${PAPER_PT[key][1].toFixed(2)}`;
  ok(got.type === 'application/pdf' && got.box === want && got.kb > 10,
     key + ' · 도면틀 ' + (tb ? '켬' : '끔') + ' → MediaBox [' + want + ']', got);
}
// 「원본 비율」 PDF는 예전처럼 캔버스 크기에서 환산한 종이다(용지 크기가 아니다)
await setPage('original');
await setTitleBlock(true);
await ev("document.getElementById('btnExportPNG').click(); true");
await sleep(7000);
const origPdf = await ev(`(async()=>{ const b=window.__blobs.at(-1);
  const t = await b.slice(0,1200).text(); const m=t.match(/MediaBox \\[([^\\]]+)\\]/);
  return { box:m?m[1]:null }; })()`);
ok(origPdf.box && origPdf.box !== `0 0 ${PAPER_PT.a4l[0].toFixed(2)} ${PAPER_PT.a4l[1].toFixed(2)}`,
   '「원본 비율」은 용지 크기로 바뀌지 않는다(예전 동작 유지)', origPdf);

/* ── 6. 고른 용지는 다음에 열 때도 그대로 남는다 ── */
console.log('\n══ 고른 용지를 기억한다 ══');
await setPage('a3p');
await cdp.send('Page.navigate', { url: APP });
await sleep(1800);
ok((await ev("document.getElementById('exportPageSizeSelect').value")) === 'a3p',
   '새로 열어도 A3 세로가 그대로 골라져 있다');
ok((await ev('__markerDbg.exportPageSizeKey()')) === 'a3p', '내보내기도 그 값을 쓴다');

/* ── 7. 콘솔 오류가 없어야 한다 ── */
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
