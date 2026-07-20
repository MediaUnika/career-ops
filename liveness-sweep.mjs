#!/usr/bin/env node
/**
 * liveness-sweep.mjs — clears out job postings that have expired since
 * they were evaluated or added to the pipeline, so the dashboard doesn't
 * keep showing dead links.
 *
 * Covers only undecided items — never anything already Applied/Rejected/etc:
 *  - data/applications.md rows with status "Evaluated": reads the report's
 *    **URL:** header; if expired, flips status to "Discarded" with a note.
 *    The report and PDF are left untouched (tracker rows are never deleted,
 *    per project rule — see AGENTS.md Pipeline Integrity).
 *  - data/pipeline.md pending items ("- [ ]") in the actual job-URL
 *    sections: if expired, removes the line and records it in
 *    scan-history.tsv (status skipped_expired), matching scan.mjs's own
 *    convention. The "Source boards to process" section is skipped
 *    entirely — those are saved search/listing URLs, not single postings,
 *    and would false-positive as "expired" (listing-page detection).
 *
 * Only acts on a definitive "expired" verdict from liveness-browser.mjs.
 * "uncertain" (timeouts, network errors, no visible apply control) is left
 * untouched on purpose — a transient failure must never cause a real lead
 * to be dropped.
 *
 * Usage: node liveness-sweep.mjs [--concurrency=3] [--limit=N] [--dry-run]
 * Prints a JSON summary to stdout; safe to run with no pending work.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { checkUrlLiveness } from './liveness-browser.mjs';

const ROOT = process.cwd();
const APPLICATIONS_PATH = path.join(ROOT, 'data/applications.md');
const PIPELINE_PATH = path.join(ROOT, 'data/pipeline.md');
const SCAN_HISTORY_PATH = path.join(ROOT, 'data/scan-history.tsv');

const HEADER_URL_RE = /^\*\*URL:\*\*\s*(.+)$/m;
const PENDING_LINE_RE = /^- \[ \] (https?:\/\/\S+)(?:\s*\|\s*([^|\n]+))?(?:\s*\|\s*([^|\n]+))?(?:\s*\|\s*([^|\n]+))?$/gm;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function splitRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((field) => field.trim());
}

function rowToLine(fields) {
  return `| ${fields.map((field) => String(field).replace(/\|/g, '/').trim()).join(' | ')} |`;
}

function loadEvaluatedTargets() {
  if (!existsSync(APPLICATIONS_PATH)) return [];
  const lines = readFileSync(APPLICATIONS_PATH, 'utf8').split(/\r?\n/);
  const targets = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const fields = splitRow(line);
    if (fields[0] === '#' || /^-+$/.test(fields[0])) continue; // header / separator row
    const [num, , company, role, , status, , report] = fields;
    if (status !== 'Evaluated') continue;
    const reportMatch = /\(([^)]+\.md)\)/.exec(report || '');
    if (!reportMatch) continue;
    const reportPath = path.join(ROOT, reportMatch[1]);
    if (!existsSync(reportPath)) continue;
    const url = HEADER_URL_RE.exec(readFileSync(reportPath, 'utf8'))?.[1]?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    targets.push({ kind: 'evaluated', num, company, role, url });
  }
  return targets;
}

function loadPipelineTargets() {
  if (!existsSync(PIPELINE_PATH)) return { text: '', targets: [] };
  const text = readFileSync(PIPELINE_PATH, 'utf8');
  const sections = text.split(/\n(?=## )/);
  const targets = [];
  for (const section of sections) {
    const heading = (section.match(/^## (.+)/) || [])[1] || '';
    if (/source boards? to process/i.test(heading)) continue; // saved searches, not single postings
    for (const match of section.matchAll(PENDING_LINE_RE)) {
      targets.push({
        kind: 'pipeline',
        line: match[0],
        url: match[1],
        company: (match[2] || '').trim(),
        title: (match[3] || '').trim(),
        location: (match[4] || '').trim(),
      });
    }
  }
  return { text, targets };
}

async function runConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

function applyApplicationDiscards(discarded) {
  if (discarded.length === 0 || !existsSync(APPLICATIONS_PATH)) return;
  const byNum = new Map(discarded.map((item) => [item.num, item]));
  const lines = readFileSync(APPLICATIONS_PATH, 'utf8').split(/\r?\n/).map((line) => {
    if (!line.startsWith('|')) return line;
    const fields = splitRow(line);
    if (!byNum.has(fields[0])) return line;
    fields[5] = 'Discarded';
    const tag = `Auto-discarded — posting expired ${today()}`;
    fields[8] = fields[8] ? `${tag}; ${fields[8]}` : tag;
    return rowToLine(fields);
  });
  writeFileSync(APPLICATIONS_PATH, lines.join('\n'), 'utf8');
}

function applyPipelineRemovals(pipelineText, removed) {
  if (removed.length === 0) return;
  const removedLines = new Set(removed.map((item) => item.line));
  const newText = pipelineText.split(/\r?\n/).filter((line) => !removedLines.has(line)).join('\n');
  writeFileSync(PIPELINE_PATH, newText, 'utf8');

  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n', 'utf8');
  }
  const historyLines = removed
    .map((item) => [item.url, today(), 'liveness-sweep', item.title, item.company, 'skipped_expired', item.location]
      .map((field) => String(field || '').replace(/\t/g, ' '))
      .join('\t'))
    .join('\n') + '\n';
  appendFileSync(SCAN_HISTORY_PATH, historyLines, 'utf8');
}

async function main() {
  const concurrencyArg = process.argv.find((arg) => arg.startsWith('--concurrency='));
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const concurrency = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : 3;

  const evaluated = loadEvaluatedTargets();
  const { text: pipelineText, targets: pipelinePending } = loadPipelineTargets();
  let allTargets = [...evaluated, ...pipelinePending];
  if (limitArg) allTargets = allTargets.slice(0, Number(limitArg.split('=')[1]));

  if (allTargets.length === 0) {
    console.log(JSON.stringify({ checked: 0, active: 0, expired: 0, uncertain: 0, discardedApplications: [], removedPipeline: [] }, null, 2));
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const results = await runConcurrent(allTargets, concurrency, async (target) => {
    const page = await context.newPage();
    try {
      const { result, reason } = await checkUrlLiveness(page, target.url);
      return { ...target, result, reason };
    } finally {
      await page.close();
    }
  });

  await browser.close();

  const discardedApplications = results.filter((r) => r.kind === 'evaluated' && r.result === 'expired');
  const removedPipeline = results.filter((r) => r.kind === 'pipeline' && r.result === 'expired');

  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) {
    applyApplicationDiscards(discardedApplications);
    applyPipelineRemovals(pipelineText, removedPipeline);
  }

  console.log(JSON.stringify({
    dryRun,
    checked: allTargets.length,
    active: results.filter((r) => r.result === 'active').length,
    expired: discardedApplications.length + removedPipeline.length,
    uncertain: results.filter((r) => r.result === 'uncertain').length,
    discardedApplications: discardedApplications.map((r) => ({ num: r.num, company: r.company, role: r.role, reason: r.reason })),
    removedPipeline: removedPipeline.map((r) => ({ company: r.company, title: r.title, reason: r.reason })),
  }, null, 2));
}

main().catch((err) => {
  console.error('Fatal:', err.stack || err.message);
  process.exit(1);
});
