// 탐지 정확도 평가 — 규칙 단독 vs 규칙+AI
//
//   node scripts/eval.mjs              규칙만 측정 (AI 불필요, 빠름)
//   node scripts/eval.mjs --ai         AI까지 포함해 비교
//   node scripts/eval.mjs --ai --case 03
//
// 실제 모델을 호출하므로 CI 대상이 아니다. 수동으로 실행한다.
// 기준선 없이 AI를 붙이면 개선인지 악화인지 알 수 없다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectAll, resetIdCounter } from '../src/detect/engine.js';
import { runAiDetection } from '../src/ai/aiDetect.js';
import { resetAiIdCounter } from '../src/ai/merge.js';
import { checkAvailability, DEFAULT_MODEL } from '../src/ai/ollamaClient.js';

const here = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(join(here, '../test/fixtures/eval/cases.json'), 'utf8'));

const args = process.argv.slice(2);
const useAi = args.includes('--ai');
const onlyCase = args.includes('--case') ? args[args.indexOf('--case') + 1] : null;
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : DEFAULT_MODEL;

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// 정답과 탐지 결과를 값 기준으로 대조한다.
// 위치가 아니라 값으로 비교하는 이유: 같은 값이 여러 번 나와도 한 번 찾으면 인정한다.
function score(candidates, testCase) {
  const found = new Set(candidates.filter((c) => c.selected !== false).map((c) => c.originalText));
  const foundTypes = new Map(candidates.map((c) => [c.originalText, c.type]));

  const hit = [];
  const miss = [];
  let typeErrors = 0;

  for (const exp of testCase.expected) {
    // 정답 값을 포함하는 탐지가 있으면 찾은 것으로 본다 (범위가 더 넓어도 가려지므로 안전하다)
    const match = [...found].find((f) => f === exp.value || f.includes(exp.value));
    if (match) {
      hit.push(exp.value);
      if (foundTypes.get(match) !== exp.type) typeErrors += 1;
    } else {
      miss.push(exp.value);
    }
  }

  // 오탐: 정답에 없는데 탐지된 값 (notPii에 명시된 것은 확실한 오탐)
  const expectedValues = testCase.expected.map((e) => e.value);
  const falsePos = [...found].filter((f) =>
    !expectedValues.some((v) => f === v || f.includes(v) || v.includes(f)));
  const hardFalsePos = falsePos.filter((f) =>
    (testCase.notPii || []).some((n) => f === n || f.includes(n)));

  return { hit, miss, falsePos, hardFalsePos, typeErrors, total: testCase.expected.length };
}

function aggregate(results) {
  const sum = (k) => results.reduce((a, r) => a + (Array.isArray(r[k]) ? r[k].length : r[k]), 0);
  const tp = sum('hit');
  const fn = sum('miss');
  const fp = sum('falsePos');
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    tp, fn, fp, recall, precision, f1,
    hardFp: sum('hardFalsePos'),
    typeErrors: sum('typeErrors'),
  };
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const cases = CASES.cases.filter((c) => !onlyCase || c.id.startsWith(onlyCase));

  if (useAi) {
    const avail = await checkAvailability({ model });
    if (!avail.available) {
      console.error(C.red(`AI를 사용할 수 없습니다: ${avail.message}`));
      console.error(C.dim('Ollama를 실행하고 `ollama pull ' + model + '` 을 확인하십시오.'));
      process.exit(1);
    }
    console.log(C.dim(`모델 ${model} · Ollama ${avail.version}`));
  }

  const ruleResults = [];
  const aiResults = [];
  let totalMs = 0;

  console.log('');
  console.log(C.bold('사례별 결과'));
  console.log(C.dim('─'.repeat(78)));

  for (const tc of cases) {
    resetIdCounter();
    resetAiIdCounter();

    const ruleCands = detectAll(tc.text, 'body', []);
    const ruleScore = score(ruleCands, tc);
    ruleResults.push(ruleScore);

    let aiScore = null;
    let ms = 0;
    if (useAi) {
      const merged = detectAll(tc.text, 'body', []);
      const t0 = Date.now();
      await runAiDetection({ text: tc.text }, merged, { model });
      ms = Date.now() - t0;
      totalMs += ms;
      aiScore = score(merged, tc);
      aiResults.push(aiScore);
    }

    const s = aiScore || ruleScore;
    const mark = s.miss.length === 0 ? C.green('✓') : C.red('✗');
    const gain = aiScore ? aiScore.hit.length - ruleScore.hit.length : 0;
    const gainTxt = gain > 0 ? C.green(` (+${gain})`) : (gain < 0 ? C.red(` (${gain})`) : '');

    console.log(`${mark} ${tc.id.padEnd(16)} 재현 ${s.hit.length}/${s.total}${gainTxt}`
      + `  오탐 ${s.falsePos.length}${s.hardFalsePos.length > 0 ? C.red(`(확정 ${s.hardFalsePos.length})`) : ''}`
      + (useAi ? C.dim(`  ${(ms / 1000).toFixed(1)}s`) : ''));

    if (s.miss.length > 0) console.log(C.dim(`    놓침: ${s.miss.join(', ')}`));
    if (s.hardFalsePos.length > 0) console.log(C.yellow(`    확정 오탐: ${s.hardFalsePos.join(', ')}`));
    if (s.typeErrors > 0) console.log(C.yellow(`    유형 오분류: ${s.typeErrors}건`));
  }

  console.log(C.dim('─'.repeat(78)));
  console.log('');
  console.log(C.bold('종합'));

  const r = aggregate(ruleResults);
  const rows = [['', '재현율', '정밀도', 'F1', '놓침', '오탐', '유형오류']];
  rows.push(['규칙 단독', pct(r.recall), pct(r.precision), pct(r.f1), String(r.fn), String(r.fp), String(r.typeErrors)]);

  if (useAi) {
    const a = aggregate(aiResults);
    rows.push(['규칙 + AI', pct(a.recall), pct(a.precision), pct(a.f1), String(a.fn), String(a.fp), String(a.typeErrors)]);
    rows.push([
      '변화',
      (a.recall >= r.recall ? '+' : '') + pct(a.recall - r.recall),
      (a.precision >= r.precision ? '+' : '') + pct(a.precision - r.precision),
      (a.f1 >= r.f1 ? '+' : '') + pct(a.f1 - r.f1),
      String(a.fn - r.fn), String(a.fp - r.fp), String(a.typeErrors - r.typeErrors),
    ]);
  }

  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].replace(/\x1b\[[0-9;]*m/g, '').length)));
  for (const [ri, row] of rows.entries()) {
    const line = row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i] + 3))).join('');
    console.log(ri === 0 ? C.dim(line) : line);
  }

  if (useAi) {
    console.log('');
    console.log(C.dim(`AI 총 소요 ${(totalMs / 1000).toFixed(1)}초 · 사례당 평균 ${(totalMs / cases.length / 1000).toFixed(1)}초`));
    const a = aggregate(aiResults);
    console.log('');
    if (a.recall > r.recall) {
      console.log(C.green(`재현율이 ${pct(r.recall)} → ${pct(a.recall)} 로 개선되었습니다.`));
      if (a.precision < r.precision) {
        console.log(C.yellow(`다만 정밀도는 ${pct(r.precision)} → ${pct(a.precision)} 로 낮아졌습니다. 허용 범위인지 확인하십시오.`));
      }
    } else {
      console.log(C.red('재현율이 개선되지 않았습니다. 프롬프트나 청크 크기를 조정해야 합니다.'));
    }
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
