import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsRoot = path.join(projectRoot, 'tools');
const apiRoot = path.join(projectRoot, 'api');
const libRoot = path.join(projectRoot, 'lib');
const toolFiles = (await readdir(toolsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
  .map((entry) => path.join('tools', entry.name));
const apiFiles = (await readdir(apiRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
  .map((entry) => path.join('api', entry.name));
const libFiles = (await readdir(libRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
  .map((entry) => path.join('lib', entry.name));
const files = ['production.js', 'site.js', ...toolFiles, ...apiFiles, ...libFiles].sort();
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    failures.push(`${file}\n${result.stderr || result.stdout || `node --check exited ${result.status}`}`);
  }
}

if (failures.length > 0) {
  console.error(`Syntax checks failed (${failures.length}/${files.length}).\n\n${failures.join('\n\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Syntax checks passed (${files.length} JavaScript files).`);
}
