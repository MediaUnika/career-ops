import fs from "node:fs";
import path from "node:path";
import { repairText } from "./utils/text.mjs";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const today = new Date().toISOString().slice(0, 10);
const root = import.meta.dirname;
const pipelinePath = path.join(root, "data", "pipeline.md");
const applicationsPath = path.join(root, "data", "applications.md");
const reportsDir = path.join(root, "reports");
const additionsDir = path.join(root, "batch", "tracker-additions");

const cvProof = {
  creative: "cv.md: 20+ yrs creative & art direction; brand systems and visual identity for luxury and lifestyle brands.",
  brand: "cv.md: GASTROunika rebrand grew the caviar brand 338% to category leader in 8 countries.",
  luxury: "cv.md: Acker Asia - built the creative engine for the world's #1 wine auction house (US$100M+ annual sales).",
  content: "cv.md: 80+ catalogues and 10,000+ images published; leading wine photographer; Louis Roederer Awards finalist (2013).",
  film: "cv.md: Director/Producer - Viking Blood (6M+ viewers), award-winning Stories Forlorn, Beast Stalker (2025, in post).",
  product: "cv.md: UX/UI & e-commerce - FestiVote platform, Acker online auction system, Southern Glazer's QR tracking (+50% efficiency).",
  marketing: "cv.md: social content & community (Instagram/TikTok), collectibles/IP, drops & scarcity, China->Europe market adaptation.",
};

function clean(text = "") {
  return repairText(text).replace(/\s+/g, " ").trim();
}

function slug(text) {
  return clean(text)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 72)
    .replace(/^-|-$/g, "") || "role";
}

function escapeCell(text = "") {
  return clean(String(text)).replace(/\|/g, "/");
}

function escapeTsv(text = "") {
  return clean(String(text)).replace(/[\t\r\n]/g, " ");
}

function sourceFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("linkedin")) return "LinkedIn";
    if (host.includes("thehub")) return "The Hub";
    if (host.includes("arbetsformedlingen")) return "Platsbanken";
    if (host.includes("ashbyhq")) return "Ashby";
    if (host.includes("greenhouse")) return "Greenhouse";
    if (host.includes("jobindex")) return "Jobindex";
    return host;
  } catch {
    return "Manual";
  }
}

function parsePendingLine(line, index) {
  const raw = line.replace(/^- \[ \]\s*/, "").trim();
  const parts = raw.split("|").map((part) => clean(part)).filter(Boolean);
  let url = "";
  let company = "";
  let role = "";
  let location = "";
  let source = "";

  if (/^https?:\/\//i.test(parts[0] || "")) {
    url = parts[0];
    company = parts[1] || sourceFromUrl(url);
    role = parts[2] || "Untitled role";
    location = parts[3] || "";
    source = sourceFromUrl(url);
  } else {
    company = parts[0] || "Unknown company";
    role = parts[1] || "Untitled role";
    location = parts[2] || "";
    source = parts[3] || "";
    url = parts.find((part) => /^https?:\/\//i.test(part)) || "";
    source ||= sourceFromUrl(url);
  }

  return { index, raw, url, company, role, location, source };
}

function parseExistingUrls() {
  const apps = fs.existsSync(applicationsPath) ? fs.readFileSync(applicationsPath, "utf8") : "";
  const urls = new Set();
  for (const match of apps.matchAll(/\((reports\/[^)]+)\)/g)) {
    const reportPath = path.join(root, match[1]);
    if (!fs.existsSync(reportPath)) continue;
    const report = fs.readFileSync(reportPath, "utf8");
    const url = report.match(/^\*\*URL:\*\*\s*(.+)$/m)?.[1]?.trim();
    if (url) urls.add(url);
  }
  return urls;
}

