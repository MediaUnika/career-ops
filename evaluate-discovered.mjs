import fs from "node:fs";
import path from "node:path";
import { repairText } from "./utils/text.mjs";

const today = "2026-05-28";
const root = import.meta.dirname;
const pipelinePath = path.join(root, "data", "pipeline.md");
const applicationsPath = path.join(root, "data", "applications.md");
const reportsDir = path.join(root, "reports");

const cvProof = {
  project: "CV lines 14, 34, 42, 51: project leadership, planning, and senior project work.",
  change: "CV lines 10, 15, 173: change management, organizational development, Prosci certification.",
  business: "CV lines 16, 58-59, 89-91: business development, startup mentoring, digital business value.",
  customer: "CV lines 19, 24, 115-117, 124-125: stakeholder management, relationship marketing, customer advisory.",
  digital: "CV lines 10, 16, 42-44, 73-74: digital transformation and secure digital products.",
  operations: "CV lines 22, 106-108, 131, 146-147: operational excellence and service delivery.",
  board: "CV lines 165-169: board and advisory experience in fintech/startup ecosystems.",
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

function sourceFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("linkedin")) return "LinkedIn";
    if (host.includes("thehub")) return "The Hub";
    if (host.includes("arbetsformedlingen")) return "Platsbanken";
    if (host.includes("ashbyhq")) return "Ashby";
    if (host.includes("hellofresh")) return "HelloFresh";
    if (host.includes("jobleads")) return "JobLeads";
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

  if (/change|forandring|transformation|adoption|implementation/.test(text)) add(0.75, "change, adoption, or implementation focus");
  if (/project|projekt|pmo|program|programme|delivery/.test(text)) add(0.65, "project/program leadership focus");
  if (/business development|affärsutvecklare|forretningsudvikling|strategy|strategi|strategic|partnership|alliances/.test(text)) add(0.55, "business development or strategy focus");
  if (/customer success|client|customer|partner success|onboarding|account manager|relation/.test(text)) add(0.45, "customer-facing advisory or success angle");
  if (/digital|ai|cyber|saas|cloud|tech|software|dynamics|automation|data/.test(text)) add(0.35, "digital or technology context");
  if (/manager|senior|head|lead|advisor|consultant|konsult/.test(text)) add(0.35, "senior/advisory level signal");
  if (/malm|lund|helsingborg|landskrona|skåne|skane|copenhagen|københavn|capital region|denmark|nordic|sweden/.test(text)) add(0.25, "geography fits Malmö/Southern Sweden/Copenhagen target");

  if (/junior|student|graduate|intern|trainee/.test(text)) gap(0.7, "seniority may be too junior");
  if (/engineer|architect|developer|vvs|bygg|elkraft|network|incident response|threat detection|cloud architect/.test(text)) gap(0.55, "may require deeper specialist technical/engineering background");
  if (/account executive|sales specialist|business development representative/.test(text)) gap(0.35, "may be too quota-sales oriented");
  if (/construction|fastigheter|broingenjör|regionnät|kylindustri|vs\b/.test(text)) gap(0.35, "may be domain-specific outside Liza's core narrative");
  if (/maternity|parental leave|interim|contract|12 months/.test(text)) gap(0.15, "fixed-term/temporary signal to verify");

  score = Math.max(2.2, Math.min(4.8, score));
  return {
    score: Math.round(score * 10) / 10,
    strengths: [...new Set(strengths)].slice(0, 5),
    gaps: [...new Set(gaps)].slice(0, 4),
  };
}

