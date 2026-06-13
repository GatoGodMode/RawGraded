/**
 * Scan win-unpacked folders for credentials before FTP zip packaging.
 * secure-key.cjs is allowlisted (per-build AES obfuscation, not user/API secrets).
 *
 * Env:
 *   RAWGRADED_UNPACKED — default release-build/win-unpacked
 *   RAWINVESTOR_UNPACKED — default ../PriceChartingGradeRisk/rawengine/production/win-unpacked
 *   PCGR_RELEASE_SCAN_MD=1 — include .md files in scan
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const investorRoot = path.join(root, '..', 'PriceChartingGradeRisk');

const scanRoots = [
  {
    label: 'RawGraded Studio',
    dir: process.env.RAWGRADED_UNPACKED || path.join(root, 'release-build', 'win-unpacked'),
    required: true,
  },
  {
    label: 'Raw Investor',
    dir:
      process.env.RAWINVESTOR_UNPACKED ||
      path.join(investorRoot, 'rawengine', 'production', 'win-unpacked'),
    required: false,
  },
];

const allowlistedRelSuffixes = [
  'rawengine/secure-key.cjs',
  'app.asar.unpacked/rawengine/secure-key.cjs',
];

const forbiddenNamePatterns = [
  /\.env(\.|$)/i,
  /id_rsa/i,
  /id_dsa/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /credentials\.json$/i,
  /service-account/i,
  /signing\.local\.json$/i,
];

const forbiddenNamePatternsStrict = [/secret/i, /private[_-]?key/i];

const forbiddenContentPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{36}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AIza[0-9A-Za-z\-_]{35}/,
  /sk_live_[0-9A-Za-z]{10,}/,
  /sk_(?:test|live)_[0-9A-Za-z]{16,}/,
  /(?:token|secret|password)\s*[:=]\s*['"][^'"]{8,}['"]/i,
];

const textLikeExtensions = new Set([
  '.txt',
  '.json',
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.yml',
  '.yaml',
  '.md',
  '.xml',
  '.ini',
  '.cfg',
  '.conf',
  '.html',
  '.css',
  '.env',
  '.log',
]);

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
}

function isAllowlisted(normalizedRel) {
  return allowlistedRelSuffixes.some((s) => normalizedRel.endsWith(s) || normalizedRel.includes(`/${s}`));
}

function isIgnoredPath(normalizedRel) {
  const scanMd = String(process.env.PCGR_RELEASE_SCAN_MD || '').trim() === '1';
  return (
    normalizedRel.includes('/node_modules/') ||
    /\.test\.[cm]?[jt]sx?$/i.test(normalizedRel) ||
    normalizedRel.endsWith('.map') ||
    (!scanMd && normalizedRel.endsWith('.md'))
  );
}

function isLikelyText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (textLikeExtensions.has(ext)) return true;
  try {
    return fs.statSync(filePath).size <= 2 * 1024 * 1024;
  } catch {
    return false;
  }
}

function scanTree(scanRoot, label) {
  const findings = [];
  const files = [];
  walk(scanRoot, files);

  for (const filePath of files) {
    const rel = path.relative(scanRoot, filePath).replaceAll('\\', '/');
    if (isIgnoredPath(rel) || isAllowlisted(rel)) continue;

    const base = path.basename(filePath);
    for (const pattern of forbiddenNamePatterns) {
      if (pattern.test(base)) {
        findings.push(`[${label}][name] ${rel} matches ${pattern}`);
        break;
      }
    }
    for (const pattern of forbiddenNamePatternsStrict) {
      if (pattern.test(base)) {
        findings.push(`[${label}][name] ${rel} matches ${pattern}`);
        break;
      }
    }

    if (!isLikelyText(filePath)) continue;

    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const pattern of forbiddenContentPatterns) {
      if (pattern.test(content)) {
        findings.push(`[${label}][content] ${rel} matches ${pattern}`);
        break;
      }
    }
  }

  return { files: files.length, findings };
}

let totalFiles = 0;
const allFindings = [];
let scannedAny = false;

for (const { label, dir, required } of scanRoots) {
  if (!fs.existsSync(dir)) {
    if (required) {
      console.error(`[scan-win-unpacked-secrets] Missing required folder: ${dir}`);
      process.exit(1);
    }
    console.warn(`[scan-win-unpacked-secrets] SKIP ${label}: ${dir}`);
    continue;
  }
  scannedAny = true;
  const { files, findings } = scanTree(dir, label);
  totalFiles += files;
  allFindings.push(...findings);
  console.log(`[scan-win-unpacked-secrets] ${label}: scanned ${files} files under ${dir}`);
}

if (!scannedAny) {
  console.error('[scan-win-unpacked-secrets] No win-unpacked folders found to scan.');
  process.exit(1);
}

if (allFindings.length > 0) {
  console.error('[scan-win-unpacked-secrets] Potential secrets found:');
  for (const f of allFindings) console.error(` - ${f}`);
  process.exit(2);
}

console.log(`[scan-win-unpacked-secrets] OK: ${totalFiles} files, no forbidden secrets detected.`);
