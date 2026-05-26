#!/usr/bin/env node

/**
 * update-system.mjs — Local-only no-op updater for career-ops forks
 *
 * This fork intentionally disables upstream update checks and apply/rollback
 * operations against the original santifer/career-ops repository.
 */

function printStatus(status, extra = {}) {
  console.log(JSON.stringify({ status, ...extra }));
}

function disabledMessage() {
  return 'Updates against the upstream santifer/career-ops repository are disabled in this fork.';
}

async function check() {
  printStatus('disabled', { message: disabledMessage() });
}

async function apply() {
  console.error(disabledMessage());
  process.exit(1);
}

function rollback() {
  console.error(disabledMessage());
  process.exit(1);
}

function dismiss() {
  printStatus('disabled', { message: disabledMessage() });
}

const cmd = process.argv[2] || 'check';

try {
  switch (cmd) {
    case 'check': await check(); break;
    case 'apply': await apply(); break;
    case 'rollback': rollback(); break;
    case 'dismiss': dismiss(); break;
    default:
      console.log('Usage: node update-system.mjs [check|apply|rollback|dismiss]');
      process.exit(1);
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
