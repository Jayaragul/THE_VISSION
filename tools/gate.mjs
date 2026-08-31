#!/usr/bin/env node
// The publish gate, wrapped so a failure can be handed back to the model as a repair brief.
//
//   node tools/gate.mjs            # gate; on failure write the repair brief and exit 1
//   node tools/gate.mjs --quiet    # same, without echoing the report
//
// Why this exists as a separate tool: the scheduled pipeline used to generate an edition,
// hit the gate, fail on one small violation, and die — leaving the day with no paper. Across
// two consecutive runs the failures were a duplicate source, a stale eval binding, a
// confidence label without a primary, and a top story with one source. Four different
// errors, every one fixable in under a minute, none of them ever fixed, because the model
// never got a second turn.
//
// Hardening the prompt does not converge on this. Each time one failure is named, the model
// finds a different rule to trip on the next morning — generation and validation are
// different problems and no amount of instruction collapses them. What does converge is a
// loop: generate, validate, repair, revalidate. The validator's own output is already an
// almost perfect repair instruction, so this writes it where the model can read it.
//
// Scope note: --strict applies only to the edition this run produced. The archive is checked
// for errors alone. A published edition's warnings can never be fixed (rule 3 — the archive
// is a record), so gating tomorrow's paper on them deadlocks the paper permanently.

import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = join(ROOT, 'gate-report.txt');
const QUIET = process.argv.includes('--quiet');

function run(args) {
  try {
    return { ok: true, out: execFileSync('node', args, { cwd: ROOT, encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/** Edition files this run created or modified. Using git rather than "today's date" keeps
 *  backfills working, and catches the case where the model wrote nothing at all. */
function changedEditions() {
  const out = execFileSync('git', ['status', '--porcelain', 'generated/'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return [...out.matchAll(/generated\/\d{4}-\d{2}-\d{2}\.json/g)].map((m) => m[0]);
}

const editions = changedEditions();

if (!editions.length) {
  const msg =
    'No new or changed edition file under generated/. The research stage produced nothing to publish.';
  writeFileSync(REPORT, msg + '\n');

  // Distinct from a normal gate failure, and the repair loop must sit this one out.
  //
  // Nothing written is not a repairable defect — there is no artifact to repair. A run
  // where this happened handed the "no edition" message to the repair step as if it were a
  // brief, and the model dutifully wrote an entire edition from scratch under a prompt that
  // explicitly forbids new research. The result was exactly what that contradiction
  // predicts: invented prominence values, single-source leads, headline-length slugs. Far
  // worse than publishing nothing, which is what the wire fallback is for.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'no_edition=true\n');
  }

  console.error(`\n✗ ${msg}`);
  console.error('  Skipping the repair loop — there is nothing to repair.\n');
  process.exit(1);
}

console.log(`\nGating (strict): ${editions.join(', ')}`);
const edition = run(['tools/validate.mjs', '--strict', ...editions]);
console.log(edition.out.trimEnd());

console.log('\nArchive (errors only):');
const archive = run(['tools/validate.mjs']);
console.log(archive.out.trimEnd());

if (edition.ok && archive.ok) {
  writeFileSync(REPORT, 'PASS\n');
  console.log('\n✓ Gate passed.\n');
  process.exit(0);
}

// ------------------------------------------------------------ repair brief ----

// Only lines the model can actually act on, and each one only once.
//
// Three filters matter here. Notes are advisory by design — asking for them to be "fixed"
// pushes the model to pad the edition, the opposite of rule 5. The archive pass contributes
// errors only: its warnings sit on published editions that rule 3 makes unfixable, and the
// first draft of this brief cheerfully told the model to go fix a lead story from a week
// earlier. And both passes cover the changed edition, so the same error arrives twice unless
// it is deduplicated.
const seen = new Set();
const actionable = [
  ...edition.out.split('\n').filter((l) => /^\s+(error|warn)\s/.test(l)),
  ...archive.out.split('\n').filter((l) => /^\s+error\s/.test(l)),
]
  .map((l) => l.trim())
  .filter((l) => {
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });

const brief = `THE VISSION — gate failed. This is a repair brief, not a new assignment.

${actionable.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Fix ONLY the issues listed above, in the edition file(s) this run wrote:
${editions.map((f) => `  ${f}`).join('\n')}

Rules for this repair:
  - Do not add, remove or rewrite stories that are not named above.
  - Do not change a source URL unless the error is about that URL.
  - Never invent a source, a quotation, a number or a date to satisfy a check. If a story
    cannot be fixed honestly, drop that story instead — a short edition is fine and expected.
  - "confidence: high" requires a tier-1 primary source you actually opened. If there is no
    tier-1 source, lower the label rather than re-tiering the source.
  - A top story needs two genuinely independent sources. If it only has one, demote it to
    "standard" rather than inventing a second.
  - If two stories share a source, merge them or drop the weaker one.

Do not spend any of your time on the eval binding hash. Editing a story invalidates it, and
the pipeline re-binds it for you: \`node tools/rebind-eval.mjs --changed\` runs between this
repair and the gate that judges it, so a "stale binding" line above is already handled. Never
hand-edit that hash and never write your own script to compute one. Spend the whole of your
budget on the errors that need judgement instead.

(Running this gate by hand rather than in the pipeline? Then run it yourself when you are
done: \`node tools/rebind-eval.mjs ${editions[0].replace('generated/', '').replace('.json', '')}\`.)

Then stop. The gate runs again automatically.
`;

writeFileSync(REPORT, brief);
if (!QUIET) console.log(`\n${'─'.repeat(72)}\n${brief}`);
console.log(`repair brief → gate-report.txt`);
process.exit(1);
