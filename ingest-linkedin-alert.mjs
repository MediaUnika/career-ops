#!/usr/bin/env node

/**
 * Ingest LinkedIn job-alert text into Career Ops.
 *
 * Usage:
 *   node ingest-linkedin-alert.mjs path/to/pasted-linkedin-job.txt
 *   Get-Clipboard | node ingest-linkedin-alert.mjs --stdin
 *
 * If the input contains a full copied LinkedIn job page, the script writes a
 * local JD file under jds/ and appends a local:jds/... item to data/pipeline.md.
 * If the input contains LinkedIn /jobs/view/ URLs, those URLs are appended
 * directly. Plain alert summaries without URLs are stored as low-detail local
 * leads so they are not lost, but the full JD text is still better.
 */

import fs from 'node:fs';
import path from 'node:path';
import { repairText } from './utils/text.mjs';

const PIPELINE_PATH = 'data/pipeline.md';
const JDS_DIR = 'jds';

function clean(text = '') {
  return repairText(String(text))
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function oneLine(text = '') {
  return clean(text).replace(/\s+/g, ' ').trim();
}

function slug(text = '') {
  return oneLine(text)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 96)
    .replace(/^-|-$/g, '') || 'linkedin-job';
}

function readInputs() {
  const stdinFlag = process.argv.includes('--stdin');
  const fileArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (stdinFlag || !fileArg) {
    return [{ source: 'stdin', text: fs.readFileSync(0, 'utf8') }];
  }
  const stat = fs.statSync(fileArg);
  if (stat.isDirectory()) {
    return fs.readdirSync(fileArg)
      .filter((name) => /\.(txt|eml|html?)$/i.test(name))
      .map((name) => {
        const file = path.join(fileArg, name);
        return { source: file, text: fs.readFileSync(file, 'utf8') };
      });
  }
  return [{ source: fileArg, text: fs.readFileSync(fileArg, 'utf8') }];
}

function decodeUrl(url) {
  return url
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/g, '&')
    .replace(/[)\].,;]+$/g, '');
}

function linkedInUrls(text) {
  const urls = new Set();
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const url = decodeUrl(match[0]);
    if (/linkedin\.com\/jobs\/view\/\d+/i.test(url)) {
      urls.add(url.replace(/(\?|&).+$/, '/'));
    }
  }
  return [...urls];
}

function firstMeaningfulLine(lines) {
  return lines.find((line) =>
    line.length > 8 &&
    !/^(virksomhedslogo|linkedin job alerts|your job alert|new jobs|easy apply|apply|ansog|gem|save|ja|nej|see all jobs|install linkedIn widgets)/i.test(line)
  ) || '';
}

function parseFullJob(text) {
  const lines = clean(text)
    .split('\n')
    .map(oneLine)
    .filter(Boolean);

  const locationIndex = lines.findIndex((line) =>
    /copenhagen|kobenhavn|københavn|region hovedstaden|denmark|danmark|remote|london|new york|las vegas/i.test(line)
  );
  const preLocation = locationIndex >= 0
    ? lines.slice(0, locationIndex).filter((line) => !/^virksomhedslogo/i.test(line))
    : lines.slice(0, 16).filter((line) => !/^virksomhedslogo/i.test(line));
  const title = preLocation.at(-1) || firstMeaningfulLine(lines.slice(0, 16));
  const company = preLocation.at(-2) || lines.slice(locationIndex + 1, locationIndex + 4).find((line) => line !== title && !/ansog|gem|fuldtid/i.test(line)) || '';
  const locationLine = locationIndex >= 0 ? lines[locationIndex] : '';
  const location = locationLine
    .replace(/\s*[·•].*$/, '')
    .replace(/København|Kobenhavn|KÃ¸benhavn/i, 'Copenhagen')
    .replace(/Danmark/i, 'Denmark')
    .trim();

  const hasJobBody = /om jobbet|about the job|jobbet|ansættelsesforhold|qualifications|responsibilities|requirements/i.test(text);
  if (!title || !hasJobBody) return null;
  return {
    title,
    company: company || 'LinkedIn',
    location,
    body: text,
  };
}

