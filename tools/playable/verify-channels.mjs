#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_DIST_DIR = path.join(PROJECT_ROOT, 'dist-playable');
const CHANNELS = ['facebook', 'google', 'tiktok', 'mintegral', 'unityads', 'applovin', 'ironsource', 'kwai', 'vungle', 'snap'];
const DEFAULT_SIZE_LIMIT_MB = 5;
const FACEBOOK_SINGLE_HTML_LIMIT_BYTES = 2 * 1024 * 1024;
const UPLOAD_BUNDLE_DIRNAME = 'upload-bundles';
const PROJECT_ORIENTATION_BOTH = 'both';
const PROJECT_ORIENTATION_PORTRAIT = 'portrait';
const PROJECT_ORIENTATION_LANDSCAPE = 'landscape';
const ALLOWED_EXTERNAL_REFS = {
  tiktok: [
    /^https:\/\/sf16-sg\.tiktokcdn\.com\/obj\/union-fe-nc-i18n\/playable\/sdk\/playable-sdk\.js(?:\?.*)?$/i,
  ],
};

let inferredProjectOrientation = null;

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
    summaryOnly: false,
    sizeLimitBytes: Math.round(DEFAULT_SIZE_LIMIT_MB * 1024 * 1024),
    failOn: 'errors',
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

function normalizeVerifyOptions(rawOptions = {}) {
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
  options.summaryOnly = Boolean(options.summaryOnly);
  options.help = Boolean(options.help);

  if (!Number.isFinite(options.sizeLimitBytes) || options.sizeLimitBytes <= 0) {
    options.sizeLimitBytes = defaults.sizeLimitBytes;
  }

  if (!['errors', 'warnings', 'never'].includes(options.failOn)) {
    options.failOn = defaults.failOn;
  }

  options.jsonOut = options.jsonOut
    ? (path.isAbsolute(String(options.jsonOut))
      ? String(options.jsonOut)
      : path.resolve(PROJECT_ROOT, String(options.jsonOut)))
    : null;

  return options;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = createDefaultOptions();
  options.channels = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dir':
        if (argv[i + 1]) {
          const raw = String(argv[i + 1]);
          options.dir = path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
          i += 1;
        }
        break;
      case '--channel':
        if (argv[i + 1]) {
          options.channels.push(String(argv[i + 1]).trim().toLowerCase());
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
      case '--summary-only':
        options.summaryOnly = true;
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
          const value = String(argv[i + 1]).trim().toLowerCase();
          if (value === 'errors' || value === 'warnings' || value === 'never') {
            options.failOn = value;
          }
          i += 1;
        }
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        break;
    }
  }

  return normalizeVerifyOptions(options);
}

function printHelp() {
  console.log(`Playable channel verifier

Usage:
  node tools/playable/verify-channels.mjs [options]

Options:
  --dir <path>             Directory containing generated playable html files.
  --channel <name>         Verify a single channel. Repeatable.
  --json                   Print machine-readable JSON output.
  --json-out <path>        Write machine-readable JSON output to a file.
  --summary-only           Skip detailed findings and print only the summary table.
  --size-limit-mb <n>      Maximum allowed html size in MB. Default: ${DEFAULT_SIZE_LIMIT_MB}.
  --fail-on <mode>         errors | warnings | never. Default: errors.
  --help, -h               Show this help text.
`);
}

function createCheck(severity, code, message) {
  return { severity, code, message };
}

function severityRank(severity) {
  if (severity === 'error') return 2;
  if (severity === 'warn') return 1;
  return 0;
}

function statusFromChecks(checks) {
  if (checks.some((check) => check.severity === 'error')) return 'FAIL';
  if (checks.some((check) => check.severity === 'warn')) return 'WARN';
  return 'PASS';
}

function formatMegabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(3);
}

