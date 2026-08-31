#!/usr/bin/env node
// The weekly review: a fully deterministic synthesis of the paper's own continuity fields
// — threads, open questions, corrections — over the trailing 7 calendar days ending at the
// latest published edition. No model, no API key, no network access: same posture as
// tools/digest.mjs, and for the same reason. Everything on this page is either copied
// verbatim from a field an edition already published (thread.label, openQuestion,
// resolves.outcome, corrections[].what) or a fixed template with a computed count
// substituted in. There is no url field anywhere in schema/weekly.schema.json — the only
// pointer type is a storyId — so this cannot introduce a new sourcing risk even in
// principle, and there is nothing here for a model to write off-script.
//
// The actual logic lives in tools/lib/weekly.mjs, testable without touching the filesystem
// — this file is the thin CLI wrapper, same split as continuity.mjs / build.mjs.
//
//   node tools/weekly.mjs                    # week ending at today's latest edition
//   node tools/weekly.mjs 2026-08-31          # week ending at the latest edition on or
//                                             #   before this date (for backfilling)
//   node tools/weekly.mjs 2026-08-31 schedule # also stamp week.generator.trigger
//
// Deliberately NOT wired into tools/validate.mjs or tools/gate.mjs — both are shaped for
// generated/<date>.json (collect() in validate.mjs matches only that filename pattern), and
// handing either one a weekly file would apply edition.schema.json to the wrong shape. This
// script self-validates before writing, exactly like tools/digest.mjs, which is never wired
// into them either.
//
// A free-text "editor's note" paragraph synthesising the week was considered and rejected.
// Continuity.mjs's own header names why: shared entities produce false connections on this
// archive ("Hugging Face" already links an unrelated Qwen release to an Nvidia bid), and a
// sentence connecting two threads that share no declared thread.id is exactly that failure
// mode. There is no field in the schema where such a sentence could go.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, isoDate } from './lib/util.mjs';
import { validate as validateSchema, assertSupported } from './lib/schema.mjs';
import { checkReferentialIntegrity, buildWeeklyDoc } from './lib/weekly.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const asOf = process.argv[2] || isoDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error(`✗ "${asOf}" is not a YYYY-MM-DD date`);
  process.exit(2);
}
const TRIGGER_ENUM = new Set(['manual', 'schedule', 'backfill']);
const trigger = process.argv[3];
if (trigger && !TRIGGER_ENUM.has(trigger)) {
  console.error(`✗ "${trigger}" is not one of manual | schedule | backfill`);
  process.exit(2);
}

const genDir = join(ROOT, 'generated');
const editionFiles = existsSync(genDir)
  ? readdirSync(genDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  : [];

if (!editionFiles.length) {
  console.log('No editions in generated/ yet — nothing to review. Skipping.');
  process.exit(0);
}

const editions = editionFiles.map((f) => readJSON(join(genDir, f)));

const problems = checkReferentialIntegrity(editions);
if (problems.length) {
  console.error('✗ referential integrity check failed — refusing to write the weekly review:');
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

const doc = buildWeeklyDoc(editions, asOf, { trigger, runId: process.env.GITHUB_RUN_ID });
if (!doc) {
  console.log(`No edition on or before ${asOf} — nothing to review. Skipping.`);
  process.exit(0);
}

const weeklySchema = readJSON(join(ROOT, 'schema', 'weekly.schema.json'));
assertSupported(weeklySchema);
const schemaErrors = validateSchema(doc, weeklySchema);
if (schemaErrors.length) {
  console.error(`✗ weekly review failed its own schema — refusing to write it:`);
  for (const e of schemaErrors) console.error(`    ${e.path}: ${e.message}`);
  process.exit(1);
}

const outDir = join(ROOT, 'generated', 'weekly');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${asOf}.json`), JSON.stringify(doc, null, 2) + '\n');

const { week, threads, openQuestions, corrections } = doc;
console.log(
  `✓ weekly review ${asOf}: window ${week.from}..${week.to} (${week.editionDates.length} edition(s), ` +
    `${week.stats.storyCount} stories) — ${threads.length} thread(s), ` +
    `${openQuestions.askedThisWeek.length} question(s) asked this week, ${openQuestions.answeredThisWeek.length} answered, ` +
    `${openQuestions.stillOpen.length} still open, ${corrections.length} correction(s) dated this week`
);
