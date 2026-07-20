'use strict';
/**
 * Source for CareerOps.exe (built via `npm run build:exe`, see build-exe.mjs).
 *
 * Must be plain CommonJS with only core Node modules — this file is what
 * gets snapshotted into the Node Single Executable Application (SEA) blob.
 *
 * Behavior: if the dashboard server is already up, just open the browser.
 * Otherwise start it (hidden, detached) and open the browser once it
 * answers /api/health. Self-locates via process.execPath, so this exe must
 * live in the career-ops project root (next to package.json) — that's how
 * it finds the project without any bundled config.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = 5177;
const root = path.dirname(process.execPath);
const launcherDir = path.join(root, 'launcher');

function log(message) {
  try {
    fs.mkdirSync(launcherDir, { recursive: true });
    fs.appendFileSync(path.join(launcherDir, 'launcher.log'), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Nothing sensible to do if we can't even write a log — fail silently.
  }
}

function isServerUp(callback) {
  const req = http.get(
    { host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 1500 },
    (res) => {
      res.resume();
      callback(res.statusCode === 200);
    },
  );
  req.on('error', () => callback(false));
  req.on('timeout', () => {
    req.destroy();
    callback(false);
  });
}

function openBrowser() {
  spawn('cmd.exe', ['/c', 'start', '""', `http://127.0.0.1:${PORT}/`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function startServer() {
  const out = fs.openSync(path.join(launcherDir, 'server.log'), 'a');
  const child = spawn('cmd.exe', ['/c', 'npm', '--prefix', 'web-dashboard', 'run', 'dev'], {
    cwd: root,
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  fs.closeSync(out);
  child.unref();
  fs.writeFileSync(path.join(launcherDir, '.server.pid'), String(child.pid), 'utf8');
  log(`Started server, PID ${child.pid}`);
}

function waitAndOpen(attemptsLeft) {
  isServerUp((up) => {
    if (up) {
      openBrowser();
      return;
    }
    if (attemptsLeft <= 0) {
      log('Server did not come up within the timeout — opening the browser anyway.');
      openBrowser();
      return;
    }
    setTimeout(() => waitAndOpen(attemptsLeft - 1), 1000);
  });
}

process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err.stack || err.message}`);
  process.exit(1);
});

function main() {
  if (!fs.existsSync(path.join(root, 'package.json'))) {
    log(`CareerOps.exe must live in the career-ops project root. Found no package.json next to ${process.execPath}`);
    return;
  }
  fs.mkdirSync(launcherDir, { recursive: true });
  isServerUp((up) => {
    if (up) {
      log('Server already running');
      openBrowser();
      return;
    }
    startServer();
    waitAndOpen(30);
  });
}

main();