function pad(value, width) {
  const text = String(value);
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

function countBySeverity(checks, severity) {
  return checks.filter((check) => check.severity === severity).length;
}

function readHtml(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function inferProjectOrientation() {
  if (inferredProjectOrientation) return inferredProjectOrientation;

  const scenePath = path.join(PROJECT_ROOT, 'assets', 'scenes', 'scene.scene');
  if (!fs.existsSync(scenePath)) {
    inferredProjectOrientation = PROJECT_ORIENTATION_BOTH;
    return inferredProjectOrientation;
  }

  const sceneText = fs.readFileSync(scenePath, 'utf8');
  const matches = Array.from(sceneText.matchAll(/"_contentSize"\s*:\s*\{[\s\S]*?"width"\s*:\s*(\d+(?:\.\d+)?)[\s,]*[\s\S]*?"height"\s*:\s*(\d+(?:\.\d+)?)/g));
  if (!matches.length) {
    inferredProjectOrientation = PROJECT_ORIENTATION_BOTH;
    return inferredProjectOrientation;
  }

  let width = 0;
  let height = 0;
  let area = 0;
  for (const match of matches) {
    const nextWidth = Number(match[1]);
    const nextHeight = Number(match[2]);
    const nextArea = nextWidth * nextHeight;
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth <= 0 || nextHeight <= 0) {
      continue;
    }
    if (nextArea > area) {
      width = nextWidth;
      height = nextHeight;
      area = nextArea;
    }
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    inferredProjectOrientation = PROJECT_ORIENTATION_BOTH;
    return inferredProjectOrientation;
  }

  if (width > height) {
    inferredProjectOrientation = PROJECT_ORIENTATION_LANDSCAPE;
  } else if (height > width) {
    inferredProjectOrientation = PROJECT_ORIENTATION_PORTRAIT;
  } else {
    inferredProjectOrientation = PROJECT_ORIENTATION_BOTH;
  }

  return inferredProjectOrientation;
}

function listBundleFiles(bundleDir) {
  if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) {
    return [];
  }

  const files = [];
  const visit = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(absPath);
        continue;
      }
      files.push(path.relative(bundleDir, absPath).split(path.sep).join('/'));
    }
  };
  visit(bundleDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function getUploadBundleInfo(filePath, channel) {
  const bundleDir = path.join(path.dirname(filePath), UPLOAD_BUNDLE_DIRNAME, channel);
  const indexPath = path.join(bundleDir, 'index.html');
  const configPath = path.join(bundleDir, 'config.json');
  const snippetPath = path.join(bundleDir, 'snippet.html');
  const bundleExists = fs.existsSync(bundleDir) && fs.statSync(bundleDir).isDirectory();
  const fileEntries = listBundleFiles(bundleDir);
  return {
    bundleDir,
    indexPath,
    configPath,
    snippetPath,
    bundleExists,
    hasIndex: fs.existsSync(indexPath),
    hasConfig: fs.existsSync(configPath),
    hasSnippet: fs.existsSync(snippetPath),
    rootEntries: bundleExists ? fs.readdirSync(bundleDir).sort((a, b) => a.localeCompare(b)) : [],
    fileEntries,
    config: readJson(configPath),
  };
}

function extractScriptBodies(html) {
  const scriptBodies = [];
  const regex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const typeMatch = /type\s*=\s*['"]([^'"]+)['"]/i.exec(attrs);
    const type = typeMatch ? typeMatch[1] : 'text/javascript';
    if (type === 'systemjs-importmap' || type === 'application/octet-stream' || /^text\/x-pack(?:-|$)/i.test(type)) continue;
    if (!body.trim()) continue;
    scriptBodies.push({ type, body });
  }
  return scriptBodies;
}

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function compileInlineScripts(html) {
  const scriptBodies = extractScriptBodies(html);
  const failures = [];
  for (let i = 0; i < scriptBodies.length; i += 1) {
    const script = scriptBodies[i];
    try {
      // Compile-only validation of inline JavaScript.
      // eslint-disable-next-line no-new-func
      new Function(script.body);
    } catch (error) {
      failures.push(
        createCheck(
          'error',
          'inline-script-syntax',
          `Inline script #${i + 1} (${script.type}) has invalid syntax: ${error.message}`
        )
      );
    }
  }
  return failures;
}

