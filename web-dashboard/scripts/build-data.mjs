import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { repairText } from "../../utils/text.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const appPath = path.join(root, "data", "applications.md");
const pipelinePath = path.join(root, "data", "pipeline.md");
const publicPath = path.join(import.meta.dirname, "..", "public");
const outPath = path.join(publicPath, "career-data.json");
const publicReportsPath = path.join(publicPath, "reports");
const packagesPath = path.join(root, "output", "application-packages");
const publicPackagesPath = path.join(publicPath, "application-packages");
const portalsPath = path.join(root, "portals.yml");
const scanHistoryPath = path.join(root, "data", "scan-history.tsv");

const reportLinkRe = /\[(\d+)\]\(([^)]+)\)/;
const scoreRe = /(\d+(?:\.\d+)?)\/5/;
const headerUrlRe = /^\*\*URL:\*\*\s*(.+)$/m;
const headerArchetypeRe = /^\*\*Archetype:\*\*\s*(.+)$/m;
const keywordsRe = /## Keywords extracted\s+([\s\S]+)$/m;

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((part) => part.trim());
}

function section(markdown, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`## ${escaped}\\s+([\\s\\S]*?)(?=\\n## |\\n---|$)`, "m");
  const match = markdown.match(re);
  return match ? match[1].trim() : "";
}

function firstParagraph(text) {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find(Boolean) || "";
}

function readReport(reportPath) {
  const full = path.join(root, reportPath);
  if (!fs.existsSync(full)) return {};
  const markdown = repairText(fs.readFileSync(full, "utf8"));
  const url = repairText(markdown.match(headerUrlRe)?.[1]?.trim() || "");
  const archetype = repairText(markdown.match(headerArchetypeRe)?.[1]?.trim() || "");
  const summary = firstParagraph(section(markdown, "A) Role Summary"));
  const strategy = firstParagraph(section(markdown, "C) Level and Strategy"));
  const legitimacy = section(markdown, "G) Posting Legitimacy");
  const keywords = (markdown.match(keywordsRe)?.[1] || "")
    .split(",")
    .map((keyword) => repairText(keyword.replace(/[-*]/g, "").trim()))
    .filter(Boolean)
    .slice(0, 12);
  return { url, archetype, summary, strategy, legitimacy, keywords, markdown };
}

function sourceFromUrl(url) {
  if (!url) return "Manual";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("linkedin")) return "LinkedIn";
    if (host.includes("thehub")) return "The Hub";
    if (host.includes("arbetsformedlingen")) return "Platsbanken";
    if (host.includes("hellofresh")) return "HelloFresh";
    if (host.includes("ashbyhq")) return "Ashby";
    return host;
  } catch {
    return "Manual";
  }
}

function parsePendingLine(line, index) {
  const raw = repairText(line.replace(/^- \[ \]\s*/, "").trim());
  const parts = raw.split("|").map((part) => repairText(part.trim())).filter(Boolean);
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
    source = source || sourceFromUrl(url);
  }

  return {
    id: `pending-${index + 1}`,
    company,
    role,
    location,
    source,
    url,
    status: "Discovered",
    notes: location || source,
    score: null,
  };
}

