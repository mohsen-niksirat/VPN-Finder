// Pre-push & CI security grep gate for VPN Finder.
// Fails with exit code 1 if a PublicVPNList key literal or a hardcoded
// authorization token (or raw Telegram bot / tgcloud CLI token) appears anywhere in the repository.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.tgcloud',
]);

// Construct prefixes dynamically so this scanner script itself contains zero forbidden substrings.
const PVL_PREFIX = ['p', 'v', 'l', 'k', '_'].join('');
const BEARER_WORD = ['B', 'e', 'a', 'r', 'e', 'r'].join('');

const RULES = [
  {
    name: 'PublicVPNList API key literal',
    regex: new RegExp(PVL_PREFIX + '[A-Za-z0-9_\\-]*'),
  },
  {
    name: 'Hardcoded authorization token literal',
    // Matches `<BEARER_WORD> <literal>` where the token is not a template interpolation `${...}` or `<...>` placeholder
    regex: new RegExp(BEARER_WORD + '\\s+(?!\\$\\{)(?!<[A-Za-z0-9_\\-\\s]+>)[A-Za-z0-9_\\-\\.]{4,}'),
  },
  {
    name: 'Telegram Bot API token literal',
    regex: /\b\d{8,11}:[A-Za-z0-9_-]{35}\b/,
  },
  {
    name: 'tgcloud CLI token literal',
    regex: /\bapp\d{6,}:[A-Za-z0-9_-]{20,}\b/,
  },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const findings = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.regex.test(line)) {
        findings.push({
          file: rel,
          line: i + 1,
          rule: rule.name,
        });
      }
    }
  }
  return findings;
}

function main() {
  const files = walk(ROOT);
  const allFindings = [];
  for (const f of files) {
    const res = scanFile(f);
    if (res.length) allFindings.push(...res);
  }

  if (allFindings.length > 0) {
    console.error('SECURITY GREP GATE FAILED: potential secret literal(s) detected:');
    for (const item of allFindings) {
      console.error(`  - ${item.file}:${item.line} [${item.rule}]`);
    }
    process.exit(1);
  }

  console.log(`Security grep gate passed (${files.length} files scanned, 0 secret literals found).`);
}

main();
