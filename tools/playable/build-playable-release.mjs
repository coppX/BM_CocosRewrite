#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChannelUploadSpec } from './channel-upload-specs.mjs';
import { packSingleHtml } from './pack-single-html.mjs';
import { packUploadZips } from './pack-upload-zips.mjs';
import { verifyChannels } from './verify-channels.mjs';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, 'dist-playable');
const DEFAULT_REPORT_DIRNAME = 'reports';
const DEFAULT_SIZE_LIMIT_MB = 5;

function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function parseBooleanLike(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function createDefaultOptions() {
  return {
    outDir: DEFAULT_OUT_DIR,
    reportDir: null,
    blobCompression: 'gzip',
    useBase64: false,
    compressImages: true,
    imageFormat: 'webp',
    imageQuality: 30,
    imageMaxDimension: 0,
    sizeLimitBytes: Math.round(DEFAULT_SIZE_LIMIT_MB * 1024 * 1024),
    failOn: 'errors',
    includeIronSourceSnippet: true,
    json: false,
    help: false,
  };
}

function normalizeOptions(rawOptions = {}) {
  const defaults = createDefaultOptions();
  const options = {
    ...defaults,
    ...rawOptions,
  };

  options.outDir = options.outDir
    ? (path.isAbsolute(String(options.outDir)) ? String(options.outDir) : path.resolve(PROJECT_ROOT, String(options.outDir)))
    : defaults.outDir;
  options.reportDir = options.reportDir
    ? (path.isAbsolute(String(options.reportDir)) ? String(options.reportDir) : path.resolve(PROJECT_ROOT, String(options.reportDir)))
    : path.join(options.outDir, DEFAULT_REPORT_DIRNAME);
  options.useBase64 = parseBooleanLike(options.useBase64, defaults.useBase64);
  options.compressImages = parseBooleanLike(options.compressImages, defaults.compressImages);
  options.includeIronSourceSnippet = parseBooleanLike(options.includeIronSourceSnippet, defaults.includeIronSourceSnippet);
  options.imageQuality = Number.isFinite(options.imageQuality)
    ? Math.max(1, Math.min(100, Math.round(options.imageQuality)))
    : defaults.imageQuality;
  options.imageMaxDimension = Number.isFinite(options.imageMaxDimension)
    ? Math.max(0, Math.round(options.imageMaxDimension))
    : defaults.imageMaxDimension;

  if (!Number.isFinite(options.sizeLimitBytes) || options.sizeLimitBytes <= 0) {
    options.sizeLimitBytes = defaults.sizeLimitBytes;
  }

  if (!['errors', 'warnings', 'never'].includes(options.failOn)) {
    options.failOn = defaults.failOn;
  }

  options.json = Boolean(options.json);
  options.help = Boolean(options.help);
  return options;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = createDefaultOptions();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--out-dir':
      case '--dir':
        if (argv[i + 1]) {
          options.outDir = String(argv[i + 1]);
          i += 1;
        }
        break;
      case '--report-dir':
        if (argv[i + 1]) {
          options.reportDir = String(argv[i + 1]);
          i += 1;
        }
        break;
      case '--blob-compression':
        if (argv[i + 1]) {
          options.blobCompression = String(argv[i + 1]);
          i += 1;
        }
        break;
      case '--use-base64':
        if (argv[i + 1]) {
          options.useBase64 = argv[i + 1];
          i += 1;
        }
        break;
      case '--compress-images':
        if (argv[i + 1]) {
          options.compressImages = argv[i + 1];
          i += 1;
        }
        break;
      case '--image-format':
        if (argv[i + 1]) {
          options.imageFormat = String(argv[i + 1]);
          i += 1;
        }
        break;
      case '--image-quality':
        if (argv[i + 1]) {
          options.imageQuality = Number(argv[i + 1]);
          i += 1;
        }
        break;
      case '--image-max-dimension':
        if (argv[i + 1]) {
          options.imageMaxDimension = Number(argv[i + 1]);
          i += 1;
        }
        break;
      case '--size-limit-mb':
        if (argv[i + 1]) {
          const value = Number(argv[i + 1]);
          if (Number.isFinite(value) && value > 0) {
            options.sizeLimitBytes = Math.round(value * 1024 * 1024);
          }
          i += 1;
        }
        break;
      case '--fail-on':
        if (argv[i + 1]) {
          options.failOn = String(argv[i + 1]).trim().toLowerCase();
          i += 1;
        }
        break;
      case '--no-ironsource-snippet':
        options.includeIronSourceSnippet = false;
        break;
      case '--json':
        options.json = true;
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
  console.log(`Playable release builder

Usage:
  node tools/playable/build-playable-release.mjs [options]

Defaults:
  --blob-compression gzip
  --use-base64 false
  --image-format webp
  --image-quality 30
  --image-max-dimension 0
  --size-limit-mb ${DEFAULT_SIZE_LIMIT_MB}

Options:
  --out-dir <path>               Output directory for generated playable files.
  --report-dir <path>            Report directory. Default: <out-dir>/reports
  --blob-compression <mode>      none | gzip
  --use-base64 <bool>            true | false
  --compress-images <bool>       true | false
  --image-format <mode>          original | webp | jpeg
  --image-quality <n>            1-100
  --image-max-dimension <n>      Resize large textures before pack. 0 disables (recommended for Cocos atlas safety).
  --size-limit-mb <n>            HTML size ceiling used by verification.
  --fail-on <mode>               errors | warnings | never
  --no-ironsource-snippet        Skip the extra snippet-only ironSource zip.
  --json                         Print the final release report as JSON.
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

function groupUploadArtifacts(results) {
  const map = new Map();
  for (const result of results) {
    const list = map.get(result.channel) || [];
    list.push(result);
    map.set(result.channel, list);
  }
  return map;
}

function groupHtmlUploadArtifacts(packResult) {
  const map = new Map();
  const files = Array.isArray(packResult.uploadHtmlFiles) ? packResult.uploadHtmlFiles : [];
  for (const filePath of files) {
    const channel = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const uploadSpec = getChannelUploadSpec(channel);
    const stats = fs.statSync(filePath);
    const overSizeLimit = Number.isFinite(uploadSpec.htmlMaxBytes)
      && uploadSpec.htmlMaxBytes > 0
      && stats.size > uploadSpec.htmlMaxBytes;
    const note = overSizeLimit
      ? `${uploadSpec.htmlArtifactNote || 'Keep this standalone HTML for preview/debug.'} Current size is ${formatMegabytes(stats.size)} MB, above the configured ${formatMegabytes(uploadSpec.htmlMaxBytes)} MB single-file budget.`
      : (uploadSpec.htmlArtifactNote || null);
    map.set(channel, {
      channel,
      filePath,
      fileBytes: stats.size,
      fileMB: formatMegabytes(stats.size),
      purpose: overSizeLimit
        ? 'oversize-preview-html'
        : (uploadSpec.preferredPrimaryArtifact === 'html' ? 'preferred-upload-html' : 'single-html-upload'),
      officialStatus: uploadSpec.officialStatus,
      note,
      overSizeLimit,
    });
  }
  return map;
}

function buildPrimaryArtifact(uploadSpec, htmlPath, htmlUploadArtifact, uploadArtifacts) {
  const preferredZip = uploadArtifacts.find((artifact) => artifact.kind === 'bundle') || uploadArtifacts[0] || null;
  const htmlOverSizeLimit = Boolean(htmlUploadArtifact && htmlUploadArtifact.overSizeLimit);

  if (uploadSpec.preferredPrimaryArtifact === 'html' && htmlUploadArtifact && !htmlOverSizeLimit) {
    return {
      type: 'html',
      path: htmlUploadArtifact.filePath,
      sizeMB: htmlUploadArtifact.fileMB,
      purpose: htmlUploadArtifact.purpose,
      note: htmlUploadArtifact.note,
    };
  }

  if (uploadSpec.preferredPrimaryArtifact === 'html') {
    if (preferredZip && uploadSpec.acceptedFormats.includes('zip')) {
      return {
        type: 'zip',
        path: preferredZip.zipPath,
        sizeMB: preferredZip.zipMB,
        purpose: preferredZip.purpose,
        note: preferredZip.note || uploadSpec.reportNote || null,
      };
    }

    if (htmlUploadArtifact) {
      return {
        type: 'html',
        path: htmlUploadArtifact.filePath,
        sizeMB: htmlUploadArtifact.fileMB,
        purpose: htmlUploadArtifact.purpose,
        note: htmlUploadArtifact.note,
      };
    }

    return {
      type: 'html',
      path: htmlPath,
      sizeMB: null,
      purpose: 'generated-html',
      note: uploadSpec.htmlArtifactNote || uploadSpec.reportNote || null,
    };
  }

  if (!preferredZip) {
    return {
      type: 'html',
      path: htmlPath,
      sizeMB: null,
      purpose: 'generated-html',
      note: null,
    };
  }

  return {
    type: 'zip',
    path: preferredZip.zipPath,
    sizeMB: preferredZip.zipMB,
    purpose: preferredZip.purpose,
    note: preferredZip.note || null,
  };
}

function buildReleaseReport(packResult, verificationReport, uploadZipReport, reportPaths) {
  const uploadArtifactsByChannel = groupUploadArtifacts(uploadZipReport.results);
  const htmlUploadArtifactsByChannel = groupHtmlUploadArtifacts(packResult);
  const channels = verificationReport.results.map((result) => ({
    uploadSpec: getChannelUploadSpec(result.channel),
    channel: result.channel,
    status: result.status,
    htmlPath: result.filePath,
    htmlBytes: result.sizeBytes,
    htmlMB: result.sizeMB,
    errors: result.checks.filter((check) => check.severity === 'error').length,
    warnings: result.checks.filter((check) => check.severity === 'warn').length,
    htmlUploadArtifact: htmlUploadArtifactsByChannel.get(result.channel) || null,
    uploadArtifacts: (uploadArtifactsByChannel.get(result.channel) || []).map((artifact) => ({
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      purpose: artifact.purpose,
      zipPath: artifact.zipPath,
      zipBytes: artifact.zipBytes,
      zipMB: artifact.zipMB,
      entries: artifact.entries,
      note: artifact.note || null,
    })),
  })).map((channelReport) => ({
    ...channelReport,
    primaryArtifact: buildPrimaryArtifact(
      channelReport.uploadSpec,
      channelReport.htmlPath,
      channelReport.htmlUploadArtifact,
      channelReport.uploadArtifacts
    ),
  }));

  return {
    generatedAt: new Date().toISOString(),
    outputDir: packResult.outDir,
    reportDir: path.dirname(reportPaths.releaseReportPath),
    projectOrientation: packResult.projectOrientation,
    pack: packResult,
    verification: verificationReport,
    uploadZips: uploadZipReport,
    channels,
    reportPaths,
  };
}

function printSummary(releaseReport, reportPaths) {
  console.log('Playable release summary');
  console.log(`Output dir: ${releaseReport.outputDir}`);
  console.log(`Report dir: ${path.dirname(reportPaths.releaseReportPath)}`);
  console.log('');
  console.log(
    `${pad('Channel', 12)}${pad('Status', 8)}${pad('HTML', 8)}${pad('Primary', 10)}${pad('Formats', 20)}Artifacts`
  );
  console.log('-'.repeat(116));
  for (const channel of releaseReport.channels) {
    const artifactText = channel.uploadArtifacts
      .map((artifact) => `${artifact.artifactId}:${artifact.zipMB}MB`)
      .join(', ');
    console.log(
      `${pad(channel.channel, 12)}${pad(channel.status, 8)}${pad(channel.htmlMB, 8)}${pad(channel.primaryArtifact.type, 10)}${pad(channel.uploadSpec.acceptedFormats.join('/'), 20)}${artifactText}`
    );
  }
  console.log('');
  console.log(`Verification report: ${reportPaths.verificationReportPath}`);
  console.log(`Upload zip report:   ${reportPaths.uploadZipReportPath}`);
  console.log(`Release report:      ${reportPaths.releaseReportPath}`);
}

export async function buildPlayableRelease(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  fs.mkdirSync(options.outDir, { recursive: true });
  fs.mkdirSync(options.reportDir, { recursive: true });

  const packResult = await packSingleHtml({
    outDir: options.outDir,
    useBase64: options.useBase64,
    blobCompression: options.blobCompression,
    compressImages: options.compressImages,
    imageQuality: options.imageQuality,
    imageFormat: options.imageFormat,
    imageMaxDimension: options.imageMaxDimension,
  });

  const verification = verifyChannels({
    dir: options.outDir,
    sizeLimitBytes: options.sizeLimitBytes,
    failOn: options.failOn,
    summaryOnly: false,
  });

  const uploadZips = packUploadZips({
    dir: options.outDir,
    includeIronSourceSnippet: options.includeIronSourceSnippet,
  });

  const reportPaths = {
    verificationReportPath: path.join(options.reportDir, 'verification.json'),
    uploadZipReportPath: path.join(options.reportDir, 'upload-zips.json'),
    releaseReportPath: path.join(options.reportDir, 'release-report.json'),
  };

  fs.writeFileSync(reportPaths.verificationReportPath, JSON.stringify(verification.report, null, 2), 'utf8');
  fs.writeFileSync(reportPaths.uploadZipReportPath, JSON.stringify(uploadZips, null, 2), 'utf8');

  const releaseReport = buildReleaseReport(packResult, verification.report, uploadZips, reportPaths);
  fs.writeFileSync(reportPaths.releaseReportPath, JSON.stringify(releaseReport, null, 2), 'utf8');

  return {
    options,
    packResult,
    verification,
    uploadZips,
    releaseReport,
    reportPaths,
    failed: verification.failed,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const result = await buildPlayableRelease(options);
  if (options.json) {
    console.log(JSON.stringify(result.releaseReport, null, 2));
  } else {
    printSummary(result.releaseReport, result.reportPaths);
    const totalZipSize = result.uploadZips.results.reduce((sum, artifact) => sum + artifact.zipBytes, 0);
    console.log(`[build-playable-release] uploadZipArtifacts=${result.uploadZips.results.length} totalZipMB=${formatMegabytes(totalZipSize)}`);
    console.log(`[build-playable-release] verification=${result.failed ? 'FAIL' : 'PASS'} failOn=${options.failOn}`);
  }

  process.exitCode = result.failed ? 1 : 0;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error('[build-playable-release] failed:', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