function normalizeKey(text = "") {
  return clean(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseExistingApplications() {
  const apps = fs.existsSync(applicationsPath) ? fs.readFileSync(applicationsPath, "utf8") : "";
  return apps
    .split(/\r?\n/)
    .filter((line) => /^\|\s*\d+/.test(line))
    .map((line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((field) => clean(field)))
    .filter((fields) => fields.length >= 4)
    .map((fields) => ({
      company: fields[2],
      role: fields[3],
      key: `${normalizeKey(fields[2])}::${normalizeKey(fields[3])}`,
    }));
}

function nextReportNumber() {
  const nums = fs.readdirSync(reportsDir)
    .map((name) => Number(name.match(/^(\d+)/)?.[1] || 0))
    .filter(Boolean);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function scoreJob(job) {
  const text = `${job.company} ${job.role} ${job.location} ${job.source}`.toLowerCase();
  let score = 2.8;
  const strengths = [];
  const gaps = [];

  const add = (amount, label) => {
    score += amount;
    strengths.push(label);
  };
  const gap = (amount, label) => {
    score -= amount;
    gaps.push(label);
  };

  // Positive signals — Uri's creative / brand / film / marketing world
  if (/creative|art director|brand|visual|identity|design/.test(text)) add(0.75, "creative direction / brand & visual focus");
  if (/film|video|director|screenwriter|narrative|producer|editor|motion|cinematic/.test(text)) add(0.6, "film / video / content production focus");
  if (/luxury|wine|spirits|caviar|hospitality|collectible|f&b|premium|fashion|beauty|lifestyle/.test(text)) add(0.55, "luxury / lifestyle brand domain fit");
  if (/marketing|social|community|campaign|influencer|content/.test(text)) add(0.45, "marketing / social / community angle");
  if (/product|ux|ui|web|ecommerce|e-commerce|platform|digital/.test(text)) add(0.35, "product/UX / digital experience context");
  if (/director|head|lead|principal|senior|chief|consultant/.test(text)) add(0.35, "senior / leadership level signal");
  if (/copenhagen|københavn|denmark|danmark|las vegas|nevada|new york|london|remote/.test(text)) add(0.25, "geography fits Copenhagen/Las Vegas/New York/London/remote target");

  // Gap signals — outside Uri's creative focus
  if (/junior|student|graduate|intern|trainee|assistant/.test(text)) gap(0.7, "seniority may be too junior");
  if (/engineer|developer|software|backend|frontend|data scientist|machine learning|devops|architect/.test(text)) gap(0.6, "engineering role outside Uri's creative focus");
  if (/account executive|sales representative|\bsdr\b|\bbdr\b|quota/.test(text)) gap(0.35, "may be too quota-sales oriented");
  if (/accountant|bookkeeper|finance manager|controller|payroll|recruiter/.test(text)) gap(0.4, "back-office function outside creative focus");
  if (/maternity|parental leave|interim|temporary|vikar/.test(text)) gap(0.15, "fixed-term/temporary signal to verify");

  score = Math.max(2.2, Math.min(4.8, score));
  return {
    score: Math.round(score * 10) / 10,
    strengths: [...new Set(strengths)].slice(0, 5),
    gaps: [...new Set(gaps)].slice(0, 4),
  };
}

function archetypeFor(job) {
  const text = `${job.company} ${job.role}`.toLowerCase();
  if (/film|screenwriter|narrative|producer|cinematic|game studio/.test(text) || /\bdirector\b/.test(text) && /film|tv|video|story/.test(text)) return "Film / TV Director & Screenwriter";
  if (/marketing|social|community|campaign|influencer/.test(text)) return "Marketing / Social & Community";
  if (/product|\bux\b|\bui\b|ecommerce|e-commerce|platform/.test(text)) return "Product / UX Design";
  if (/art director|brand|visual|identity|graphic|motion/.test(text)) return "Brand & Visual / Art Direction";
  if (/creative/.test(text)) return "Creative Director";
  return "Creative Director / Brand";
}

function noteFor(score, job, result) {
  if (score >= 4.5) return "Triage: top match; prioritize for full JD review and tailored application";
  if (score >= 4.0) return "Triage: strong match; worth full JD review";
  if (score >= 3.5) return "Triage: possible match; review if time or company is attractive";
  if (result.gaps.length) return `Triage: lower priority; ${result.gaps[0]}`;
  return "Triage: lower priority based on title metadata";
}

function reportMarkdown(num, job, result) {
  const archetype = archetypeFor(job);
  const strengths = result.strengths.length ? result.strengths : ["role title has partial overlap with Uri's target areas"];
  const gaps = result.gaps.length ? result.gaps : ["full JD still needed to verify requirements, scope, and seniority"];
  const proofRows = [];
  const roleText = `${job.role} ${job.company}`;
  if (/creative|art director|brand|visual|identity|design/i.test(roleText)) proofRows.push(["Creative direction / brand", cvProof.creative]);
  if (/luxury|wine|spirits|caviar|hospitality|collectible|f&b|premium|fashion|beauty/i.test(roleText)) proofRows.push(["Luxury / lifestyle domain", cvProof.luxury]);
  if (/film|video|director|screenwriter|narrative|producer|editor|motion/i.test(roleText)) proofRows.push(["Film / video production", cvProof.film]);
  if (/marketing|social|community|content|campaign|influencer/i.test(roleText)) proofRows.push(["Marketing / social / content", cvProof.marketing]);
  if (/product|ux|ui|web|ecommerce|e-commerce|platform/i.test(roleText)) proofRows.push(["Product / UX", cvProof.product]);
  if (!proofRows.length) proofRows.push(["General creative leadership fit", `${cvProof.creative} ${cvProof.brand}`]);

  return `# Evaluation: ${job.company} - ${job.role}

**Date:** ${today}
**URL:** ${job.url || "Not available"}
**Archetype:** ${archetype}
**Score:** ${result.score}/5
**Legitimacy:** Proceed with Caution
**PDF:** pending

---

## A) Role Summary

Triage evaluation based on pipeline metadata only: company, title, source, and location. This is enough to rank the lead, but not enough for a final application package. Full JD extraction should be done before applying.

| Field | Value |
|---|---|
| Company | ${job.company} |
| Role | ${job.role} |
| Source | ${job.source || "Unknown"} |
| Location | ${job.location || "Not captured"} |
| Triage score | ${result.score}/5 |

## B) Match with CV

| Signal | CV proof |
|---|---|
${proofRows.map(([signal, proof]) => `| ${signal} | ${proof} |`).join("\n")}

## C) Level and Strategy

Position Uri as a senior creative director / brand and content leader who turns heritage and complex stories into category-defining luxury brands and owns creative delivery end-to-end (brand, packaging, product/UX, photography, film). If this role remains attractive after full JD review, tailor the CV around the strongest signal in the title.

## D) Comp and Demand

Not researched in this triage pass. Before applying, verify the budget/day-rate, employment type (perm vs contract), hybrid/remote expectations, and whether Danish or English is required.

## E) Customization Plan

| # | Section | Proposed change | Why |
|---|---|---|---|
| 1 | Summary | Lead with ${archetype.toLowerCase()} framing | Matches the apparent role angle |
| 2 | Core competencies | Move the most relevant creative / brand / film / marketing skill into the first three tags | Recruiters scan quickly |
| 3 | Experience | Highlight MEDIAunika, Acker, GASTROunika, FestiVote, or the film work depending on the JD | These are the strongest proof points |

## F) Interview Plan

- GASTROunika: luxury caviar rebrand, 338% growth, end-to-end brand and packaging systems.
- Acker Asia: built the creative engine for the world's #1 wine auction house (US$100M+); 10,000+ images, auction-platform UX.
- Viking Blood / Stories Forlorn: award-winning film direction and full production ownership; storytelling under constraints.
- FestiVote / Southern Glazer's: product/UX delivery - phygital festival platform and a QR warehouse system (+50% efficiency).

## G) Posting Legitimacy

Assessment: Proceed with Caution. The role came from ${job.source || "the pipeline"}, but this report did not fetch the live posting. Confirm the apply button is active and the JD is specific before spending time on custom materials.

## Triage Signals

### Strengths
${strengths.map((item) => `- ${item}`).join("\n")}

### Gaps / checks
${gaps.map((item) => `- ${item}`).join("\n")}

## Keywords extracted

${[archetype, ...strengths, job.source, job.location].filter(Boolean).join(", ")}
`;
}

export function main() {
  if (!fs.existsSync(pipelinePath)) throw new Error(`Missing ${pipelinePath}`);
  if (!fs.existsSync(applicationsPath)) throw new Error(`Missing ${applicationsPath}`);
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(additionsDir, { recursive: true });

  const existingUrls = parseExistingUrls();
  const existingKeys = new Set(parseExistingApplications().map((entry) => entry.key));
  const pipeline = fs.readFileSync(pipelinePath, "utf8");
  const jobs = pipeline
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("- [ ]"))
    .map(parsePendingLine);

  let nextNum = nextReportNumber();
  const additions = [];
  const created = [];
  const skippedDuplicates = [];

  for (const job of jobs) {
    const key = `${normalizeKey(job.company)}::${normalizeKey(job.role)}`;
    if ((job.url && existingUrls.has(job.url)) || existingKeys.has(key)) {
      skippedDuplicates.push({ company: job.company, role: job.role, url: job.url });
      continue;
    }

    const num = nextNum++;
    const result = scoreJob(job);
    const padded = String(num).padStart(3, "0");
    const reportName = `${padded}-${slug(job.company)}-${slug(job.role)}-${today}.md`;
    const reportPath = path.join("reports", reportName).replace(/\\/g, "/");
    fs.writeFileSync(path.join(root, reportPath), reportMarkdown(num, job, result), "utf8");

    const row = [
      padded,
      today,
      escapeTsv(job.company),
      escapeTsv(job.role),
      "Evaluated",
      `${result.score.toFixed(1)}/5`,
      "No",
      `[${padded}](${reportPath})`,
      escapeTsv(noteFor(result.score, job, result)),
    ].join("\t");
    const tsvPath = path.join(additionsDir, `${padded}-${slug(job.company)}.tsv`);
    fs.writeFileSync(tsvPath, `${row}\n`, "utf8");
    additions.push(tsvPath);
    created.push({ num, company: job.company, role: job.role, score: result.score });
    if (job.url) existingUrls.add(job.url);
    existingKeys.add(key);
  }

  if (additions.length) {
    execFileSync("node", [path.join(root, "merge-tracker.mjs")], { cwd: root, stdio: "pipe" });
  }

  console.log(JSON.stringify({
    pendingFound: jobs.length,
    alreadyEvaluated: skippedDuplicates.length,
    created: created.length,
    firstCreated: created.slice(0, 5),
    lastCreated: created.slice(-5),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
