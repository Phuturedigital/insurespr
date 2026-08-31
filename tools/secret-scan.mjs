import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TOKEN_PATTERNS = [
  ['private-key-block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['supabase-secret-key', /\bsb_secret_[A-Za-z0-9_-]{16,}\b/g],
  ['jwt-shaped-token', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['resend-api-key', /\bre_[A-Za-z0-9_-]{20,}\b/g],
  ['turnstile-key', /\b0x[A-Za-z0-9_-]{20,}\b/g],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{30,}\b/g],
  ['stripe-secret-key', /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g],
  ['aws-access-key', /\bAKIA[A-Z0-9]{16}\b/g],
  ['database-credential-uri', /\bpostgres(?:ql)?:\/\/[^:\s/@]+:[^@\s/]+@[^\s'"`]+/gi],
];

const SECRET_ENV_NAMES = [
  'TURNSTILE_SECRET_KEY',
  'RESEND_API_KEY',
  'NOTIFICATION_WORKER_SECRET',
  'INSURESPR_PROXY_PRIVATE_KEY_B64',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'DATABASE_URL',
  'INSURESPR_BACKUP_DATABASE_URL',
  'INSURESPR_RESTORE_DATABASE_URL',
  'PGPASSWORD',
];

const SECRET_ASSIGNMENT = new RegExp(`^[ \\t]*(${SECRET_ENV_NAMES.join('|')})[ \\t]*=[ \\t]*(.*?)[ \\t]*$`, 'gmi');
const SAFE_PLACEHOLDER = /^(?:|null|undefined|<[^>]+>|\$\{[^}]+\}|(?:replace|example|sample|dummy|test|your|not_configured|unset)[A-Za-z0-9_.{}<>$-]*)$/i;
const TURNSTILE_TEST_FIXTURE = ['0x4AAAAA', 'example', 'plaintext', 'secret'].join('-');

const normalized = (file) => file.split(path.sep).join('/');
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

function fixtureAllowed(file, type, match) {
  if (type === 'turnstile-key'
    && file === 'tools/turnstile-activation-handoff.test.mjs'
    && match === TURNSTILE_TEST_FIXTURE) return true;

  if (type === 'database-credential-uri'
    && (file.endsWith('.test.mjs') || file.startsWith('tools/fixtures/'))) return true;

  return false;
}

export function scanText(file, text) {
  const findings = [];

  for (const [type, pattern] of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (fixtureAllowed(file, type, match[0])) continue;
      findings.push({ file, line: lineAt(text, match.index), type });
    }
  }

  SECRET_ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(SECRET_ASSIGNMENT)) {
    const value = match[2].replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    if (SAFE_PLACEHOLDER.test(value)) continue;
    findings.push({ file, line: lineAt(text, match.index), type: `nonempty-${match[1].toLowerCase()}` });
  }

  return findings;
}

export function repositoryFiles() {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });

  return [...new Set(output.split('\0').filter(Boolean))].sort();
}

export async function scanRepository(files = repositoryFiles()) {
  const findings = [];

  for (const file of files) {
    let content;
    try {
      content = await readFile(path.join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\0')) continue;
    findings.push(...scanText(normalized(file), content));
  }

  return findings;
}

async function main() {
  const findings = await scanRepository();
  if (findings.length === 0) {
    console.log('Repository secret scan passed: no credential material found.');
    return;
  }

  console.error(`Repository secret scan failed with ${findings.length} finding(s).`);
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.type}]`);
  }
  console.error('Rotate any real exposed credential before removing it from Git history. Values are deliberately not printed.');
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
