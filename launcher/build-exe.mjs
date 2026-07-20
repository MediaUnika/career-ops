#!/usr/bin/env node
/**
 * Builds CareerOps.exe (Windows) using Node's built-in Single Executable
 * Application (SEA) support: launcher/start.cjs -> launcher/sea-prep.blob
 * -> a copy of the current node.exe with the blob injected via postject.
 *
 * Only needs to be re-run if launcher/start.cjs itself changes — everyday
 * app updates (dashboard UI, modes, etc.) are handled by the in-app
 * "Update" button, which does a git pull + rebuild + restart without
 * touching the exe.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(launcherDir, '..');
const exePath = path.join(root, 'CareerOps.exe');
const blobPath = path.join(launcherDir, 'sea-prep.blob');
const configPath = path.join(launcherDir, 'sea-config.json');

function step(label, fn) {
  process.stdout.write(`- ${label}... `);
  try {
    fn();
    console.log('done');
  } catch (err) {
    console.log('FAILED');
    throw err;
  }
}

if (process.platform !== 'win32') {
  console.error('This build script produces a Windows .exe and must be run on Windows.');
  process.exit(1);
}

step('Generating SEA blob', () => {
  execFileSync(process.execPath, ['--experimental-sea-config', configPath], { cwd: root, stdio: 'inherit' });
  if (!existsSync(blobPath)) throw new Error('sea-prep.blob was not created');
});

step('Copying node.exe', () => {
  if (existsSync(exePath)) rmSync(exePath, { force: true });
  copyFileSync(process.execPath, exePath);
});

step('Removing existing signature (best-effort)', () => {
  try {
    execFileSync('signtool', ['remove', '/s', exePath], { stdio: 'ignore' });
  } catch {
    // signtool may not be installed, or node.exe may be unsigned already — non-fatal either way.
  }
});

step('Injecting SEA blob (postject)', () => {
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules', 'postject', 'dist', 'cli.js'),
      exePath,
      'NODE_SEA_BLOB',
      blobPath,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ],
    { cwd: root, stdio: 'inherit' },
  );
});

console.log(`\nBuilt ${exePath}`);
console.log('Run launcher/create-shortcut.ps1 (or double-click CareerOps.exe directly) to finish setup.');
