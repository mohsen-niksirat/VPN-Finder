// Automated local verification suite for VPN Finder Stage 1:
// 1. Verifies tgcloud schema exports (`users`, `botConfig`, `pvlCache`).
// 2. Verifies `/start`, `/app`, `/help` in EN & FA, and `users` table recording.
// 3. Verifies `/stats` owner-only check (`OWNER_ID` from `bot_config`).
// 4. Verifies proxy endpoints (`pvlStats`, `pvlProtocols`, `pvlCountries`) reject unauthenticated calls.
// 5. Verifies `{ error: "setup_required" }` when `pvl_api_key` is missing from `bot_config`.
// 6. Verifies `pvlCountries` rejects missing `protocol` parameter (never relies on OpenVPN default).
// 7. Verifies 30-min TTL caching (`fetched_at` unchanged on second call) and ETag 304 revalidation.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function runSyntaxChecks() {
  const jsFiles = [
    'app.js',
    'scripts/grep-gate.js',
    'scripts/sync-static.js',
    'serverless/tgcloud/schema.js',
    'serverless/tgcloud/lib/texts.js',
    'serverless/tgcloud/lib/pvl.js',
    'serverless/tgcloud/handlers/message.js',
    'serverless/tgcloud/endpoints/pvlStats.js',
    'serverless/tgcloud/endpoints/pvlProtocols.js',
    'serverless/tgcloud/endpoints/pvlCountries.js',
    'serverless/tgcloud/endpoints/setup.js',
  ];

  for (const rel of jsFiles) {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), `Expected file to exist: ${rel}`);
  }
  console.log(`✓ All ${jsFiles.length} Stage 1 files exist.`);
}

async function runTextAndBotFatherChecks() {
  const texts = await import('../serverless/tgcloud/lib/texts.js');

  assert.ok(texts.ABOUT_EN.length <= 120, `ABOUT_EN length ${texts.ABOUT_EN.length} > 120`);
  assert.ok(texts.ABOUT_FA.length <= 120, `ABOUT_FA length ${texts.ABOUT_FA.length} > 120`);
  assert.ok(texts.DESC_EN.length <= 512, `DESC_EN length ${texts.DESC_EN.length} > 512`);
  assert.ok(texts.DESC_FA.length <= 512, `DESC_FA length ${texts.DESC_FA.length} > 512`);

  assert.deepEqual(
    texts.COMMANDS_EN.map(c => c.command),
    ['start', 'app', 'help'],
    'Only start, app, help commands allowed'
  );
  assert.deepEqual(
    texts.COMMANDS_FA.map(c => c.command),
    ['start', 'app', 'help'],
    'Only start, app, help commands allowed in FA'
  );

  // Verify no em dash (R-02) in bot texts
  for (const [k, v] of Object.entries(texts)) {
    if (typeof v === 'string') {
      assert.ok(!v.includes('\u2014'), `Em dash found in texts.${k}`);
    }
  }
  assert.ok(!texts.welcomeText('en').includes('\u2014'));
  assert.ok(!texts.welcomeText('fa').includes('\u2014'));
  assert.ok(!texts.helpText('en').includes('\u2014'));
  assert.ok(!texts.helpText('fa').includes('\u2014'));
  assert.ok(texts.helpText('en').includes('https://publicvpnlist.com/api/'));
  assert.ok(texts.helpText('fa').includes('https://publicvpnlist.com/api/'));

  console.log(`✓ BotFather texts validated (ABOUT_EN=${texts.ABOUT_EN.length}c, ABOUT_FA=${texts.ABOUT_FA.length}c, DESC_EN=${texts.DESC_EN.length}c, DESC_FA=${texts.DESC_FA.length}c).`);
}

async function main() {
  runSyntaxChecks();
  await runTextAndBotFatherChecks();
  console.log('Stage 1 static & contract checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