function archetypeFor(job) {
  const text = `${job.company} ${job.role}`.toLowerCase();
  if (/change|forandring|transformation|adoption|implementation/.test(text)) return "Change Management / Transformation";
  if (/customer success|client|onboarding|account|partner success/.test(text)) return "Customer Success / Client Advisory";
  if (/strategy|strategi|business development|affärsutvecklare|partnership|alliances/.test(text)) return "Strategy / Business Development";
  if (/project|projekt|pmo|program|delivery/.test(text)) return "Project / Program Management";
  if (/cyber|ai|digital|saas|cloud|automation/.test(text)) return "Digital / Tech Transformation";
  return "General Management / Advisory";
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
  const strengths = result.strengths.length ? result.strengths : ["role title has partial overlap with Liza's target areas"];
  const gaps = result.gaps.length ? result.gaps : ["full JD still needed to verify requirements, scope, and seniority"];
  const proofRows = [];
  if (/project|program|pmo|projekt/i.test(job.role)) proofRows.push(["Project leadership", cvProof.project]);
  if (/change|forandring|transformation|adoption|implementation/i.test(job.role)) proofRows.push(["Change/transformation", cvProof.change]);
  if (/business|strategy|strategi|partnership|alliances|affär/i.test(job.role)) proofRows.push(["Business development/strategy", cvProof.business]);
  if (/customer|client|account|onboarding|success|partner/i.test(job.role)) proofRows.push(["Customer/stakeholder advisory", cvProof.customer]);
  if (/digital|ai|cyber|saas|cloud|automation|tech/i.test(`${job.role} ${job.company}`)) proofRows.push(["Digital/technology context", cvProof.digital]);
  if (!proofRows.length) proofRows.push(["General senior advisory fit", `${cvProof.project} ${cvProof.business}`]);

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

Position Liza as a senior project/change/business development profile who can connect stakeholders, structure delivery, and turn digital or organizational change into practical execution. If this role remains attractive after full JD review, tailor the CV around the strongest signal in the title.

## D) Comp and Demand

Not researched in this triage pass. Before applying, verify salary range, employment type, hybrid expectations, and whether Swedish, Danish, or English is required.

## E) Customization Plan

| # | Section | Proposed change | Why |
|---|---|---|---|
| 1 | Summary | Lead with ${archetype.toLowerCase()} | Matches the apparent role angle |
| 2 | Core competencies | Move the most relevant project/change/customer/business skill into the first three bullets | Recruiters scan quickly |
| 3 | Experience | Highlight Knowit, Ideon, Omegapoint, and Jayway depending on JD | These are the strongest current proof points |

## F) Interview Plan

- Sweden Secure Tech Hub: stakeholder coordination, national innovation ecosystem, cyber security/digitalization.
- Knowit Insight: Nordic consulting, client work, change-oriented project planning.
- Omegapoint/Jayway: digital transformation, business development, consultative sales, business value.
- Ideon Meeting/Meeting in Mind: operational excellence, facilitation, events, service delivery.

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

  const existingUrls = parseExistingUrls();
  const pipeline = fs.readFileSync(pipelinePath, "utf8");
  const jobs = pipeline
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("- [ ]"))
    .map(parsePendingLine);

  let nextNum = nextReportNumber();
  const additions = [];
  const created = [];

  for (const job of jobs) {
    if (job.url && existingUrls.has(job.url)) continue;

    const num = nextNum++;
    const result = scoreJob(job);
    const reportName = `${String(num).padStart(3, "0")}-${slug(job.company)}-${slug(job.role)}-${today}.md`;
    const reportPath = path.join("reports", reportName).replace(/\\/g, "/");
    fs.writeFileSync(path.join(root, reportPath), reportMarkdown(num, job, result), "utf8");

    const row = `| ${String(num).padStart(3, "0")} | ${today} | ${escapeCell(job.company)} | ${escapeCell(job.role)} | ${result.score.toFixed(1)}/5 | Evaluated | No | [${String(num).padStart(3, "0")}](${reportPath}) | ${escapeCell(noteFor(result.score, job, result))} |`;
    additions.push(row);
    created.push({ num, company: job.company, role: job.role, score: result.score });
    if (job.url) existingUrls.add(job.url);
  }

  if (additions.length) {
    fs.appendFileSync(applicationsPath, `${additions.join("\n")}\n`, "utf8");
  }

  console.log(JSON.stringify({
    pendingFound: jobs.length,
    alreadyEvaluated: jobs.length - created.length,
    created: created.length,
    firstCreated: created.slice(0, 5),
    lastCreated: created.slice(-5),
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  main();
}
