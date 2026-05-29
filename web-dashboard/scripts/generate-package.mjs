import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const publicRoot = path.resolve(import.meta.dirname, "..", "public");
const today = "2026-05-28";

function clean(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
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
  if (/change|forandring|transformation|adoption/.test(text)) items.push("change management and adoption");
  if (/project|program|pmo|delivery|projekt/.test(text)) items.push("structured project and program delivery");
  if (/customer|client|success|onboarding|partner/.test(text)) items.push("customer-facing advisory and stakeholder alignment");
  if (/business|strategy|strategi|partnership|alliances/.test(text)) items.push("business development and strategy-to-execution");
  if (/digital|ai|cyber|saas|cloud|automation|tech/.test(text)) items.push("digital transformation and technology-enabled business value");
  return [...new Set(items)].slice(0, 4);
}

function tailoredCv(app, report, keywords, emphasis) {
  return `# Liza Johansson

Project Leadership | Change Management | Digital Transformation

Greater Malmo Metropolitan Area  
LinkedIn: https://www.linkedin.com/in/lizajohansson/

## Target Role

${app.company} - ${app.role}

## Tailored Summary

Management consultant and senior project leader with experience across ${emphasis.join(", ") || "project leadership, change, and business development"}. Experienced in helping organizations move from idea to execution across digitalization, cyber security innovation, startup ecosystems, stakeholder-heavy projects, and customer-facing advisory work.

## Role-Matched Keywords

${keywords.map((keyword) => `- ${keyword}`).join("\n")}

## Core Competencies For This Role

- Project leadership and project planning
- Change management and organizational development
- Business development and digital transformation
- Stakeholder management and communication
- Customer-facing advisory and consultative sales
- Operational excellence and process improvement
- Innovation ecosystems, startups, and scaleups
- Training, enablement, and facilitation

## Most Relevant Experience

### Knowit Insight | Management Consultant

- Supported Nordic customers through structured consulting methods, project planning, communication, and change-oriented client work.
- Brought cross-functional stakeholders together around practical delivery, business value, and execution.

### Ideon Science Park | Project Manager, Sweden Secure Tech Hub - Sweden ICT

- Project manager for a national cyber security innovation hub and European Digital Innovation Hub.
- Helped SMEs create safer digital products and solutions from the design and development phase.
- Worked in a consortium representing more than 2,400 companies and 59,000 employees.

### Omegapoint | Agile Project Manager / Business Developer

- Worked with agile project management and business development in a technology consultancy focused on secure IT systems and digital transformation.
- Helped customers identify new business opportunities, streamline processes, manage requirements, and become faster and more sustainable in a digital world.

### Jayway by Devoteam | Business and Operations Developer

- Connected digitalization and new applications to concrete business value for customers.
- Contributed to new processes and formats for lead generation, relationship marketing, and consultative sales.

## Education and Certifications

- Prosci Certified Change Practitioner
- EFL Executive Education, Business Development Program, 2024
- Wenell Projektledning, Practical Project Management, 2010

## Languages

- Swedish: Native or bilingual
- English: Full professional
- French: Limited working
`;
}

function coverLetter(app, report, keywords, emphasis) {
  const archetype = reportValue(report, "Archetype") || "the role";
  return `# Cover Letter - ${app.company} - ${app.role}

Dear hiring team,

I am applying for the ${app.role} role at ${app.company}. The role stands out because it connects closely with the work I have done across ${emphasis.join(", ") || "project leadership, change management, and digital transformation"}.

In my recent work as a management consultant at Knowit Insight and as Project Manager for Sweden Secure Tech Hub at Ideon Science Park, I have worked in stakeholder-heavy environments where structure, communication, and execution matter. Sweden Secure Tech Hub gave me the opportunity to help small and medium-sized technology companies create safer digital products within a national innovation ecosystem designated as a European Digital Innovation Hub.

What I would bring to ${app.company} is a practical combination of project leadership, change capability, business development, and customer-facing communication. I am comfortable turning broad goals into plans, aligning people around next steps, and keeping delivery connected to business value.

For this role, I would emphasize my experience with ${keywords.slice(0, 5).join(", ")}. I would also bring a Prosci-certified change perspective and a background in Nordic consulting, innovation ecosystems, and digital transformation.

I would welcome the opportunity to discuss how my experience can support ${app.company}'s priorities for ${archetype.toLowerCase()}.

Kind regards,  
Liza Johansson
`;
}

function linkedinMessage(app) {
  return `Hi,

I saw the ${app.role} role at ${app.company} and wanted to reach out. My background combines management consulting, senior project leadership, change management, digital transformation, and stakeholder-heavy innovation work in the Nordic tech ecosystem.

The role looks close to the kind of work I have done with Knowit Insight, Ideon Science Park, Sweden Secure Tech Hub, and Omegapoint. Happy to share a tailored CV if useful.

Best,  
Liza Johansson
`;
}

function applicationAnswers(app, report) {
  return `# Application Answers - ${app.company} - ${app.role}

## Why are you interested in this role?

This role connects strongly with my background in project leadership, change management, digital transformation, and stakeholder alignment. I am especially interested in roles where I can help turn strategic or digital ambitions into practical execution.

## What makes you a strong fit?

I bring senior project and consulting experience from Knowit Insight, Ideon Science Park, Sweden Secure Tech Hub, Omegapoint, and Jayway by Devoteam. My work has often involved aligning diverse stakeholders, structuring ambiguous initiatives, and connecting digitalization to concrete business value.

## What would you bring in the first months?

I would start by understanding the organization, stakeholders, goals, and delivery rhythm. From there I would create structure around priorities, decision points, communication, and measurable progress while building trust with the people involved.

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
  const folderName = `${app.number}-${slug(app.company)}-${slug(app.role)}`;
  const outDir = path.join(root, "output", "application-packages", folderName);
  const publicDir = path.join(publicRoot, "application-packages", folderName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  const files = [
    ["tailored-cv.md", tailoredCv(app, report, keywords, emphasis)],
    ["cover-letter.md", coverLetter(app, report, keywords, emphasis)],
    ["linkedin-message.md", linkedinMessage(app)],
    ["application-answers.md", applicationAnswers(app, report)],
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