function isAllowedExternalRef(channel, url) {
  const allowList = ALLOWED_EXTERNAL_REFS[channel] || [];
  return allowList.some((pattern) => pattern.test(url));
}

function findExternalAssetRefs(channel, html) {
  const findings = [];
  const cleanHtml = stripHtmlComments(html);
  const regex = /<(script|link|img|audio|video|source)\b[^>]*(src|href)\s*=\s*['"]([^'"]+)['"][^>]*>/gi;
  let match;
  while ((match = regex.exec(cleanHtml))) {
    const url = match[3].trim();
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('#')) {
      continue;
    }
    if (isAllowedExternalRef(channel, url)) {
      continue;
    }
    findings.push(
      createCheck(
        'error',
        'external-asset-ref',
        `Found non-inlined asset reference: ${url}`
      )
    );
  }
  return findings;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readBalancedBlock(source, openBraceIndex) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  let bodyStart = openBraceIndex + 1;

  for (let i = openBraceIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (i === openBraceIndex) {
      depth = 1;
      bodyStart = i + 1;
      continue;
    }

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inSingle) {
      if (!escaped && char === "'") inSingle = false;
      escaped = !escaped && char === '\\';
      continue;
    }

    if (inDouble) {
      if (!escaped && char === '"') inDouble = false;
      escaped = !escaped && char === '\\';
      continue;
    }

    if (inTemplate) {
      if (!escaped && char === '`') inTemplate = false;
      escaped = !escaped && char === '\\';
      continue;
    }

    escaped = false;

    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, i);
      }
    }
  }

  return '';
}

function extractFunctionBody(source, anchorRegex, methodRegex) {
  const anchor = anchorRegex.exec(source);
  if (!anchor) return '';
  const from = source.slice(anchor.index);
  const method = methodRegex.exec(from);
  if (!method) return '';
  const fullMatch = method[0];
  const braceOffset = fullMatch.lastIndexOf('{');
  if (braceOffset < 0) return '';
  const openBraceIndex = anchor.index + method.index + braceOffset;
  return readBalancedBlock(source, openBraceIndex);
}

