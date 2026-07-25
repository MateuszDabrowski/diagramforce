// Objective grader for the diagramforce skill evals. For each eval x condition:
//  - does a diagram.json exist?
//  - does it pass the bundled Diagramforce validator (0 errors)?
//  - is the diagramType the expected one? how many cells?
//  - what else did the run produce (file list)?
// The value story: with_skill -> importable + correctly typed; without_skill -> not importable into Diagramforce.
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = '/Users/md/Documents/Code/vibe/diagramforce-dev/cowork-skill';
const VALIDATOR = `${ROOT}/diagramforce/scripts/validate-diagram.mjs`;
const ITER = `${ROOT}/diagramforce-workspace/iteration-1`;
const EVALS = [
  { name: 'eval-arch', expectType: 'architecture' },
  { name: 'eval-datacloud', expectType: 'datamapping' },
  { name: 'eval-process', expectType: 'process' },
];

function validate(file) {
  try { execSync(`node "${VALIDATOR}" "${file}"`, { encoding: 'utf8' }); return { pass: true, errors: 0 }; }
  catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    const m = out.match(/(\d+) error\(s\)/);
    return { pass: false, errors: m ? Number(m[1]) : 'n/a', out: out.trim().split('\n').slice(-6).join('\n') };
  }
}

const rows = [];
for (const ev of EVALS) {
  for (const cond of ['with_skill', 'without_skill']) {
    const dir = `${ITER}/${ev.name}/${cond}/outputs`;
    const files = existsSync(dir) ? readdirSync(dir) : [];
    const jsonPath = `${dir}/diagram.json`;
    const r = { eval: ev.name, cond, files };
    if (existsSync(jsonPath)) {
      let j = {}; try { j = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch (e) { r.parseErr = e.message; }
      r.diagramType = j.diagramType ?? null;
      r.cells = j?.graph?.cells?.length ?? null;
      r.typeMatch = r.diagramType === ev.expectType;
      const v = validate(jsonPath);
      r.validatorPass = v.pass; r.validatorErrors = v.errors; r.validatorTail = v.out;
    } else {
      r.diagramJson = false;
    }
    rows.push(r);
  }
}

// Print a compact table
const pad = (s, n) => String(s ?? '').padEnd(n);
console.log(pad('eval', 16), pad('cond', 15), pad('json?', 6), pad('type', 14), pad('typeOK', 7), pad('cells', 6), 'validator');
console.log('-'.repeat(92));
for (const r of rows) {
  const json = r.diagramJson === false ? 'no' : 'yes';
  const val = r.diagramJson === false ? '(no importable JSON)'
    : (r.validatorPass ? 'PASS (0 err)' : `FAIL (${r.validatorErrors} err)`);
  const typeOK = r.diagramJson === false ? '-' : (r.cond === 'with_skill' ? (r.typeMatch ? 'yes' : 'NO') : '-');
  console.log(pad(r.eval, 16), pad(r.cond, 15), pad(json, 6), pad(r.diagramType ?? '-', 14), pad(typeOK, 7), pad(r.cells ?? '-', 6), val);
}
console.log('\nFiles produced per run:');
for (const r of rows) console.log(`  ${pad(r.eval + '/' + r.cond, 32)} [${r.files.join(', ')}]`);

writeFileSync(`${ITER}/grading.json`, JSON.stringify(rows, null, 2));
console.log(`\nwrote ${ITER}/grading.json`);
