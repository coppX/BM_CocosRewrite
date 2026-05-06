#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getChannelUploadSpec } from './channel-upload-specs.mjs';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_DIST_DIR = path.join(PROJECT_ROOT, 'dist-playable');
const CHANNELS = ['facebook', 'google', 'tiktok', 'mintegral', 'unityads', 'applovin', 'ironsource', 'kwai', 'vungle', 'snap'];
const UPLOAD_BUNDLE_DIRNAME = 'upload-bundles';
const UPLOAD_ZIP_DIRNAME = 'upload-zips';

function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function createDefaultOptions() {
  return {
    dir: DEFAULT_DIST_DIR,
    channels: CHANNELS.slice(),
    json: false,
    jsonOut: null,
    includeIronSourceSnippet: true,
    help: false,
  };
}

function normalizeChannelList(channels) {
  const values = Array.isArray(channels)
    ? channels
    : channels == null || channels === ''
      ? []
      : [channels];

  if (!values.length) return CHANNELS.slice();

  return Array.from(
    new Set(
      values
        .map((value) => String(value).trim().toLowerCase())
        .filter(Boolean)
    )
  ).filter((channel) => CHANNELS.includes(channel));
}

function normalizeOptions(rawOptions = {}) {
  const defaults = createDefaultOptions();
  const options = {
    ...defaults,
    ...rawOptions,
  };

  options.dir = options.dir
    ? (path.isAbsolute(String(options.dir)) ? String(options.dir) : path.resolve(PROJECT_ROOT, String(options.dir)))
    : defaults.dir;
  options.channels = normalizeChannelList(options.channels);
  options.json = Boolean(options.json);
  options.help = Boolean(options.help);
  options.includeIronSourceSnippet = options.includeIronSourceSnippet !== false;
  options.jsonOut = options.jsonOut
    ? (path.isAbsolute(String(options.jsonOut))
      ? String(options.jsonOut)
      : path.resolve(PROJECT_ROOT, String(options.jsonOut)))
    : null;

  return options;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = createDefaultOptions();
  options.channels = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dir':
        if (argv[i + 1]) {
          options.dir = String(argv[i + 1]);
          i += 1;
        }
        break;
      case '--channel':
        if (argv[i + 1]) {
          options.channels.push(String(argv[i + 1]));
          i += 1;
        }
        break;
      case '--json':
        options.json = true;
        break;
      case '--json-out':
        if (argv[i + 1]) {
          options.jsonOut = String(argv[i + 1]);
          i += 1;
        }
        break;
      case '--no-ironsource-snippet':
        options.includeIronSourceSnippet = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        break;
    }
  }

  return normalizeOptions(options);
}

function printHelp() {
  console.log(`Playable upload zip packer

Usage:
  node tools/playable/pack-upload-zips.mjs [options]

Options:
  --dir <path>                   Directory containing generated upload-bundles.
  --channel <name>               Pack a single channel. Repeatable.
  --json                         Print machine-readable JSON output.
  --json-out <path>              Write machine-readable JSON output to a file.
  --no-ironsource-snippet        Skip the extra snippet-only ironSource zip.
  --help, -h                     Show this help text.
`);
}

function formatMegabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(3);
}

function pad(value, width) {
  const text = String(value);
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function runPowerShell(command) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    }
  );

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim() || `PowerShell exited with code ${result.status}`;
    throw new Error(message);
  }

  return (result.stdout || '').trim();
}

function normalizeBundleEntry(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function listBundleRootEntries(bundleDir) {
  return fs.readdirSync(bundleDir)
    .sort((a, b) => a.localeCompare(b));
}

function listBundleFiles(bundleDir) {
  const out = [];
  const visit = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(absPath);
        continue;
      }
      out.push(normalizeBundleEntry(path.relative(bundleDir, absPath)));
    }
  };
  visit(bundleDir);
  return out.sort((a, b) => a.localeCompare(b));
}

function writeZipFromBundle(bundleDir, zipPath) {
  const files = listBundleFiles(bundleDir);
  if (!files.length) {
    throw new Error(`Upload bundle is empty: ${bundleDir}`);
  }

  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }

  const bundleDirEscaped = escapePowerShellSingleQuoted(bundleDir);
  const zipPathEscaped = escapePowerShellSingleQuoted(zipPath);
  const command = `& {
  $bundleDir = '${bundleDirEscaped}'
  $zipPath = '${zipPathEscaped}'
  $items = Get-ChildItem -LiteralPath $bundleDir -Force | Select-Object -ExpandProperty FullName
  if (-not $items -or $items.Count -eq 0) { throw 'Upload bundle is empty.' }
  Compress-Archive -LiteralPath $items -DestinationPath $zipPath -CompressionLevel Optimal -Force
}`;
  runPowerShell(command);
}

