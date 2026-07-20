import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { repairText } from "../../utils/text.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const publicRoot = path.resolve(import.meta.dirname, "..", "public");
const today = new Date().toISOString().slice(0, 10);

function clean(text = "") {
  return repairText(String(text)).replace(/\s+/g, " ").trim();
}

function slug(text = "") {
  return clean(text)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 84)
    .replace(/^-|-$/g, "") || "application";
}

function parseTracker() {
  const file = path.join(root, "data", "applications.md");
  const content = fs.readFileSync(file, "utf8");
  return content
    .split(/\r?\n/)
    .filter((line) => /^\| \d{3} \|/.test(line))
    .map((line) => {
      const fields = line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((field) => field.trim());
      const report = fields[7]?.match(/\[(\d+)\]\(([^)]+)\)/);
      return {
        number: fields[0],
        date: fields[1],
        company: fields[2],
        role: fields[3],
        score: fields[4],
        status: fields[5],
        reportPath: report?.[2] || "",
        notes: fields[8] || "",
      };
    });
}

function reportValue(report, label) {
  return report.match(new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+)$`, "m"))?.[1]?.trim() || "";
}

function reportSection(report, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return report.match(new RegExp(`## ${escaped}\\s+([\\s\\S]*?)(?=\\n## |$)`, "m"))?.[1]?.trim() || "";
}

function markdownSection(markdown, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.match(new RegExp(`## ${escaped}\\s+([\\s\\S]*?)(?=\\n## |$)`, "m"))?.[1]?.trim() || "";
}

function markdownSectionsByPrefix(markdown, titlePrefix) {
  const sections = [];
  const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  for (let i = 0; i < headings.length; i += 1) {
    const heading = clean(headings[i][1]);
    if (!heading.toLowerCase().startsWith(titlePrefix.toLowerCase())) continue;
    const start = headings[i].index + headings[i][0].length;
    const end = headings[i + 1]?.index ?? markdown.length;
    sections.push(markdown.slice(start, end).trim());
  }
  return sections;
}

