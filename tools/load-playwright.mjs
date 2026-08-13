import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

export function loadPlaywright() {
  const resolvers = [createRequire(import.meta.url)];
  const configuredModules = process.env.CODEX_NODE_MODULES;
  const bundledModules = configuredModules || path.join(
    os.homedir(),
    '.cache',
    'codex-runtimes',
    'codex-primary-runtime',
    'dependencies',
    'node',
    'node_modules'
  );

  resolvers.push(createRequire(path.join(path.dirname(bundledModules), '__insurespr_loader__.cjs')));

  let localError;
  for (const resolve of resolvers) {
    try {
      return resolve('playwright');
    } catch (error) {
      localError ||= error;
    }
  }

  const failure = new Error(
    'Playwright is required for browser audits. Install it locally or set CODEX_NODE_MODULES to a node_modules directory containing Playwright.'
  );
  failure.cause = localError;
  throw failure;
}
