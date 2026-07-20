#!/usr/bin/env node
/**
 * render-documents.mjs — turns tailored CV / cover-letter content into the
 * designed PDFs (templates/cv-template.html, templates/cover-letter-template.html).
 *
 * The dashboard's package generator produces markdown for quick review/editing;
 * this renders the same content through the real templates so the files that
 * actually get sent to an employer are the designed documents, not raw .md.
 *
 * Exported for use by web-dashboard/scripts/generate-package.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Renders inline markdown emphasis that survives into bullet/section text.
// Bold runs first so **x** isn't consumed by the single-asterisk italic rule.
function inlineMarkdown(text = '') {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function fill(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value ?? '');
  }
  return out;
}

/**
 * Parses one `### Company — Role` experience block from cv.md into the
 * structure the CV template expects.
 *
 * cv.md convention: "### {Company} — {Role}" then "*{dates} · {location}*"
 * then optional intro prose, then "- " bullets.
 */
function parseExperienceBlock(block) {
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headingLine = (lines.find((l) => l.startsWith('### ')) || '').replace(/^###\s+/, '');
  const metaLine = (lines.find((l) => /^\*[^*].*\*$/.test(l)) || '').replace(/^\*|\*$/g, '');
  const bullets = lines.filter((l) => l.startsWith('- ')).map((l) => l.replace(/^-\s*/, ''));

  const [company, ...roleParts] = headingLine.split(/\s+[—–-]\s+/);
  const role = roleParts.join(' - ');
  const [period, ...locParts] = metaLine.split(/\s*·\s*/);

  return {
    company: company || headingLine,
    role,
    period: period || '',
    location: locParts.join(' · '),
    bullets,
  };
}

function experienceHtml(blocks) {
  return blocks.map((raw) => {
    const job = parseExperienceBlock(raw);
    const bullets = job.bullets.length
      ? `<ul>${job.bullets.map((b) => `<li>${inlineMarkdown(b)}</li>`).join('')}</ul>`
      : '';
    return `  <div class="job avoid-break">
    <div class="job-header">
      <span class="job-company">${escapeHtml(job.company)}</span>
      <span class="job-period">${escapeHtml(job.period)}</span>
    </div>
    ${job.role ? `<div class="job-role">${escapeHtml(job.role)}</div>` : ''}
    ${job.location ? `<div class="job-location">${escapeHtml(job.location)}</div>` : ''}
    ${bullets}
  </div>`;
  }).join('\n');
}

function listToHtml(text, className) {
  const items = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  if (items.length === 0) return '';
  return items.map((item) => `  <div class="${className}">${inlineMarkdown(item)}</div>`).join('\n');
}

function educationHtml(text) {
  const items = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  return items.map((item) => {
    // cv.md convention: "**{Degree/School}**, {place} — {detail} · {years}"
    const yearMatch = item.match(/·\s*([\d]{4}(?:\s*[–-]\s*\d{4})?)\s*$/);
    const year = yearMatch ? yearMatch[1] : '';
    const body = yearMatch ? item.slice(0, yearMatch.index).trim() : item;
    return `  <div class="edu-item avoid-break">
    <div class="edu-header">
      <span class="edu-title">${inlineMarkdown(body)}</span>
      <span class="edu-year">${escapeHtml(year)}</span>
    </div>
  </div>`;
  }).join('\n');
}

function paragraphsHtml(paragraphs) {
  return paragraphs
    .filter(Boolean)
    .map((p, i) => `    <p${i === 0 ? ' class="lede"' : ''}>${inlineMarkdown(p)}</p>`)
    .join('\n');
}

function longDate(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * US/Canada roles get Letter, everything else A4 (matches modes/pdf.md).
 */
function paperFormatFor(location = '') {
  return /\b(usa|u\.s\.|united states|canada|new york|los angeles|san francisco|remote, us)\b/i.test(location)
    ? 'letter'
    : 'a4';
}

function runPdf(htmlPath, pdfPath, format) {
  execFileSync(process.execPath, [path.join(root, 'generate-pdf.mjs'), htmlPath, pdfPath, `--format=${format}`], {
    cwd: root,
    stdio: 'pipe',
  });
}

/**
 * @param {object} opts
 * @param {object} opts.app      Tracker row: { company, role, number }
 * @param {object} opts.ctx      candidateContext() output from generate-package.mjs
 * @param {string[]} opts.competencies
 * @param {string[]} opts.experienceBlocks  Raw "### ..." markdown blocks, already tailored/ordered
 * @param {string} opts.summaryText
 * @param {string} opts.kicker
 * @param {string[]} opts.coverParagraphs
 * @param {string} opts.outDir
 * @returns {{name: string, path: string}[]}
 */
export function renderDocuments({ app, ctx, competencies, experienceBlocks, summaryText, kicker, coverParagraphs, outDir }) {
  const cvTemplate = fs.readFileSync(path.join(root, 'templates', 'cv-template.html'), 'utf8');
  const clTemplate = fs.readFileSync(path.join(root, 'templates', 'cover-letter-template.html'), 'utf8');

  const format = paperFormatFor(`${app.location || ''} ${app.role || ''} ${app.company || ''}`);
  const pageWidth = format === 'letter' ? '8.5in' : '210mm';
  const linkedinDisplay = (ctx.linkedin || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const portfolioDisplay = (ctx.portfolio || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

  const shared = {
    LANG: 'en',
    PAGE_WIDTH: pageWidth,
    KICKER: escapeHtml(kicker),
    NAME: escapeHtml(ctx.name),
    EMAIL: escapeHtml(ctx.email || ''),
    LINKEDIN_URL: escapeHtml(ctx.linkedin || ''),
    LINKEDIN_DISPLAY: escapeHtml(linkedinDisplay),
    PORTFOLIO_URL: escapeHtml(ctx.portfolio || ''),
    PORTFOLIO_DISPLAY: escapeHtml(portfolioDisplay),
    LOCATION: escapeHtml(ctx.location || ''),
  };

  const cvHtml = fill(cvTemplate, {
    ...shared,
    PHONE: escapeHtml(ctx.phone || ''),
    SECTION_SUMMARY: 'Professional Summary',
    SUMMARY_TEXT: inlineMarkdown(summaryText),
    SECTION_COMPETENCIES: 'Core Competencies',
    COMPETENCIES: competencies.map((c) => `<span class="competency-tag">${escapeHtml(c)}</span>`).join('\n      '),
    SECTION_EXPERIENCE: 'Work Experience',
    EXPERIENCE: experienceHtml(experienceBlocks),
    SECTION_PROJECTS: 'Selected Work',
    PROJECTS: listToHtml(ctx.projectsText || '', 'project-desc'),
    SECTION_EDUCATION: 'Education',
    EDUCATION: educationHtml(ctx.education),
    SECTION_CERTIFICATIONS: 'Recognition',
    CERTIFICATIONS: listToHtml(ctx.recognitionText || '', 'cert-title'),
    SECTION_SKILLS: 'Languages & Skills',
    SKILLS: `<div class="skills-grid"><span class="skill-item">${inlineMarkdown(String(ctx.languages || '').replace(/\n/g, ' '))}</span></div>`,
  });

  const clHtml = fill(clTemplate, {
    ...shared,
    COMPANY: escapeHtml(app.company),
    ROLE_TITLE: `Re: ${escapeHtml(app.role)}`,
    DATE: longDate(),
    HIRING_CONTACT: 'Hiring Team,<br>',
    SALUTATION: `Dear ${escapeHtml(app.company)} team,`,
    BODY_PARAGRAPHS: paragraphsHtml(coverParagraphs),
    CLOSING_LINE: 'Best regards,',
    SIGNOFF_TITLE: escapeHtml(ctx.headline || ''),
  });

  const cvHtmlPath = path.join(outDir, 'tailored-cv.html');
  const clHtmlPath = path.join(outDir, 'cover-letter.html');
  fs.writeFileSync(cvHtmlPath, cvHtml, 'utf8');
  fs.writeFileSync(clHtmlPath, clHtml, 'utf8');

  const cvPdfPath = path.join(outDir, 'tailored-cv.pdf');
  const clPdfPath = path.join(outDir, 'cover-letter.pdf');
  runPdf(cvHtmlPath, cvPdfPath, format);
  runPdf(clHtmlPath, clPdfPath, format);

  return [
    { name: 'tailored-cv.pdf', path: cvPdfPath },
    { name: 'cover-letter.pdf', path: clPdfPath },
  ];
}