function writeZipFromSingleFile(filePath, zipPath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing upload file: ${filePath}`);
  }

  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }

  const filePathEscaped = escapePowerShellSingleQuoted(filePath);
  const zipPathEscaped = escapePowerShellSingleQuoted(zipPath);
  const command = `Compress-Archive -LiteralPath '${filePathEscaped}' -DestinationPath '${zipPathEscaped}' -CompressionLevel Optimal -Force`;
  runPowerShell(command);
}

function readZipEntries(zipPath) {
  const zipPathEscaped = escapePowerShellSingleQuoted(zipPath);
  const raw = runPowerShell(`& {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPathEscaped}')
  try {
    $entries = $zip.Entries | ForEach-Object { $_.FullName }
    $entries | ConvertTo-Json -Compress
  } finally {
    $zip.Dispose()
  }
}`);

  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed == null) return [];
  return [String(parsed)];
}

function readZipFileEntries(zipPath) {
  return readZipEntries(zipPath)
    .filter((entry) => {
      const raw = String(entry || '').replace(/\\/g, '/');
      return raw && !raw.endsWith('/');
    })
    .map((entry) => normalizeBundleEntry(entry))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function buildArtifactRecord(artifactId, channel, kind, purpose, zipPath, expectedEntries, extra = {}) {
  const zipStats = fs.statSync(zipPath);
  const entries = readZipFileEntries(zipPath);
  const expected = expectedEntries
    .map((entry) => normalizeBundleEntry(entry))
    .sort((a, b) => a.localeCompare(b));
  const actual = entries.slice().sort((a, b) => a.localeCompare(b));
  const entryMatch = expected.length === actual.length && expected.every((value, index) => value === actual[index]);

  if (!entryMatch) {
    throw new Error(`Zip file entries mismatch for ${artifactId}. Expected: ${expected.join(', ')}; actual: ${actual.join(', ')}`);
  }

  return {
    artifactId,
    channel,
    kind,
    purpose,
    zipPath,
    zipBytes: zipStats.size,
    zipMB: formatMegabytes(zipStats.size),
    entries: Array.isArray(extra.rootEntries) ? extra.rootEntries : entries,
    fileCount: entries.length,
    zipEntries: entries,
    expectedEntries,
    entryMatch,
    ...extra,
  };
}

function printSummary(report) {
  console.log('Playable upload zip summary');
  console.log(`Input dir: ${report.inputDir}`);
  console.log(`Zip dir: ${report.zipDir}`);
  console.log('');
  console.log(
    `${pad('Artifact', 20)}${pad('Type', 14)}${pad('SizeMB', 8)}${pad('Entries', 24)}Zip`
  );
  console.log('-'.repeat(108));
  for (const result of report.results) {
    console.log(
      `${pad(result.artifactId, 20)}${pad(result.kind, 14)}${pad(result.zipMB, 8)}${pad(result.entries.join(', '), 24)}${result.zipPath}`
    );
  }
}

export function packUploadZips(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const zipDir = path.join(options.dir, UPLOAD_ZIP_DIRNAME);
  fs.mkdirSync(zipDir, { recursive: true });

  const results = [];
  for (const channel of options.channels) {
    const uploadSpec = getChannelUploadSpec(channel);
    const bundleDir = path.join(options.dir, UPLOAD_BUNDLE_DIRNAME, channel);
    if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) {
      throw new Error(`Missing upload bundle directory for ${channel}: ${bundleDir}`);
    }

    const zipPath = path.join(zipDir, `${channel}.zip`);
    writeZipFromBundle(bundleDir, zipPath);
    const rootEntries = listBundleRootEntries(bundleDir);
    const entries = listBundleFiles(bundleDir);
    results.push(
      buildArtifactRecord(channel, channel, 'bundle', 'default-upload-bundle', zipPath, entries, {
        bundleDir,
        rootEntries,
        officialStatus: uploadSpec.officialStatus,
        note: uploadSpec.zipArtifactNote || null,
      })
    );

    if (channel === 'ironsource' && options.includeIronSourceSnippet) {
      const snippetPath = path.join(bundleDir, 'snippet.html');
      if (fs.existsSync(snippetPath)) {
        const snippetZipPath = path.join(zipDir, 'ironsource-snippet.zip');
        writeZipFromSingleFile(snippetPath, snippetZipPath);
        results.push(
          buildArtifactRecord(
            'ironsource-snippet',
            channel,
            'snippet',
            'snippet-only-upload',
            snippetZipPath,
            ['snippet.html'],
            {
              sourceFile: snippetPath,
              officialStatus: uploadSpec.officialStatus,
              note: 'Legacy helper only. Use this snippet artifact only if your ironSource intake path explicitly requests snippet content instead of the standard HTML asset upload.',
            }
          )
        );
      }
    }
  }

  const report = {
    inputDir: options.dir,
    zipDir,
    includeIronSourceSnippet: options.includeIronSourceSnippet,
    generatedAt: new Date().toISOString(),
    results,
  };

  if (options.jsonOut) {
    fs.mkdirSync(path.dirname(options.jsonOut), { recursive: true });
    fs.writeFileSync(options.jsonOut, JSON.stringify(report, null, 2), 'utf8');
  }

  return report;
}

function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const report = packUploadZips(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report);
  }
}

if (isMainModule()) {
  main();
}