function experienceBlocksFrom(markdown) {
  const sections = markdownSectionsByPrefix(markdown, "Experience");
  const blocks = [];
  for (const section of sections) {
    const headings = [...section.matchAll(/^###\s+(.+)$/gm)];
    for (let i = 0; i < headings.length; i += 1) {
      const start = headings[i].index;
      const end = headings[i + 1]?.index ?? section.length;
      const block = section.slice(start, end).trim();
      if (block) blocks.push(block);
    }
  }
  return blocks;
}

function loadProfile() {
  const profilePath = path.join(root, "config", "profile.yml");
  if (!fs.existsSync(profilePath)) return {};
  return yaml.load(fs.readFileSync(profilePath, "utf8")) || {};
}

function loadCv() {
  const cvPath = path.join(root, "cv.md");
  return fs.existsSync(cvPath) ? repairText(fs.readFileSync(cvPath, "utf8")) : "";
}

function loadArticleDigest() {
  const digestPath = path.join(root, "article-digest.md");
  return fs.existsSync(digestPath) ? repairText(fs.readFileSync(digestPath, "utf8")) : "";
}

function proofPointsFromDigest(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|[^|]+\|[^|]+\|[^|]+\|/.test(line))
    .filter((line) => !/Proof point|---/.test(line))
    .map((line) => line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((part) => clean(part.replace(/\*\*/g, ""))))
    .filter((parts) => parts.length >= 3 && parts[0] && parts[1])
    .map(([proof, metric, useFor]) => ({ proof, metric, useFor }));
}

function candidateContext() {
  const profile = loadProfile();
  const cv = loadCv();
  const articleDigest = loadArticleDigest();
  const candidate = profile.candidate || {};
  const narrative = profile.narrative || {};
  const name = clean(candidate.full_name || cv.match(/^#\s+(.+)$/m)?.[1] || "Candidate");
  const headline = clean(narrative.headline || cv.match(/^#\s+.+\n+(.+)$/m)?.[1] || "Creative professional");
  const location = clean(candidate.location || "");
  const linkedin = clean(candidate.linkedin || "");
  const portfolio = clean(candidate.portfolio_url || profile.narrative?.portfolio?.schwarzcreative || "");
  const summary = clean(narrative.exit_story || markdownSection(cv, "Summary"));
  const superpowers = Array.isArray(narrative.superpowers) ? narrative.superpowers.map(clean).filter(Boolean) : [];
  const competencies = markdownSection(cv, "Core Competencies")
    .split(/\r?\n/)
    .map((line) => clean(line.replace(/^-\s*/, "")))
    .filter(Boolean);
  const education = markdownSection(cv, "Education");
  const languages = markdownSection(cv, "Languages");
  const experienceBlocks = experienceBlocksFrom(cv);
  const proofPoints = proofPointsFromDigest(articleDigest);

  return { name, headline, location, linkedin, portfolio, summary, superpowers, competencies, education, languages, experienceBlocks, proofPoints };
}

function keywordsFrom(report, app) {
  const raw = reportSection(report, "Keywords extracted")
    || [reportValue(report, "Archetype"), app.role, app.company].join(", ");
  return raw
    .split(/,|\n/)
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 10);
}

function emphasisFor(app, report) {
  const text = `${app.role} ${reportValue(report, "Archetype")} ${report}`.toLowerCase();
  const items = [];
  if (/creative|art director|brand|visual|design/.test(text)) items.push("creative direction and brand strategy");
  if (/film|video|director|screenwriter|narrative|production|editor|motion/.test(text)) items.push("film, video, and content production");
  if (/marketing|social|content|community|campaign|influencer/.test(text)) items.push("social content and brand marketing");
  if (/luxury|wine|spirits|caviar|hospitality|collectible|f&b|premium/.test(text)) items.push("luxury and lifestyle brand building");
  if (/product|ux|ui|platform|web|ecommerce|e-commerce|digital/.test(text)) items.push("product/UX and digital experience");
  return [...new Set(items)].slice(0, 4);
}

function relevantExperienceBlocks(ctx, emphasis) {
  const terms = [...emphasis, "creative", "brand", "luxury", "film", "content", "ux", "product", "marketing"]
    .join(" ")
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 3);
  const scored = ctx.experienceBlocks.map((block, index) => {
    const text = block.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
    return { block, index, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.block);
}

function conciseExperienceBlock(block, terms) {
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => line.startsWith("### ")) || lines[0] || "";
  const meta = lines.find((line) => /^\*.+\*$/.test(line)) || "";
  const intro = lines.find((line) => !line.startsWith("### ") && !line.startsWith("- ") && !/^\*.+\*$/.test(line)) || "";
  const bullets = lines
    .filter((line) => line.startsWith("- "))
    .map((line, index) => {
      const lower = line.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
      const metricBoost = /\d|%|us\$|award|winner|finalist|million|m\+|\+/.test(lower) ? 2 : 0;
      return { line, index, score: score + metricBoost };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.line);
  return [heading, meta, intro, ...bullets].filter(Boolean).join("\n");
}

function relevantProofPoints(ctx, terms) {
  return (ctx.proofPoints || [])
    .map((point, index) => {
      const text = `${point.proof} ${point.metric} ${point.useFor}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
      return { point, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5)
    .map(({ point }) => `- **${point.proof}:** ${point.metric}`);
}

function tailoredCv(app, report, keywords, emphasis, ctx) {
  const core = [...ctx.superpowers, ...ctx.competencies].filter(Boolean);
  const uniqueCore = [...new Set(core)].slice(0, 10);
  const terms = [...emphasis, ...keywords, "creative", "brand", "storytelling", "campaign", "concept", "leadership", "content", "social"]
    .join(" ")
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 3);
  const experience = relevantExperienceBlocks(ctx, emphasis)
    .map((block) => conciseExperienceBlock(block, terms));
  const proofPoints = relevantProofPoints(ctx, terms);

  return `# ${ctx.name}

${ctx.headline}

${[ctx.location, ctx.linkedin ? `LinkedIn: ${ctx.linkedin}` : "", ctx.portfolio ? `Portfolio: ${ctx.portfolio}` : ""].filter(Boolean).join("  \n")}

## Target Role

${app.company} - ${app.role}

## Tailored Summary

${ctx.summary || `Award-winning creative leader with role-relevant strengths across ${emphasis.join(", ") || "creative direction, brand strategy, and content production"}.`} For this application, the strongest fit signals are ${emphasis.join(", ") || keywords.slice(0, 4).join(", ") || "the role requirements and target profile"}.

## Role-Matched Keywords

${keywords.map((keyword) => `- ${keyword}`).join("\n")}

${proofPoints.length ? `## Selected Proof Points For This Role\n\n${proofPoints.join("\n")}\n` : ""}
## Core Competencies For This Role

${uniqueCore.map((item) => `- ${item}`).join("\n") || "- Creative direction\n- Brand strategy\n- Content production"}

## Most Relevant Experience

${experience.join("\n\n") || "Add relevant CV experience here after reviewing the full JD."}

## Education

${ctx.education || "See canonical CV for education."}

## Languages

${ctx.languages || "See canonical CV for languages."}
`;
}

function coverLetter(app, report, keywords, emphasis, ctx) {
  const archetype = reportValue(report, "Archetype") || "the role";
  return `# Cover Letter - ${app.company} - ${app.role}

Dear hiring team,

I am applying for the ${app.role} role at ${app.company}. It stands out because it connects closely with the work I have done across ${emphasis.join(", ") || "creative direction, brand strategy, and content production"}.

${ctx.summary || "My background spans creative direction, brand strategy, product/UX, content production, and film."}

What I would bring to ${app.company} is a full-stack creative leader who turns heritage and complex stories into high-luxury visual language, and who can take an idea from strategy to finished, polished delivery.

For this role, I would emphasize my experience with ${keywords.slice(0, 5).join(", ")}, plus AI-augmented creative production.

I would welcome the opportunity to discuss how my experience can support ${app.company}'s priorities for ${archetype.toLowerCase()}.

Kind regards,
${ctx.name}
`;
}

function linkedinMessage(app, ctx) {
  return `Hi,

I saw the ${app.role} role at ${app.company} and wanted to reach out. My background combines ${ctx.superpowers.slice(0, 3).join(", ") || ctx.headline}.

The role looks close to the kind of creative work I am targeting. Happy to share a tailored CV${ctx.portfolio ? ` and portfolio (${ctx.portfolio})` : ""} if useful.

Best,
${ctx.name}
`;
}

function applicationAnswers(app, report, ctx, emphasis) {
  return `# Application Answers - ${app.company} - ${app.role}

## Why are you interested in this role?

This role connects strongly with my background in ${emphasis.join(", ") || ctx.headline}. I am especially drawn to work where I can turn a brand's heritage and story into a distinctive visual language and experience.

## What makes you a strong fit?

${ctx.summary || "I bring senior creative experience across brand, content, product/UX, and film, with measurable commercial impact."}

## What would you bring in the first months?

I would start by understanding the brand, audience, and goals, then establish a clear creative direction and the systems to deliver it consistently across every touchpoint.

## Notes from report

${reportSection(report, "C) Level and Strategy") || app.notes}
`;
}

export async function generatePackage(number) {
  const normalized = String(number || "").padStart(3, "0");
  const app = parseTracker().find((item) => item.number === normalized);
  if (!app) throw new Error(`No application found for #${normalized}`);
  if (!app.reportPath) throw new Error(`Application #${normalized} has no report path`);

  const reportAbs = path.join(root, app.reportPath);
  if (!fs.existsSync(reportAbs)) throw new Error(`Report not found: ${app.reportPath}`);
  const report = fs.readFileSync(reportAbs, "utf8");
  const keywords = keywordsFrom(report, app);
  const emphasis = emphasisFor(app, report);
  const ctx = candidateContext();
  const folderName = `${app.number}-${slug(app.company)}-${slug(app.role)}`;
  const outDir = path.join(root, "output", "application-packages", folderName);
  const publicDir = path.join(publicRoot, "application-packages", folderName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  const files = [
    ["tailored-cv.md", tailoredCv(app, report, keywords, emphasis, ctx)],
    ["cover-letter.md", coverLetter(app, report, keywords, emphasis, ctx)],
    ["linkedin-message.md", linkedinMessage(app, ctx)],
    ["application-answers.md", applicationAnswers(app, report, ctx, emphasis)],
  ];

  const index = `# Application Package - ${app.company} - ${app.role}

Generated: ${today}

## Files

- [Tailored CV](tailored-cv.md)
- [Cover letter](cover-letter.md)
- [LinkedIn message](linkedin-message.md)
- [Application answers](application-answers.md)

## Source

- Report: ${app.reportPath}
- Score: ${app.score}
- Status: ${app.status}
`;
  files.push(["package.md", index]);

  for (const [name, content] of files) {
    fs.writeFileSync(path.join(outDir, name), content, "utf8");
    fs.writeFileSync(path.join(publicDir, name), content, "utf8");
  }

  return {
    number: app.number,
    company: app.company,
    role: app.role,
    outputDir: outDir,
    publicBase: `/application-packages/${folderName}`,
    files: files.map(([name]) => ({
      name,
      href: `/application-packages/${folderName}/${name}`,
      path: path.join(outDir, name),
    })),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await generatePackage(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
}
