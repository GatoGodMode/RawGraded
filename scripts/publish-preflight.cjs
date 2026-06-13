/**
 * Scan repository tree before publish — fail on credentials, keys, or private artifacts.
 * Usage: node scripts/publish-preflight.cjs [rootDir]
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));

const skipDirs = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-mobile',
  'dist-ssr',
  'dist_release',
  'dist_recovery_v3',
  'release',
  'release-build',
  'installer-assets',
  'playwright-runtime',
  'android',
]);

const forbiddenNamePatterns = [
  /\.env(\.|$)/i,
  /^config\.php$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /\.pem$/i,
  /\.db$/i,
  /\.sqlite$/i,
  /\.sqlite3$/i,
  /signing\.local\.json$/i,
  /msix-store\.identity\.json$/i,
  /sync_error\.log$/i,
  /debug_.*\.log$/i,
  /build_log/i,
  /^debug_.*\.php$/i,
  /^diag_.*\.php$/i,
  /^test_.*\.php$/i,
  /^verify_.*\.php$/i,
  /^check_.*\.php$/i,
  /^probe\.(php|json)$/i,
  /DEPLOY-FTP\.txt$/i,
  /_backup_/i,
  /setup-pending.*\.json$/i,
  /matches.*\.txt$/i,
  /rawgraded-case-[A-F0-9]+\.json$/i,
  /rawgraded-case-.*\.json$/i,
  /-eval\.json$/i,
  /patent-whitepaper\.md$/i,
  /local-ai-model-roadmap\.md$/i,
  /^package\.json$/i,
  /^package-lock\.json$/i,
  /^vite\.config\.(ts|js|mts|mjs)$/i,
  /^vite-env\.d\.ts$/i,
  /^capacitor\.config\.(ts|js)$/i,
  /^electron-builder(\.msix)?\.yml$/i,
  /^Launch-RawGraded\.(ps1|bat)$/i,
  /^tsconfig\.json$/i,
  /^app(-desktop|-mobile)?\.html$/i,
  /^\.env\.example$/i,
  /^\.env\.desktop\.example$/i,
];

const forbiddenPathPrefixes = [
  'MapRG/',
  'training/',
  'android/',
  'build/',
  'mobile/',
];

const forbiddenExactPaths = new Set([
  'electron/tsconfig.json',
  'index.html',
  'index.app.html',
]);

const forbiddenContentPatterns = [
  /PokeMarket/i,
  /grade\.[a-z0-9-]+\.com\/badges/i,
  /foggksfx/i,
  /hyrulecat/i,
  /[A-Z]:\\(?:Users|SCRIPTS|PROJECTS)/i,
  /[a-z0-9._-]+@gmail\.com/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z\-_]{35}/,
  /ghp_[A-Za-z0-9]{36}/,
  /sk_live_[0-9A-Za-z]{10,}/,
  /pk_live_[0-9A-Za-z]{10,}/,
  /pokeprice_(?:free_)?[0-9a-f]{20,}/i,
  /Users_[a-zA-Z0-9]+_AppData/i,
  /Authorization:\s*bearer\s+[A-Za-z0-9_\-]{80,}/i,
  /define\s*\(\s*['"]DB_PASS['"]\s*,\s*['"][^'"]{3,}['"]\s*\)/,
];

const textExtensions = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.json', '.php', '.md', '.html',
  '.css', '.xml', '.yml', '.yaml', '.env', '.example', '.bat', '.ps1', '.py', '.sql',
]);

const violations = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    for (const prefix of forbiddenPathPrefixes) {
      if (rel === prefix.slice(0, -1) || rel.startsWith(prefix)) {
        violations.push({ rel, reason: `forbidden path prefix: ${prefix}` });
        break;
      }
    }
    if (forbiddenExactPaths.has(rel)) {
      violations.push({ rel, reason: 'forbidden deploy path' });
    }
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name) || entry.name.startsWith('~!')) continue;
      walk(full);
      continue;
    }
    for (const pat of forbiddenNamePatterns) {
      if (pat.test(entry.name)) {
        if (
          entry.name === 'config.example.php' ||
          entry.name.endsWith('.example')
        ) {
          // allowed templates
        } else {
          violations.push({ rel, reason: `forbidden filename: ${entry.name}` });
        }
      }
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!textExtensions.has(ext) && ext !== '') continue;
    if (entry.name.endsWith('.png') || entry.name.endsWith('.jpg')) continue;
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (
      rel.replace(/\\/g, '/').includes('scripts/publish-preflight.cjs') ||
      rel.includes('scripts/scan-win-unpacked-secrets.cjs')
    ) continue;
    if (rel.replace(/\\/g, '/').endsWith('public/api/sync_db.php') && /CREATE TABLE IF NOT EXISTS/i.test(content)) {
      violations.push({ rel, reason: 'sync_db.php must remain redacted (no schema DDL)' });
      continue;
    }
    if (rel.replace(/\\/g, '/').endsWith('public/api/config.example.php') && /define\s*\(\s*['"]DB_/i.test(content)) {
      violations.push({ rel, reason: 'config.example.php must remain redacted (no DB constants)' });
      continue;
    }
    if (content.length > 2_000_000) continue;
    for (const pat of forbiddenContentPatterns) {
      if (pat.test(content)) {
        violations.push({ rel, reason: `forbidden content: ${pat}` });
        break;
      }
    }
  }
}

walk(root);

if (violations.length) {
  console.error('publish-preflight FAILED:\n');
  for (const v of violations.slice(0, 50)) {
    console.error(`  ${v.rel} — ${v.reason}`);
  }
  if (violations.length > 50) {
    console.error(`  ... and ${violations.length - 50} more`);
  }
  process.exit(1);
}

console.log('publish-preflight OK — no forbidden artifacts detected.');
process.exit(0);