function parseAlertSummary(text) {
  const lines = clean(text)
    .split('\n')
    .map(oneLine)
    .filter(Boolean);
  const jobs = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const title = lines[i];
    const next = lines[i + 1];
    const companyMatch = next.match(/^(.+?)\s+[·-]\s+(.+)$/);
    if (!companyMatch) continue;
    if (/linkedin job alerts|your job alert|new jobs|stand out|premium|unsubscribe/i.test(title)) continue;
    jobs.push({
      title,
      company: companyMatch[1].trim(),
      location: companyMatch[2].replace(/\s*\(.+\)\s*$/, '').trim(),
      body: `${title}\n${next}\n\nLow-detail LinkedIn alert summary. Paste or save the full LinkedIn job page for a stronger evaluation.`,
    });
  }
  return jobs;
}

function ensurePipeline() {
  fs.mkdirSync('data', { recursive: true });
  if (!fs.existsSync(PIPELINE_PATH)) {
    fs.writeFileSync(PIPELINE_PATH, '# Pipeline — Pending URLs (Inbox)\n\n## Pendientes\n\n', 'utf8');
  }
}

function pipelineHas(text, urlOrLocal, company, title) {
  const normalized = `${oneLine(company).toLowerCase()}::${oneLine(title).toLowerCase()}`;
  if (urlOrLocal && text.includes(urlOrLocal)) return true;
  return text
    .split(/\r?\n/)
    .some((line) => {
      const parts = line.split('|').map((part) => oneLine(part));
      if (parts.length < 3) return false;
      return `${parts[1].toLowerCase()}::${parts[2].toLowerCase()}` === normalized;
    });
}

function appendPipeline(entries) {
  ensurePipeline();
  let text = fs.readFileSync(PIPELINE_PATH, 'utf8');
  const marker = text.includes('## Pendientes') ? '## Pendientes' : '## Pending';
  let insertAt = text.length;
  const markerIndex = text.indexOf(marker);
  if (markerIndex >= 0) {
    const nextSection = text.indexOf('\n## ', markerIndex + marker.length);
    insertAt = nextSection === -1 ? text.length : nextSection;
  }

  const lines = [];
  for (const entry of entries) {
    if (pipelineHas(text, entry.url, entry.company, entry.title)) continue;
    lines.push(`- [ ] ${entry.url} | ${entry.company} | ${entry.title}${entry.location ? ` | ${entry.location}` : ''}`);
  }
  if (lines.length === 0) return 0;
  text = `${text.slice(0, insertAt).trimEnd()}\n${lines.join('\n')}\n\n${text.slice(insertAt).trimStart()}`;
  fs.writeFileSync(PIPELINE_PATH, text, 'utf8');
  return lines.length;
}

function writeLocalJob(job) {
  fs.mkdirSync(JDS_DIR, { recursive: true });
  const relPath = path.posix.join('jds', `linkedin-${slug(`${job.company}-${job.title}`)}.md`);
  const absPath = relPath.replace(/\//g, path.sep);
  const content = `# ${job.title}\n\n**Company:** ${job.company}\n**Location:** ${job.location || 'Unknown'}\n**Source:** LinkedIn alert / pasted job page\n\n---\n\n${clean(job.body)}\n`;
  fs.writeFileSync(absPath, content, 'utf8');
  return `local:${relPath}`;
}

function main() {
  const inputs = readInputs()
    .map((item) => ({ ...item, text: clean(item.text) }))
    .filter((item) => item.text);
  if (inputs.length === 0) {
    console.error('No input received.');
    process.exit(1);
  }

  const entries = [];
  for (const input of inputs) {
    const urls = linkedInUrls(input.text).map((url) => ({
      url,
      company: 'LinkedIn',
      title: 'LinkedIn job alert',
      location: '',
      source: input.source,
    }));

    const fullJob = parseFullJob(input.text);
    const localJobs = fullJob ? [fullJob] : parseAlertSummary(input.text);
    const localEntries = localJobs.map((job) => ({
      url: writeLocalJob(job),
      company: job.company,
      title: job.title,
      location: job.location,
      source: input.source,
    }));
    entries.push(...urls, ...localEntries);
  }

  const added = appendPipeline(entries);
  console.log(JSON.stringify({
    added,
    urls: entries.filter((entry) => /^https?:/.test(entry.url)).length,
    local_jobs: entries.filter((entry) => entry.url.startsWith('local:')).length,
    entries,
  }, null, 2));
}

main();