function isPlaceholderLead(job) {
  const role = repairText(job.role || "").trim().toLowerCase();
  const company = repairText(job.company || "").trim().toLowerCase();
  const url = repairText(job.url || "").trim().toLowerCase();
  if (/^\(?\s*(search|job board|company careers|national job database|recruitment agency|foreign ministry vacancies|english-language jobs|di job board|politics\/public sector board)/i.test(role)) return true;
  if (/scraper|paid|needs rental|token in \.env/i.test(role)) return true;
  if (/\/jobsoegning|searchstring=|jobs\?search=|find-job\?/.test(url) && /\b(jobindex|it-jobbank|workindenmark|the hub|jobnet|englishjobs|altinget|moment|udenrigsministeriet|dansk industri|novo nordisk|apify actor)\b/.test(company)) return true;
  return false;
}

const content = fs.existsSync(appPath) ? fs.readFileSync(appPath, "utf8") : "";
const rows = content
  .split(/\r?\n/)
  .filter((line) => line.trim().startsWith("|") && !line.includes("|---") && !line.includes("| # |"));

const applications = rows.map((line) => {
  const fields = splitRow(line);
  const reportMatch = fields[7]?.match(reportLinkRe);
  const reportPath = reportMatch?.[2] || "";
  const report = reportPath ? readReport(reportPath) : {};
  const score = Number(fields[4]?.match(scoreRe)?.[1] || 0);
  return {
    number: fields[0],
    date: fields[1],
    company: repairText(fields[2]),
    role: repairText(fields[3]),
    score,
    scoreRaw: repairText(fields[4]),
    status: repairText(fields[5]),
    hasPdf: /yes|✅/i.test(fields[6] || ""),
    reportNumber: reportMatch?.[1] || fields[0],
    reportPath,
    notes: repairText(fields[8] || ""),
    appliedDate: fields[8]?.match(/Applied (\d{4}-\d{2}-\d{2})/)?.[1] || "",
    ...report,
  };
});

const pipelineContent = fs.existsSync(pipelinePath) ? fs.readFileSync(pipelinePath, "utf8") : "";
const evaluatedUrls = new Set(applications.map((app) => app.url).filter(Boolean));
const discoveredAll = pipelineContent
  .split(/\r?\n/)
  .filter((line) => line.trim().startsWith("- [ ]"))
  .map(parsePendingLine)
  .filter((job) => !isPlaceholderLead(job));
const discovered = discoveredAll.filter((job) => !job.url || !evaluatedUrls.has(job.url));

function readPackages() {
  if (!fs.existsSync(packagesPath)) return [];
  fs.mkdirSync(publicPackagesPath, { recursive: true });
  return fs.readdirSync(packagesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folder = entry.name;
      const sourceDir = path.join(packagesPath, folder);
      const targetDir = path.join(publicPackagesPath, folder);
      fs.mkdirSync(targetDir, { recursive: true });
      const files = fs.readdirSync(sourceDir)
        .filter((name) => name.endsWith(".md"))
        .sort((a, b) => {
          const order = ["tailored-cv.md", "cover-letter.md", "linkedin-message.md", "application-answers.md", "package.md"];
          return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
        })
        .map((name) => {
          fs.copyFileSync(path.join(sourceDir, name), path.join(targetDir, name));
          return {
            name,
            href: `/application-packages/${folder}/${name}`,
            path: path.join(sourceDir, name),
          };
        });
      const packageText = fs.existsSync(path.join(sourceDir, "package.md"))
        ? fs.readFileSync(path.join(sourceDir, "package.md"), "utf8")
        : "";
      const title = packageText.match(/^# Application Package - (.+)$/m)?.[1] || folder;
      const number = folder.match(/^(\d+)/)?.[1] || "";
      const app = applications.find((item) => item.number === number);
      return {
        id: folder,
        number,
        title,
        company: app?.company || title.split(" - ")[0] || folder,
        role: app?.role || title.split(" - ").slice(1).join(" - ") || "",
        score: app?.score || 0,
        status: app?.status || "Package",
        files,
      };
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title));
}

function readSources() {
  const config = fs.existsSync(portalsPath) ? yaml.load(fs.readFileSync(portalsPath, "utf8")) || {} : {};
  const tracked = (config.tracked_companies || []).map((entry) => ({
    type: "tracked",
    name: repairText(entry.name || entry.careers_url || entry.provider || "Unnamed source"),
    provider: repairText(entry.provider || entry.scan_method || "auto"),
    enabled: entry.enabled !== false,
    url: entry.careers_url || "",
    queries: (entry.queries || []).map(repairText),
  }));
  const searches = (config.search_queries || []).map((entry) => ({
    type: "search",
    name: repairText(entry.name || entry.query || "Search query"),
    provider: "search",
    enabled: entry.enabled !== false,
    url: "",
    query: repairText(entry.query || ""),
  }));
  const existingSourceKeys = new Set(
    [...tracked, ...searches].map((source) => `${source.name.toLowerCase()}::${source.url || source.query || ""}`)
  );
  const existingSourceUrls = new Set([...tracked, ...searches].map((source) => source.url).filter(Boolean));
  const pipelineBoards = pipelineContent
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("- [ ]"))
    .map(parsePendingLine)
    .filter(isPlaceholderLead)
    .map((job) => ({
      type: "source-board",
      name: repairText(job.company || sourceFromUrl(job.url)),
      provider: "pipeline",
      enabled: true,
      url: job.url || "",
      query: repairText(job.role || ""),
    }))
    .filter((source) => {
      if (source.url && existingSourceUrls.has(source.url)) return false;
      const key = `${source.name.toLowerCase()}::${source.url || source.query || ""}`;
      if (existingSourceKeys.has(key)) return false;
      existingSourceKeys.add(key);
      if (source.url) existingSourceUrls.add(source.url);
      return true;
    });

  const historyRows = fs.existsSync(scanHistoryPath)
    ? fs.readFileSync(scanHistoryPath, "utf8").split(/\r?\n/).filter(Boolean).slice(1)
    : [];
  const bySource = new Map();
  for (const row of historyRows) {
    const parts = row.split("\t");
    const status = parts[5] || "added";
    const company = parts[2] || "Unknown";
    const key = company;
    const current = bySource.get(key) || { added: 0, duplicate: 0, other: 0 };
    if (status === "added") current.added += 1;
    else if (status === "duplicate") current.duplicate += 1;
    else current.other += 1;
    bySource.set(key, current);
  }

  return {
    tracked: [...tracked, ...pipelineBoards],
    searches,
    total: tracked.length + searches.length + pipelineBoards.length,
    enabled: [...tracked, ...searches, ...pipelineBoards].filter((source) => source.enabled).length,
    scanHistoryRows: historyRows.length,
    bySource: Object.fromEntries(bySource),
  };
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.rmSync(publicReportsPath, { recursive: true, force: true });
fs.rmSync(publicPackagesPath, { recursive: true, force: true });
fs.mkdirSync(publicReportsPath, { recursive: true });
for (const app of applications) {
  if (!app.reportPath) continue;
  const from = path.join(root, app.reportPath);
  const to = path.join(publicPath, app.reportPath);
  if (fs.existsSync(from)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
const packages = readPackages();
const sources = readSources();
const packagedNumbers = new Set(packages.map((pkg) => pkg.number).filter(Boolean));
const decoratedApplications = applications.map((app) => ({
  ...app,
  isPackaged: packagedNumbers.has(app.number),
}));
const pipelineApplications = decoratedApplications.filter((app) => !app.isPackaged);
const scores = decoratedApplications.map((app) => app.score).filter(Boolean);
const summary = {
  generatedAt: new Date().toISOString(),
  total: decoratedApplications.length,
  pipelineTotal: pipelineApplications.length,
  discoveredTotal: discovered.length,
  rawLeadTotal: discoveredAll.length,
  packageTotal: packages.length,
  averageScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
  topScore: scores.length ? Math.max(...scores) : 0,
  byStatus: decoratedApplications.reduce((acc, app) => {
    acc[app.status] = (acc[app.status] || 0) + 1;
    return acc;
  }, {}),
};
fs.writeFileSync(outPath, JSON.stringify({ summary, applications: decoratedApplications, discovered, packages, sources }, null, 2));
console.log(`Wrote ${applications.length} applications, ${discovered.length} discovered leads, and ${packages.length} packages to ${outPath}`);
