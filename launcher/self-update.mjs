#!/usr/bin/env node
/**
 * Spawned by local-server.mjs's /api/self-update route, detached from the
 * request that triggered it (so it survives the old server process dying).
 *
 * Steps: git pull -> kill the old server -> rebuild + restart the dashboard.
 * Runs independently of the dashboard UI; progress is written to
 * launcher/update.log rather than returned over HTTP.
 */
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const launcherDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(launcherDir, '..');

const [, , parentPidArg, portArg] = process.argv;
const parentPid = Number(parentPidArg) || null;
const port = Number(portArg) || 5177;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  log('Self-update starting');
  // Give the HTTP response that triggered this a moment to reach the browser.
  await sleep(400);

  try {
    const output = execFileSync('git', ['pull', '--ff-only'], { cwd: root, encoding: 'utf8' });
    log(`git pull:\n${output.trim()}`);
  } catch (err) {
    log(`git pull failed (continuing with what's on disk): ${err.message}`);
  }

  if (parentPid) {
    let stopped = false;
    for (let attempt = 1; attempt <= 5 && !stopped; attempt += 1) {
      try {
        execFileSync('taskkill', ['/PID', String(parentPid), '/F'], { encoding: 'utf8' });
        stopped = true;
        log(`Stopped previous server (PID ${parentPid}) on attempt ${attempt}`);
      } catch (err) {
        const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
        log(`taskkill attempt ${attempt} on PID ${parentPid} failed: ${detail}`);
        await sleep(500);
      }
    }
  }
  // Give Windows a moment to release the port before rebinding.
  await sleep(800);

  const logPath = path.join(launcherDir, 'server.log');
  const out = fs.openSync(logPath, 'a');
  const child = spawn('cmd.exe', ['/c', 'npm', '--prefix', 'web-dashboard', 'run', 'dev'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  fs.closeSync(out);
  child.unref();
  fs.writeFileSync(path.join(launcherDir, '.server.pid'), String(child.pid), 'utf8');
  log(`Restarted server (PID ${child.pid})`);
}

main().catch((err) => {
  log(`Self-update failed: ${err.stack || err.message}`);
  process.exit(1);
});
