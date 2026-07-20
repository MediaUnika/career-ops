'use strict';
/**
 * Stops the dashboard server started by CareerOps.exe.
 * Run via "Stop Career Ops.cmd" (double-click) or `node launcher/stop.cjs`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const pidFile = path.join(__dirname, '.server.pid');

if (!fs.existsSync(pidFile)) {
  console.log('No running server found (launcher/.server.pid missing).');
  process.exit(0);
}

const pid = fs.readFileSync(pidFile, 'utf8').trim();

try {
  execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'inherit' });
  console.log(`Stopped Career Ops server (PID ${pid}).`);
} catch (err) {
  console.log(`Server (PID ${pid}) was not running.`);
}

fs.rmSync(pidFile, { force: true });
