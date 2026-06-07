#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = import.meta.dirname;
const applicationsPath = path.join(root, "data", "applications.md");
const profileDir = path.join(root, ".playwright-apply-profile");

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
  const page = browser.pages()[0] || await browser.newPage();
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  console.log(`\nBrowser opened: ${await page.title()}`);
  console.log("Login interactively if needed. I can inspect/fill forms from here, but final Submit/Send/Apply stays with you.");
  console.log("Keep this process running while applying. Press Ctrl+C to close the browser.");

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