function findCommonChecks(channel, html, filePath, fileSize, sizeLimitBytes) {
  const checks = [];
  const bundleInfo = getUploadBundleInfo(filePath, channel);
  const projectOrientation = inferProjectOrientation();
  if (!html.startsWith('<!DOCTYPE html>')) {
    checks.push(createCheck('warn', 'doctype', 'Document does not start with <!DOCTYPE html>.'));
  }

  if (fileSize > sizeLimitBytes) {
    checks.push(
      createCheck(
        'error',
        'size-limit',
        `File size ${formatMegabytes(fileSize)} MB exceeds limit ${formatMegabytes(sizeLimitBytes)} MB.`
      )
    );
  }

  checks.push(...compileInlineScripts(html));
  checks.push(...findExternalAssetRefs(channel, html));

  if (!/window\.__CHANNEL__\s*=\s*["'][^"']+["'];/.test(html)) {
    checks.push(createCheck('warn', 'channel-marker', 'Missing injected window.__CHANNEL__ marker.'));
  }

  if (!/(?:window|globalThis|global)\.PlayableSDK\s*=/.test(html)) {
    checks.push(createCheck('error', 'bridge-missing', 'Missing PlayableSDK bridge assignment.'));
  }

  if (/(?:\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bnavigator\.sendBeacon\s*\(|\bimportScripts\s*\()/i.test(html)) {
    checks.push(
      createCheck(
        'info',
        'network-api',
        'Found active network API usage. Some playable channels restrict runtime network requests and dynamic loading.'
      )
    );
  }

  if (channel === 'ironsource' && /^<!DOCTYPE html>/i.test(html)) {
    if (!bundleInfo.hasSnippet) {
      checks.push(
        createCheck(
          'warn',
          'ironsource-packaging',
          'Current artifact is a full HTML document. ironSource MRAID uploads often require a raw HTML/JS snippet instead of a complete page.'
        )
      );
    }
  }

  if ((channel === 'tiktok' || channel === 'snap') && !bundleInfo.hasIndex) {
    checks.push(
      createCheck(
        'warn',
        `${channel}-bundle-index`,
        `Missing upload bundle index.html at ${bundleInfo.indexPath}.`
      )
    );
  }

  if (channel === 'tiktok') {
    if (!bundleInfo.hasConfig) {
      checks.push(
        createCheck(
          'warn',
          'tiktok-config',
          'No upload-bundles/tiktok/config.json found. TikTok playable uploads normally require config.json with playable_orientation.'
        )
      );
    } else if (!bundleInfo.config || ![0, 1, 2].includes(bundleInfo.config.playable_orientation)) {
      checks.push(
        createCheck(
          'warn',
          'tiktok-config-value',
          'TikTok config.json is missing a valid playable_orientation value (0, 1, or 2).'
        )
      );
    }
  }

  if (channel === 'snap') {
    if (!bundleInfo.hasConfig) {
      checks.push(
        createCheck(
          'warn',
          'snap-config',
          'No upload-bundles/snap/config.json found. Snap App Playables usually need config.json in the final upload bundle.'
        )
      );
    } else if (!bundleInfo.config || bundleInfo.config.orientation !== 1) {
      checks.push(
        createCheck(
          'warn',
          'snap-config-value',
          'Snap config.json should set orientation to 1 for portrait mode.'
        )
      );
    }
    if (
      projectOrientation === PROJECT_ORIENTATION_LANDSCAPE &&
      !/__PLAYABLE_PORTRAIT_SHELL__\s*=\s*['"]snap['"]/.test(html) &&
      !/data-playable-shell=["']snap-portrait["']/.test(html)
    ) {
      checks.push(
        createCheck(
          'warn',
          'snap-portrait-only',
          'Project scene appears landscape, but Snap App Playables supports portrait orientation only. This bundle still needs portrait-safe layout validation.'
        )
      );
    }
  }

  return checks;
}

function verifyFacebook(html, filePath) {
  const checks = [];
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  const bundleInfo = getUploadBundleInfo(filePath, 'facebook');
  const bundleFiles = bundleInfo.fileEntries;
  const ctaBody = extractFunctionBody(
    html,
    /window\.FbPlayableAd\s*=\s*window\.FbPlayableAd\s*\|\|\s*\{\};?/,
    /onCTAClick\s*=\s*function\s*\(url\)\s*\{/
  );
  if (htmlBytes > FACEBOOK_SINGLE_HTML_LIMIT_BYTES) {
    checks.push(
      createCheck(
        'warn',
        'facebook-html-oversize',
        `Standalone Facebook HTML is ${(htmlBytes / (1024 * 1024)).toFixed(3)} MB, which exceeds the 2 MB single-file Meta HTML budget. Prefer the generated zip upload for Meta.`
      )
    );
  }

  if (
    /https:\/\/playable\.invalid\//.test(html)
    || /__PLAYABLE_IMPORTMAP_FALLBACK_SOURCE__\s*=\s*["']src\/import-map\.json["']/.test(html)
    || /System\.import\((['"])\.\/index\.js\1\)/.test(html)
  ) {
    checks.push(
      createCheck(
        'warn',
        'facebook-virtual-inline-refs',
        'Facebook standalone HTML still exposes virtual module or fallback resource identifiers. Meta upload validation can treat these as non-self-contained references and fail the HTML upload even when the playable runs locally.'
      )
    );
  }
  if (!/window\.FbPlayableAd\s*=/.test(html)) {
    checks.push(createCheck('error', 'facebook-bridge', 'Missing FbPlayableAd bridge object.'));
  }
  if (!/onCTAClick\s*=/.test(html) && !/onCTAClick\s*:/.test(html)) {
    checks.push(createCheck('error', 'facebook-cta', 'Missing FbPlayableAd.onCTAClick CTA handler.'));
  }
  if (!/__PLAYABLE_FACEBOOK_META_COMPAT__\s*=\s*true/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'facebook-meta-compat',
        'Missing injected Facebook Meta compatibility guard. Preview can pause when the iframe reports an early hidden or blur state.'
      )
    );
  }
  if (!/__PLAYABLE_FACEBOOK_RUNTIME_PATCH__\s*=/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'facebook-runtime-patch',
        'Missing injected Facebook runtime patch marker. Preview can still pause if the host delivers blur, pagehide, or visibility events during load.'
      )
    );
  }
  if (!/__PLAYABLE_FACEBOOK_NOTIFY_READY__\s*=/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'facebook-ready-notifier',
        'Missing global Facebook ready notifier. Meta preview recovery is more reliable when the runtime can re-send ready signals after focus, message, or pageshow events.'
      )
    );
  }
  if (!bundleInfo.bundleExists || !bundleInfo.hasIndex) {
    checks.push(
      createCheck(
        'warn',
        'facebook-runtime-bundle-shape',
        'Facebook upload bundle should contain a root index.html so Meta can ingest the playable as a normal self-contained zip.'
      )
    );
  }
  if (
    bundleFiles.includes('pack/manifest.js')
    || bundleFiles.some((entry) => /^pack\/chunks\/chunk-\d+\.js$/i.test(entry))
  ) {
    checks.push(
      createCheck(
        'warn',
        'facebook-external-pack-assets',
        'Facebook upload bundle still contains external pack manifest/chunk scripts. Meta upload validation has been more reliable when the zip stays self-contained with a root index.html only.'
      )
    );
  }
  const hasContainerUrlCompat = /canonicalizePackUrl\s*\(/.test(html)
    || /__PLAYABLE_PACK_BASE_COMPAT__/.test(html)
    || /__PLAYABLE_IMPORTMAP_FALLBACK_INSTALLED__/.test(html)
    || /PACK_AVOID_OBJECT_URL\s*=\s*true/.test(html);
  if (!hasContainerUrlCompat) {
    checks.push(
      createCheck(
        'warn',
        'facebook-container-url-compat',
        'Facebook output is missing the srcdoc/blob container URL compatibility patch. Meta-style iframe hosts often rewrite playable URLs to about:srcdoc or blob: URLs.'
      )
    );
  }
  if (!/PACK_AVOID_OBJECT_URL\s*=\s*true/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'facebook-objecturl-avoidance',
        'Facebook output is missing the object URL avoidance flag. Meta preview containers can reject blob/objectURL-backed resource loads even when the playable works in a normal browser tab.'
      )
    );
  }
  if (/\bcreateObjectURL\b/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'facebook-objecturl-literal',
        'Facebook output still contains a literal createObjectURL usage. Prefer data URL or inline resource fallbacks for Meta container compatibility.'
      )
    );
  }
  if (/<script[^>]+type=["']application\/octet-stream["']/i.test(html)) {
    checks.push(
      createCheck(
        'error',
        'facebook-octet-stream-data-script',
        'Facebook HTML still embeds data payloads inside application/octet-stream script tags. Meta upload validation can misread these blocks and fail with Invalid JSON.'
      )
    );
  }
  if (!/patchAddEventListener\(document,\s*\['visibilitychange',\s*'webkitvisibilitychange',\s*'msvisibilitychange',\s*'pagehide'\]/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'facebook-document-pagehide-guard',
        'Facebook runtime patch is not blocking document-level pagehide listeners. Cocos web builds often register pagehide on both window and document.'
      )
    );
  }
  if (!/pauseByEngine/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'facebook-engine-pause-guard',
        'Facebook output does not appear to guard Cocos pauseByEngine. A host-triggered hide/pagehide can still stop the playable even if direct pause calls are patched.'
      )
    );
  }
  if (/\bnavigateTo\s*\(/.test(ctaBody) || /window\.location(?:\.href)?\s*=|window\.open\s*\(/.test(ctaBody)) {
    checks.push(
      createCheck(
        'error',
        'facebook-cta-direct-redirect',
        'Facebook CTA flow still contains a direct JavaScript redirect fallback. Prefer host-only FbPlayableAd CTA handling.'
      )
    );
  }
  if (/window\.location(?:\.href)?\s*=|window\.open\s*\(/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'facebook-js-redirect-literal',
        'Facebook output still contains literal JavaScript redirect helpers, which can trigger Meta upload warnings.'
      )
    );
  }
  if (/\bXMLHttpRequest\b/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'facebook-xhr-literal',
        'Facebook output still contains a literal XMLHttpRequest hook, which can trigger Meta upload warnings.'
      )
    );
  }
  return checks;
}

