// 헤더와 모든 행의 열 시작 위치가 1px 이내로 일치하는지, 4개 프리셋 전부에서 확인한다.
// 12단계에서 손으로 맞췄던 정렬이 이번 구조 변경 후에도 유지되는지를 기계가 대신 본다.
import { chromium } from 'playwright';
const b = await chromium.launch();
// 1920px에서 본다. 이 검사가 보는 것은 "헤더와 행이 같은 열 트랙을 쓰는가"인데, 우측 패널이 좁아
// 줄바꿈 카드 배치(.marker-list-wrap.narrow)로 떨어지면 헤더 자체가 숨겨져(.marker-list-head
// display:none) 비교할 대상이 사라진다. 예전의 1440px은 이미 그 폭 아래라 무엇을 재는지 알 수 없는
// 값이 나왔다 — 한 줄 표가 실제로 쓰이는 폭에서 재야 의미가 있다.
const p = await (await b.newContext({viewport:{width:1920,height:1000}})).newPage();
const errors = [];
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
p.on('console', m => { if(m.type()==='error') errors.push('CONSOLE: ' + m.text()); });
p.on('dialog', d => d.accept().catch(()=>{}));

await p.goto('file://' + process.cwd() + '/index.html');
await p.waitForTimeout(500);

let failed = 0;
for(const preset of ['외관조사','장비조사','부동침하','기울기']){
  await p.selectOption('#seriesPresetSelect', preset).catch(()=>{});
  await p.waitForTimeout(200);
  // 프리셋마다 새 도면을 추가해 마킹한다 — 같은 도면·같은 좌표를 재사용하면 이전 프리셋에서 찍은
  // 마커 위에 클릭이 겹쳐 "새로 찍기"가 아니라 "기존 마커 선택"으로 처리되어 버린다.
  await p.setInputFiles('#addDrawingInput', 'test-fixtures/plan.png');
  await p.waitForTimeout(600);
  const box = await (await p.$('#mainCanvas')).boundingBox();
  for(let i=0;i<4;i++) await p.mouse.click(box.x+90+i*110, box.y+70+i*70);
  await p.waitForTimeout(400);

  const r = await p.evaluate(()=>{
    const head = [...document.querySelector('.marker-list-head').children];
    const rows = [...document.querySelectorAll('.marker-card')].map(c=>[...c.children]);
    const L = el => Math.round(el.getBoundingClientRect().left);
    return {
      headCount: head.length,
      rowCounts: rows.map(r=>r.length),
      drift: head.map((h,i)=>{
        const xs = [L(h), ...rows.map(r=>r[i] ? L(r[i]) : L(h))];
        return Math.max(...xs) - Math.min(...xs);
      }),
      heights: [...new Set([...document.querySelectorAll('.marker-card input, .marker-card select')]
        .map(e=>Math.round(e.getBoundingClientRect().height)))],
    };
  });
  const countOK = r.rowCounts.every(c => c === r.headCount);
  const driftOK = r.drift.every(d => d <= 1);
  const heightOK = r.heights.length === 1;
  if(!countOK || !driftOK || !heightOK){
    failed++;
    console.log(`✗ ${preset}  헤더칸=${r.headCount} 행칸=${JSON.stringify(r.rowCounts)}` +
                ` 드리프트=${JSON.stringify(r.drift)} 높이종류=${JSON.stringify(r.heights)}`);
  } else {
    console.log(`✓ ${preset}  칸 ${r.headCount}개, 드리프트 0~1px, 높이 ${r.heights[0]}px`);
  }
}
if(errors.length){ failed++; console.log('✗ 콘솔/페이지 에러:', errors); }
await b.close();
process.exit(failed ? 1 : 0);
