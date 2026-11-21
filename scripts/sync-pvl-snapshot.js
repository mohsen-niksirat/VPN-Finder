// Syncs the non-secret cached catalog summary from the tgcloud proxy (`endpoints/pvlStats` with `bundle: true`)
// into `pvl-snapshot.json` (and `serverless/dist/`) so GitHub Pages can serve the proxy-fetched catalog snapshot
// cross-origin while `Telegram.WebApp.Serverless.call` handles live RPC on the tgcloud host.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'pvl-snapshot.json');

function main() {
  const out = execSync(
    'npx tgcloud run endpoints/pvlStats "{ bundle: true, protocol: \'openvpn\' }" --ctx "{ initData: { user: { id: 65807806 } } }"',
    {
      cwd: path.join(ROOT, 'serverless'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
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
  console.log(`Wrote proxy snapshot to pvl-snapshot.json (generated_at: ${parsed.generated_at})`);
}

main();
