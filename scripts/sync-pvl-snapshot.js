// Syncs the non-secret cached catalog summary v2 from the tgcloud proxy (`endpoints/pvlStats` with `bundle: true`)
// into `pvl-snapshot.json` (and `serverless/dist/`), including `servers_preview` (page 1, sort=score, 20 records)
// for every protocol with records > 0.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'pvl-snapshot.json');

function main() {
  const out = execSync(
    'npx tgcloud run endpoints/pvlStats "{ bundle: true, protocol: \'openvpn\' }" --ctx "{ initData: { user: { id: 1 } } }"',
    {
      cwd: path.join(ROOT, 'serverless'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
    }
  );

  const m = out.match(/<\s*(\{[\s\S]*\})\s+\d+ms/);
  if (!m) {
    throw new Error('Could not parse tgcloud run output:\n' + out);
  }
  const parsed = new Function('return ' + m[1])();
  if (!parsed || parsed.error) {
    throw new Error('Proxy returned error: ' + JSON.stringify(parsed));
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  const protoKeys = Object.keys(parsed.servers_preview || {});
  console.log(
    `Wrote proxy snapshot v${parsed.snapshot_version || 2} to pvl-snapshot.json ` +
    `(generated_at: ${parsed.generated_at}, servers_preview protocols: ${protoKeys.join(', ')})`
  );
}

main();
