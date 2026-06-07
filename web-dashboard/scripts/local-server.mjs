import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { generatePackage } from "./generate-package.mjs";
import { main as runScan } from "../../scan.mjs";
import { main as evaluateDiscovered } from "../../evaluate-discovered.mjs";

const here = path.resolve(import.meta.dirname, "..");
const root = path.resolve(here, "..");
const dist = path.join(here, "dist");
const publicDir = path.join(here, "public");
const portArg = process.argv.find((arg) => /^--port=/.test(arg));
const port = Number(portArg?.split("=")[1] || process.env.PORT || 5177);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function splitTrackerRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((field) => field.trim());
}

function trackerRow(fields) {
  return `| ${fields.map((field) => String(field).replace(/\|/g, "/").trim()).join(" | ")} |`;
}

function updateApplicationStatus(number, status) {
  const normalized = String(number || "").padStart(3, "0");
  const allowed = new Set(["Evaluated", "Applied", "Responded", "Interview", "Offer", "Rejected", "Discarded", "SKIP"]);
  if (!allowed.has(status)) throw new Error(`Invalid status: ${status}`);

  const applicationsPath = path.join(root, "data", "applications.md");
  const content = fs.readFileSync(applicationsPath, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  let found = false;
  const lines = content.split(/\r?\n/).map((line) => {
    if (!line.startsWith(`| ${normalized} |`)) return line;
    const fields = splitTrackerRow(line);
    fields[5] = status;
    if (status === "Applied") {
      const note = fields[8] || "";
      fields[8] = /Applied \d{4}-\d{2}-\d{2}/.test(note) ? note : `Applied ${today}${note ? `; ${note}` : ""}`;
    }
    found = true;
    return trackerRow(fields);
  });
  if (!found) throw new Error(`Application #${normalized} not found`);
  fs.writeFileSync(applicationsPath, lines.join("\n"), "utf8");
  return { number: normalized, status, appliedDate: status === "Applied" ? today : "" };
}

function startApplyAssistant(number) {
  const normalized = String(number || "").padStart(3, "0");
  if (!/^\d{3}$/.test(normalized)) throw new Error("Application number is required");

  const logPath = path.join(root, "web-dashboard-apply-assistant.log");
  const output = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, ["apply-assistant.mjs", "--number", normalized], {
    cwd: root,
    detached: true,
    stdio: ["ignore", output, output],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(output);
  return {
    ok: true,
    number: normalized,
    pid: child.pid,
    message: `Application assistant started for #${normalized}. A Playwright browser should open shortly.`,
  };
}

async function rebuildData() {
  await import(`./build-data.mjs?cacheBust=${Date.now()}`);
}

async function captureOutput(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => {
    logs.push(args.join(" "));
    originalLog(...args);
  };
  console.error = (...args) => {
    errors.push(args.join(" "));
    originalError(...args);
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { stdout: logs.join("\n"), stderr: errors.join("\n") };
}

async function withCwd(cwd, fn) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

function addSource(payload) {
  const name = String(payload.name || "").trim();
  const provider = String(payload.provider || "manual").trim();
  const url = String(payload.url || "").trim();
  const query = String(payload.query || "").trim();
  if (!name) throw new Error("Source name is required");
  if (/[\r\n]/.test(`${name}${provider}${url}${query}`)) throw new Error("Source fields must be single-line values");

  const portalsPath = path.join(root, "portals.yml");
  const config = yaml.load(fs.readFileSync(portalsPath, "utf8")) || {};
  if (provider === "search") {
    if (!query) throw new Error("Search query is required");
    config.search_queries = Array.isArray(config.search_queries) ? config.search_queries : [];
    config.search_queries.push({ name, query, enabled: true });
  } else {
    config.tracked_companies = Array.isArray(config.tracked_companies) ? config.tracked_companies : [];
    const entry = { name, provider, enabled: true };
    if (url) entry.careers_url = url;
    config.tracked_companies.push(entry);
  }
  fs.writeFileSync(portalsPath, yaml.dump(config, { lineWidth: 120, noRefs: true }), "utf8");
  return { ok: true, name, provider };
}

function safeJoin(base, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const cleanPath = decoded === "/" ? "/index.html" : decoded;
  const full = path.resolve(base, `.${cleanPath}`);
  if (!full.startsWith(base)) return null;
  return full;
}

async function handle(req, res) {
  try {
    if (req.url === "/api/generate-package" && req.method === "POST") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = await generatePackage(payload.number);
      sendJson(res, 200, result);
      return;
    }

    if (req.url === "/api/save-package-file" && req.method === "POST") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const folder = String(payload.folder || "");
      const file = String(payload.file || "");
      if (typeof payload.content !== "string") {
        sendJson(res, 400, { error: "Package content must be text" });
        return;
      }
      const content = payload.content;
      if (content.trim() === "[object Object]") {
        sendJson(res, 400, { error: "Refusing to save invalid object text" });
        return;
      }
      if (!/^[\w.-]+$/.test(folder) || !/^[\w.-]+\.md$/.test(file)) {
        sendJson(res, 400, { error: "Invalid package file" });
        return;
      }
      const outputBase = path.join(root, "output", "application-packages");
      const outputPath = path.resolve(outputBase, folder, file);
      if (!outputPath.startsWith(outputBase) || !fs.existsSync(outputPath)) {
        sendJson(res, 404, { error: "Package file not found" });
        return;
      }
      fs.writeFileSync(outputPath, content, "utf8");
      const publicPath = path.resolve(publicDir, "application-packages", folder, file);
      fs.mkdirSync(path.dirname(publicPath), { recursive: true });
      fs.writeFileSync(publicPath, content, "utf8");
      sendJson(res, 200, { ok: true, folder, file });
      return;
    }

    if (req.url === "/api/update-status" && req.method === "POST") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = updateApplicationStatus(payload.number, payload.status);
      sendJson(res, 200, result);
      return;
    }

    if (req.url === "/api/start-apply" && req.method === "POST") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = startApplyAssistant(payload.number);
      sendJson(res, 200, result);
      return;
    }

    if (req.url === "/api/add-source" && req.method === "POST") {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = addSource(payload);
      await rebuildData();
      sendJson(res, 200, result);
      return;
    }

    if (req.url === "/api/refresh-sources" && req.method === "POST") {
      const scan = await captureOutput(() => withCwd(root, () => runScan([])));
      const build = await captureOutput(() => rebuildData());
      sendJson(res, 200, {
        ok: true,
        stdout: scan.stdout,
        stderr: scan.stderr,
        build: build.stdout,
      });
      return;
    }

    if (req.url === "/api/evaluate-discovered" && req.method === "POST") {
      const evaluation = await captureOutput(() => withCwd(root, () => evaluateDiscovered()));
      const build = await captureOutput(() => rebuildData());
      sendJson(res, 200, {
        ok: true,
        stdout: evaluation.stdout,
        stderr: evaluation.stderr,
        build: build.stdout,
      });
      return;
    }

    const urlPath = req.url || "/";
    const preferPublic = urlPath.startsWith("/career-data.json") || urlPath.startsWith("/application-packages/") || urlPath.startsWith("/reports/");
    let filePath = preferPublic ? safeJoin(publicDir, urlPath) : safeJoin(dist, urlPath);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = preferPublic ? safeJoin(dist, urlPath) : safeJoin(publicDir, urlPath);
    }
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(dist, "index.html");
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

http.createServer(handle).listen(port, "127.0.0.1", () => {
  console.log(`Career Ops web dashboard running at http://127.0.0.1:${port}/`);
});