function verifyGoogle(html) {
  const checks = [];
  if (!/window\.ExitApi\s*=/.test(html) || !/exit:\s*function/.test(html)) {
    checks.push(createCheck('error', 'google-exitapi', 'Missing ExitApi.exit implementation.'));
  }
  if (!/adReady/.test(html)) {
    checks.push(createCheck('warn', 'google-ready', 'No adReady signal found for Google host.'));
  }
  return checks;
}

function verifyTikTok(html) {
  const checks = [];
  if (!/window\.TikTokPlayableSDK\s*=/.test(html)) {
    checks.push(createCheck('error', 'tiktok-bridge', 'Missing TikTokPlayableSDK bridge object.'));
  }
  if (!/openAppStore/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'tiktok-open-app-store',
        'TikTok output does not appear to call the official openAppStore host bridge.'
      )
    );
  }
  if (!/sf16-sg\.tiktokcdn\.com\/obj\/union-fe-nc-i18n\/playable\/sdk\/playable-sdk\.js/i.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'tiktok-js-sdk',
        'TikTok output is missing the official playable-sdk.js reference.'
      )
    );
  }
  if (/mraid\.js/i.test(html)) {
    checks.push(createCheck('error', 'tiktok-mraid-js', 'Found mraid.js reference. TikTok playable uploads should not include mraid.js.'));
  }
  const openBody = extractFunctionBody(
    html,
    new RegExp(`channel:\\s*['"]${escapeRegExp('tiktok')}['"]`),
    /open:\s*function\s*\(url\)\s*\{/
  );
  if (/\bnavigateTo\s*\(|window\.location(?:\.href)?\s*=|window\.open\s*\(/.test(openBody)) {
    checks.push(
      createCheck(
        'error',
        'tiktok-js-redirect',
        'TikTok adapter open flow still performs a direct page jump. Prefer the channel JS SDK authorization path instead of JavaScript redirects.'
      )
    );
  }
  return checks;
}

function verifyMintegral(html) {
  const checks = [];
  if (!/window\.mraid\s*=/.test(html)) {
    checks.push(createCheck('error', 'mintegral-mraid', 'Missing MRAID bridge for Mintegral.'));
  }
  if (!/fireEvent\('ready'\)/.test(html)) {
    checks.push(createCheck('warn', 'mintegral-ready', 'No explicit mraid ready event found.'));
  }
  return checks;
}

function verifyUnityAds(html) {
  const checks = [];
  if (!/window\.mraid\s*=/.test(html)) {
    checks.push(createCheck('error', 'unity-mraid', 'Missing MRAID bridge for Unity Ads.'));
  }
  if (!/getPlacementType/.test(html)) {
    checks.push(createCheck('warn', 'unity-placement', 'Missing getPlacementType implementation.'));
  }
  if (!/viewableChange/.test(html) && /System\.import\((['"])\.\/index\.js\1\)/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'unity-viewable-change',
        'No viewableChange gating detected before game boot. Unity playable guidelines usually expect the experience to wait until the ad becomes viewable.'
      )
    );
  }
  return checks;
}

function verifyAppLovin(html) {
  const checks = [];
  if (!/window\.mraid\s*=/.test(html)) {
    checks.push(createCheck('error', 'applovin-mraid', 'Missing MRAID bridge for AppLovin.'));
  }
  if (!/viewableChange/.test(html)) {
    checks.push(createCheck('warn', 'applovin-viewable', 'Missing viewableChange event trigger for AppLovin.'));
  }
  return checks;
}

function verifyIronSource(html) {
  const checks = [];
  if (!/window\.mraid\s*=/.test(html)) {
    checks.push(createCheck('error', 'ironsource-mraid', 'Missing MRAID bridge for ironSource.'));
  }
  return checks;
}

function verifyKwai(html) {
  const checks = [];
  if (!/window\.KwaiPlayable\s*=/.test(html)) {
    checks.push(createCheck('error', 'kwai-bridge', 'Missing KwaiPlayable bridge object.'));
  }
  if (!/type:\s*['"]kwai_playable['"]/.test(html)) {
    checks.push(createCheck('warn', 'kwai-postmessage', 'No kwai_playable postMessage envelope found.'));
  }
  return checks;
}

function verifyVungle(html) {
  const checks = [];
  if (!/window\.mraid\s*=/.test(html)) {
    checks.push(createCheck('error', 'vungle-mraid', 'Missing MRAID bridge for Vungle.'));
  }
  const mraidOpenBody = extractFunctionBody(
    html,
    /window\.mraid\s*=\s*window\.mraid\s*\|\|\s*\{/,
    /open:\s*function\s*\(url\)\s*\{/
  );
  if (/\bnavigateTo\s*\(|window\.location(?:\.href)?\s*=/.test(mraidOpenBody)) {
    checks.push(
      createCheck(
        'warn',
        'vungle-location-jump',
        'Vungle MRAID open path still contains a direct location jump fallback. Prefer mraid.open or a host-approved clickthrough bridge.'
      )
    );
  }
  return checks;
}

function verifySnap(html) {
  const checks = [];
  if (!/ScPlayableAd\.onCTAClick/.test(html)) {
    checks.push(
      createCheck(
        'error',
        'snap-official-cta',
        'Missing official ScPlayableAd.onCTAClick CTA bridge. Current output does not expose the Snap host API expected by App Playables.'
      )
    );
  }
  if (/window\.snapPlayable\s*=/.test(html) && !/ScPlayableAd\.onCTAClick/.test(html)) {
    checks.push(
      createCheck(
        'warn',
        'snap-custom-bridge',
        'Found only a custom snapPlayable bridge. Keep it only as a fallback, not as the primary Snap integration contract.'
      )
    );
  }
  const openBody = extractFunctionBody(
    html,
    new RegExp(`channel:\\s*['"]${escapeRegExp('snap')}['"]`),
    /open:\s*function\s*\(url\)\s*\{/
  );
  if (/\bnavigateTo\s*\(|window\.location(?:\.href)?\s*=|window\.open\s*\(/.test(openBody)) {
    checks.push(
      createCheck(
        'warn',
        'snap-direct-jump',
        'Snap adapter open flow still performs a direct page jump. Prefer routing CTA through the official host bridge first.'
      )
    );
  }
  return checks;
}

const CHANNEL_VERIFIERS = {
  facebook: verifyFacebook,
  google: verifyGoogle,
  tiktok: verifyTikTok,
  mintegral: verifyMintegral,
  unityads: verifyUnityAds,
  applovin: verifyAppLovin,
  ironsource: verifyIronSource,
  kwai: verifyKwai,
  vungle: verifyVungle,
  snap: verifySnap,
};

function verifyChannel(channel, filePath, options) {
  const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  const html = readHtml(filePath);
  const checks = [];

  if (html == null) {
    checks.push(createCheck('error', 'missing-file', `Missing generated file: ${filePath}`));
    return {
      channel,
      filePath,
      sizeBytes: 0,
      sizeMB: '0.000',
      status: 'FAIL',
      checks,
    };
  }

  checks.push(...findCommonChecks(channel, html, filePath, fileSize, options.sizeLimitBytes));
  const verifier = CHANNEL_VERIFIERS[channel];
  if (typeof verifier === 'function') {
    checks.push(...verifier(html, filePath, channel));
  }

  checks.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.code.localeCompare(b.code));

  return {
    channel,
    filePath,
    sizeBytes: fileSize,
    sizeMB: formatMegabytes(fileSize),
    status: statusFromChecks(checks),
    checks,
  };
}

function printSummary(results, options) {
  console.log(`Playable verification summary`);
  console.log(`Input dir: ${options.dir}`);
  console.log(`Size limit: ${formatMegabytes(options.sizeLimitBytes)} MB`);
  console.log('');
  console.log(
    `${pad('Channel', 12)}${pad('Status', 8)}${pad('Errors', 8)}${pad('Warns', 8)}${pad('SizeMB', 8)}File`
  );
  console.log('-'.repeat(88));
  for (const result of results) {
    console.log(
      `${pad(result.channel, 12)}${pad(result.status, 8)}${pad(countBySeverity(result.checks, 'error'), 8)}${pad(countBySeverity(result.checks, 'warn'), 8)}${pad(result.sizeMB, 8)}${result.filePath}`
    );
  }
}

function printDetails(results) {
  for (const result of results) {
    if (!result.checks.length) continue;
    console.log('');
    console.log(`[${result.channel}] ${result.status}`);
    for (const check of result.checks) {
      console.log(`- ${check.severity.toUpperCase()} ${check.code}: ${check.message}`);
    }
  }
}

function buildJson(results, options) {
  return {
    inputDir: options.dir,
    sizeLimitMB: Number(formatMegabytes(options.sizeLimitBytes)),
    failOn: options.failOn,
    generatedAt: new Date().toISOString(),
    results,
  };
}

function shouldFail(results, options) {
  if (options.failOn === 'never') return false;
  const hasErrors = results.some((result) => result.checks.some((check) => check.severity === 'error'));
  const hasWarnings = results.some((result) => result.checks.some((check) => check.severity === 'warn'));
  if (options.failOn === 'warnings') return hasErrors || hasWarnings;
  return hasErrors;
}

export function verifyChannels(rawOptions = {}) {
  const options = normalizeVerifyOptions(rawOptions);
  const results = options.channels.map((channel) =>
    verifyChannel(channel, path.join(options.dir, `${channel}.html`), options)
  );
  return {
    options,
    results,
    report: buildJson(results, options),
    failed: shouldFail(results, options),
  };
}

function main() {
  const cliOptions = parseArgs();
  if (cliOptions.help) {
    printHelp();
    process.exit(0);
  }

  const { options, results, report, failed } = verifyChannels(cliOptions);

  if (options.jsonOut) {
    fs.mkdirSync(path.dirname(options.jsonOut), { recursive: true });
    fs.writeFileSync(options.jsonOut, JSON.stringify(report, null, 2), 'utf8');
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(results, options);
    if (!options.summaryOnly) {
      printDetails(results);
    }
  }

  process.exitCode = failed ? 1 : 0;
}

if (isMainModule()) {
  main();
}
