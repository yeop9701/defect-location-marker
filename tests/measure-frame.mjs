/* 수정 전/후 비교용 측정자 — 저장용 캔버스를 실제로 그려, 세 요소(도면틀·표제란·범례)의
   자리와 크기를 "그려진 픽셀"에서 되재고 캔버스 전체의 지문(해시)까지 뽑는다.

     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<임시폴더> about:blank
     APP_URL=file:///...//_before_index.html node tests/measure-frame.mjs > before.json        */
import { connect, finish } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP = process.env.APP_URL || new URL('../index.html', import.meta.url).href;
const cdp = await connect(9222);
const ev = (s) => cdp.evaluate(s);

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

/* 도면을 결정론적인 그림으로 갈아 끼운다 — 같은 입력에서 같은 지문이 나와야 비교가 된다 */
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
const setField = (id, v) => ev(`(()=>{const i=document.getElementById('${id}');
  i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);

/* 그려진 캔버스에서 되재는 값
   - ink : 바깥에서 안으로 들어오며 처음 만나는 검은 점 = 도곽 테두리 (배치 단위 mm까지)
   - tb  : 가운데 세로줄에서 위쪽부터 만나는 검은 띠들 = 표제란 테두리·구분선의 y
   - hash: 캔버스 전체의 지문 (97바이트마다 섞는다) — 한 픽셀만 달라도 값이 바뀐다 */
const probe = (pageKey) => ev(`(()=>{
  const d = __markerDbg.getActiveDrawing();
  const cv = __markerDbg.buildExportCanvasTitleBlock(d, { superSample:false });
  const W = cv.width, H = cv.height;
  const g = cv.getContext('2d', { willReadFrequently:true });
  const dark = (a,i)=> a[i]<110 && a[i+1]<110 && a[i+2]<110;
  const row = g.getImageData(0, Math.round(H*0.62), W, 1).data;
  const col = g.getImageData(Math.round(W*0.5), 0, 1, H).data;
  let left=-1,right=-1,top=-1,bottom=-1;
  for(let x=0;x<W;x++){ if(dark(row,x*4)){ left=x; break; } }
  for(let x=W-1;x>=0;x--){ if(dark(row,x*4)){ right=x; break; } }
  for(let y=0;y<H;y++){ if(dark(col,y*4)){ top=y; break; } }
  for(let y=H-1;y>=0;y--){ if(dark(col,y*4)){ bottom=y; break; } }
  /* 표제란 띠 — 캔버스 왼쪽에서 8% 들어온 세로줄(배지·값 글자를 피한다) */
  const tcol = g.getImageData(Math.round(W*0.08), 0, 1, H).data;
  const bands = []; let run = -1;
  for(let y=0;y<H;y++){ const d0 = dark(tcol,y*4);
    if(d0 && run<0) run = y;
    else if(!d0 && run>=0){ bands.push([run, y-1]); run = -1; } }
  if(run>=0) bands.push([run, H-1]);
  /* 전체 지문 */
  const all = g.getImageData(0,0,W,H).data;
  let hash = 2166136261;
  for(let i=0;i<all.length;i+=97){ hash ^= all[i]; hash = (hash*16777619)>>>0; }
  let ink = 0;
  for(let i=0;i<all.length;i+=4){ if(all[i]<110) ink++; }
  const mmPerPx = 25.4/72 * (__markerDbg.PAPER_SIZES_PT['${pageKey}'] ? __markerDbg.PAPER_SIZES_PT['${pageKey}'][0] : 841.89) / W * (W/W);
  const paperMM = (__markerDbg.PAPER_SIZES_PT['${pageKey}'] ? __markerDbg.PAPER_SIZES_PT['${pageKey}'][0]*25.4/72 : 297);
  const k = paperMM / W;   /* 배치 px → mm */
  const b = d.__tbLegendBox, a = d.__tbDrawArea, fr = d.__tbFrameRect, t = d.__tbTitleBox;
  const n = (v)=> v===null||v===undefined ? null : +v.toFixed(2);
  const nm = (v)=> v===null||v===undefined ? null : +(v*k).toFixed(2);
  const out = {
    canvas:[W,H], ss:cv.__layoutScale||1, hash, ink,
    frameMM:{ left:nm(left), right:nm(W-1-right), top:nm(top), bottom:nm(H-1-bottom) },
    framePx:{ left, right:W-1-right, top, bottom:H-1-bottom },
    frameRectMM: fr ? { x:nm(fr.x), y:nm(fr.y), w:nm(fr.w), h:nm(fr.h) } : null,
    titleBandsMM: bands.slice(0,6).map(([a0,b0])=>[nm(a0), nm(b0)]),
    legendMM: b ? { x:nm(b.x), y:nm(b.y), w:nm(b.w), h:nm(b.h) } : null,
    imageMM: a ? { x:nm(a.x), y:nm(a.y), w:nm(a.w), h:nm(a.h) } : null,
    docTitleMM: t ? { x:nm(t.x+t.w/2), y:nm(t.y+t.h/2), h:nm(t.h) } : null,
  };
  cv.width=1; cv.height=1;
  return out; })()`);

await setField('projectNameInput', '2026년 정밀안전점검 용역');
await setField('siteNameInput', 'OO아파트 101동');
await setField('structureTypeInput', '철근콘크리트 벽식구조');
await setField('docTitleInput', '외관조사망도');
await ev(`(()=>{const c=document.getElementById('titleBlockToggle');
  if(!c.checked){ c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true})); } return true;})()`);
await sleep(600);
await ev("document.getElementById('tbPreviewBackdrop').style.display='none'; true");

const out = {};
for (const page of ['original', 'a4l', 'a4p', 'a3l', 'a3p']) {
  await setPage(page);
  out[page] = {};
  for (const [w, h] of [[2400, 1600], [1600, 2400], [800, 600], [3600, 2000]]) {
    await setDrawing(w, h);
    out[page][w + 'x' + h] = await probe(page === 'original' ? 'none' : page);
  }
}
/* PNG 용지 픽셀로 떨어뜨린 최종 결과(실제 저장물)의 지문 — a4l 한 종만 */
await setPage('a4l');
await setDrawing(2400, 1600);
out.pngA4L = await ev(`(()=>{
  const d=__markerDbg.getActiveDrawing();
  const cv=__markerDbg.buildExportCanvasFor(d,'png',true);
  const g=cv.getContext('2d',{willReadFrequently:true});
  const all=g.getImageData(0,0,cv.width,cv.height).data;
  let hash=2166136261, ink=0;
  for(let i=0;i<all.length;i+=97){ hash^=all[i]; hash=(hash*16777619)>>>0; }
  for(let i=0;i<all.length;i+=4){ if(all[i]<110) ink++; }
  const o={ canvas:[cv.width,cv.height], hash, ink };
  cv.width=1; cv.height=1; return o; })()`);
console.log(JSON.stringify(out, null, 1));
finish(cdp, 0);
