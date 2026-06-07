#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import yaml from "js-yaml";
import { generatePackage } from "./web-dashboard/scripts/generate-package.mjs";

const root = import.meta.dirname;
const applicationsPath = path.join(root, "data", "applications.md");
const profilePath = path.join(root, "config", "profile.yml");
const profileDir = path.join(root, ".playwright-apply-profile");
const packagesDir = path.join(root, "output", "application-packages");
const outputDir = path.join(root, "output");

function usage() {
  console.log(`Usage:
  node apply-assistant.mjs <job-url>
  node apply-assistant.mjs --number 007
  node apply-assistant.mjs --report reports/007-company-role-date.md

Opens a visible Playwright browser for application work.
It may help navigate, inspect, and fill forms, but it must stop before final Submit/Send/Apply.`);
}

function splitTrackerRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((field) => field.trim());
}

function readApplications() {
  if (!fs.existsSync(applicationsPath)) return [];
  return fs.readFileSync(applicationsPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^\|\s*\d+/.test(line))
    .map((line) => {
      const fields = splitTrackerRow(line);
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

function loadReport(reportPath) {
  if (!reportPath) return null;
  const absolute = path.resolve(root, reportPath);
  if (!absolute.startsWith(root) || !fs.existsSync(absolute)) return null;
  const markdown = fs.readFileSync(absolute, "utf8");
  return {
    path: reportPath.replace(/\\/g, "/"),
    markdown,
    url: reportValue(markdown, "URL"),
    archetype: reportValue(markdown, "Archetype"),
    score: reportValue(markdown, "Score"),
    strategy: reportSection(markdown, "C) Level and Strategy"),
    answers: reportSection(markdown, "H) Draft Application Answers"),
  };
}

function loadProfile() {
  if (!fs.existsSync(profilePath)) return {};
  return yaml.load(fs.readFileSync(profilePath, "utf8")) || {};
}

function findResumePdf() {
  if (!fs.existsSync(outputDir)) return "";
  const files = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
    .map((entry) => path.join(outputDir, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || "";
}

async function ensurePackage(app) {
  let pkg = findPackage(app);
  if (!pkg && app?.number) {
    await generatePackage(app.number);
    pkg = findPackage(app);
  }
  return pkg;
}

function findPackage(app) {
  if (!app?.number || !fs.existsSync(packagesDir)) return null;
  const folder = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .find((name) => name.startsWith(`${app.number}-`));
  if (!folder) return null;
  const dir = path.join(packagesDir, folder);
  const files = ["tailored-cv.md", "cover-letter.md", "application-answers.md", "linkedin-message.md", "package.md"]
    .map((name) => ({ name, path: path.join(dir, name) }))
    .filter((file) => fs.existsSync(file.path));
  return { dir, files };
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createBriefPage(target, pkg) {
  const app = target.app || {};
  const report = target.report || {};
  const htmlPath = path.join(profileDir, "apply-brief.html");
  fs.mkdirSync(profileDir, { recursive: true });
  const fileLinks = (pkg?.files || []).map((file) => {
    const href = pathToFileURL(file.path).href;
    return `<li><a href="${href}" target="_blank">${escapeHtml(file.name)}</a></li>`;
  }).join("");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Apply brief ${escapeHtml(app.number || "")}</title>
  <style>
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #f7f5ef; color: #17201d; }
    main { max-width: 920px; margin: 0 auto; padding: 32px; }
    section { border: 1px solid #d8d2c5; background: #fffdf7; padding: 22px; margin-bottom: 16px; }
    h1 { margin: 0 0 8px; font-size: 34px; line-height: 1; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    p, li { line-height: 1.5; }
    a { color: #17443a; font-weight: 700; }
    .guard { background: #e8eeeb; border-color: #17443a; }
    pre { white-space: pre-wrap; font: inherit; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>${escapeHtml(app.company || "Application")} - ${escapeHtml(app.role || "Role")}</h1>
      <p><strong>Tracker:</strong> #${escapeHtml(app.number || "direct")} | <strong>Score:</strong> ${escapeHtml(app.score || report.score || "N/A")}</p>
      <p><a href="${escapeHtml(target.url)}" target="_blank">Job posting</a>${report.path ? ` | <a href="${pathToFileURL(path.join(root, report.path)).href}" target="_blank">Report</a>` : ""}</p>
    </section>
    <section class="guard">
      <h2>Apply guardrail</h2>
      <p>This assistant can navigate, inspect, and help fill fields. It must stop before final Submit, Send, or Apply. You make the final call.</p>
    </section>
    <section>
      <h2>Prepared materials</h2>
      ${fileLinks ? `<ul>${fileLinks}</ul>` : "<p>No package files found yet. Generate a package in the dashboard first for a stronger application.</p>"}
    </section>
    ${report.strategy ? `<section><h2>Positioning</h2><pre>${escapeHtml(report.strategy)}</pre></section>` : ""}
    ${report.answers ? `<section><h2>Draft answers</h2><pre>${escapeHtml(report.answers)}</pre></section>` : ""}
  </main>
</body>
</html>`;
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

async function pageHasApplicationForm(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const fields = [...document.querySelectorAll("input, textarea, select")].filter(visible);
    const fileInput = fields.some((el) => el.type === "file");
    const personal = fields.some((el) => /name|email|phone|cv|resume|cover|linkedin|portfolio/i.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute("aria-label") || ""}`));
    return fileInput || (fields.length >= 3 && personal);
  });
}

async function detectLoginGate(page) {
  const text = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).toLowerCase();
  return /log in|login|sign in|signin|authenticate|create account|easy apply/.test(text);
}

async function clickSafeApplyEntry(page, context) {
  const url = page.url();
  if (/jobs\.ashbyhq\.com\/[^/]+\/[^/]+$/i.test(url)) {
    await page.goto(`${url.replace(/\/$/, "")}/application`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.bringToFront().catch(() => {});
    return { status: "form-ready", message: "Opened the Ashby application form directly. Stopping before final submit." };
  }

  if (await pageHasApplicationForm(page)) {
    await page.bringToFront().catch(() => {});
    return { status: "form-ready", message: "Application form is already visible. Stopping before final submit." };
  }

  const applyText = /^(apply|apply now|start application|submit application|ansøg|søg stillingen|send ansøgning)$/i;
  const candidates = [
    page.getByRole("link", { name: applyText }).first(),
    page.getByRole("button", { name: applyText }).first(),
    page.locator("a,button").filter({ hasText: /apply now|start application|apply|ansøg|søg stillingen/i }).first(),
  ];

  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const label = (await locator.innerText().catch(() => "")).trim();
    if (/submit|send|finish|complete/i.test(label) && await pageHasApplicationForm(page)) continue;

    const beforeUrl = page.url();
    const beforePages = context.pages().length;
    const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await locator.click({ timeout: 8000 });
    const popup = await popupPromise;
    const active = popup || page;
    await active.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    await active.bringToFront().catch(() => {});

    if (popup || context.pages().length > beforePages || active.url() !== beforeUrl) {
      return { status: "advanced", message: `Clicked "${label || "Apply"}" and opened the application entry point.` };
    }
    if (await pageHasApplicationForm(active)) {
      return { status: "form-ready", message: `Clicked "${label || "Apply"}"; application form is visible.` };
    }
    return { status: "clicked", message: `Clicked "${label || "Apply"}". Review the page for next steps.` };
  }

  if (await detectLoginGate(page)) {
    await page.bringToFront().catch(() => {});
    return { status: "login-needed", message: "Login or account gate detected. Log in interactively, then continue in the browser." };
  }
  await page.bringToFront().catch(() => {});
  return { status: "no-apply-found", message: "No safe Apply entry point found. Use the open posting to choose the right application link." };
}

async function fillIfEmpty(locator, value) {
  if (!value) return false;
  const count = await locator.count().catch(() => 0);
  if (!count) return false;
  const target = locator.first();
  const current = await target.inputValue().catch(() => "");
  if (current) return false;
  await target.fill(value, { timeout: 5000 }).catch(() => {});
  return true;
}

async function safeAutofill(page, profile) {
  const candidate = profile.candidate || {};
  const resumePdf = findResumePdf();
  const filled = [];

  if (await fillIfEmpty(page.locator('input[name="_systemfield_name"], input#_systemfield_name'), candidate.full_name)) filled.push("name");
  if (await fillIfEmpty(page.locator('input[name="_systemfield_email"], input#_systemfield_email'), candidate.email)) filled.push("email");
  if (await fillIfEmpty(page.locator('input[type="url"]').filter({ hasNotText: /./ }), candidate.linkedin)) filled.push("LinkedIn");
  if (await fillIfEmpty(page.getByLabel(/linkedin profile/i), candidate.linkedin)) {
    if (!filled.includes("LinkedIn")) filled.push("LinkedIn");
  }

  const locationInput = page.locator('input[placeholder*="Start typing"], input[aria-autocomplete="list"]').first();
  if (await fillIfEmpty(locationInput, candidate.location)) filled.push("location");

  if (resumePdf) {
    const resumeInput = page.locator('input[type="file"]#_systemfield_resume, input[type="file"]').nth(1);
    const count = await resumeInput.count().catch(() => 0);
    if (count) {
      await resumeInput.setInputFiles(resumePdf).catch(() => {});
      filled.push("resume PDF");
    }
  }

  return { filled, resumePdf };
}

function resolveTarget(args) {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const numberIdx = args.indexOf("--number");
  if (numberIdx !== -1) {
    const number = String(args[numberIdx + 1] || "").padStart(3, "0");
    const app = readApplications().find((item) => item.number === number);
    if (!app) throw new Error(`No application found for #${number}`);
    const report = loadReport(app.reportPath);
    return { app, report, url: report?.url || "" };
  }

  const reportIdx = args.indexOf("--report");
  if (reportIdx !== -1) {
    const reportPath = args[reportIdx + 1] || "";
    const report = loadReport(reportPath);
    if (!report) throw new Error(`Report not found: ${reportPath}`);
    return { app: null, report, url: report.url || "" };
  }

  const url = args.find((arg) => /^https?:\/\//i.test(arg));
  if (!url) throw new Error("Pass a job URL, --number, or --report.");
  return { app: null, report: null, url };
}

async function main() {
  const target = resolveTarget(process.argv.slice(2));
  if (!target.url) throw new Error("No job URL found. Add **URL:** to the report or pass a URL directly.");

  const context = target.app
    ? `#${target.app.number} ${target.app.company} - ${target.app.role} (${target.app.score}, ${target.app.status})`
    : "Direct URL";

  console.log(`Opening application assistant: ${context}`);
  if (target.report) {
    console.log(`Report: ${target.report.path}`);
    console.log(`Archetype: ${target.report.archetype || "N/A"} | Score: ${target.report.score || "N/A"}`);
    if (target.report.strategy) {
      console.log("\nPositioning:");
      console.log(target.report.strategy.split(/\r?\n/).slice(0, 6).join("\n"));
    }
    if (target.report.answers) {
      console.log("\nDraft answers found in report Section H.");
    }
  }

  const browser = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });
  const profile = loadProfile();
  const pkg = await ensurePackage(target.app);
  const briefPath = createBriefPage(target, pkg);
  const briefPage = browser.pages()[0] || await browser.newPage();
  await briefPage.goto(pathToFileURL(briefPath).href, { waitUntil: "domcontentloaded" });
  const page = await browser.newPage();
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const advance = await clickSafeApplyEntry(page, browser);
  const autofill = await safeAutofill(page, profile);
  await page.bringToFront().catch(() => {});
  console.log(`\nBrowser opened: ${await page.title()}`);
  console.log(`Apply assistant: ${advance.status} - ${advance.message}`);
  console.log(`Safe autofill: ${autofill.filled.length ? autofill.filled.join(", ") : "nothing filled"}`);
  if (pkg?.files?.length) {
    console.log(`Package files opened in assistant brief: ${pkg.dir}`);
  }
  console.log("Login interactively if needed. I can inspect/fill forms from here, but final Submit/Send/Apply stays with you.");
  console.log("Keep this process running while applying. Press Ctrl+C to close the browser.");

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
