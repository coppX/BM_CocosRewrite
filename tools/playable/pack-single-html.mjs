import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import channelSDKs from './channel-sdks.js';
import { getChannelUploadSpec, shouldEmitStandaloneHtmlFile } from './channel-upload-specs.mjs';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const BUILD_DIR = path.join(PROJECT_ROOT, 'build', 'web-mobile');
const CHANNELS = ['facebook', 'google', 'tiktok', 'mintegral', 'unityads', 'applovin', 'ironsource', 'kwai', 'vungle', 'snap'];
const BRIDGE_JS = fs.readFileSync(path.join(SCRIPT_DIR, 'bridge.playable-sdk.js'), 'utf8');
const B91_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!\"#$%&'()*+,-./:;=?@[]^_`{|}~";
const MIME_BY_EXT = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.bin': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
};

// These files are inlined directly into HTML, so do not duplicate them into PACK.
const INLINE_FILES = new Set([
  'style.css',
  'src/polyfills.bundle.js',
  'src/system.bundle.js',
  'src/import-map.json',
]);

const COMPRESSIBLE_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const BLOB_COMPRESSION_NONE = 'none';
const BLOB_COMPRESSION_GZIP = 'gzip';
const IMAGE_FORMAT_ORIGINAL = 'original';
const IMAGE_FORMAT_WEBP = 'webp';
const IMAGE_FORMAT_JPEG = 'jpeg';
const PYTHON_BIN = process.env.PYTHON || 'python';
const PY_IMAGE_TRANSCODER = path.join(SCRIPT_DIR, 'transcode-image.py');
const UPLOAD_BUNDLE_DIRNAME = 'upload-bundles';
const UPLOAD_HTML_DIRNAME = 'upload-htmls';
const PROJECT_ORIENTATION_BOTH = 'both';
const PROJECT_ORIENTATION_PORTRAIT = 'portrait';
const PROJECT_ORIENTATION_LANDSCAPE = 'landscape';

let pythonImageTranscoderChecked = false;
let pythonImageTranscoderAvailable = false;
let pythonImageTranscoderWarning = null;
let inferredProjectOrientation = null;
let cachedBuildScreenConfig = null;

function parseBooleanLike(raw, fallback = true) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function resolveOutputDirFromArgs(args = process.argv.slice(2)) {
  const key = '--out-dir';
  const idx = args.indexOf(key);
  if (idx >= 0 && args[idx + 1]) {
    const raw = String(args[idx + 1]);
    return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
  }
  return path.join(PROJECT_ROOT, 'dist-playable');
}

function resolveUseBase64FromArgs(args = process.argv.slice(2)) {
  const key = '--use-base64';
  const idx = args.indexOf(key);
  if (idx < 0) return true;
  return parseBooleanLike(args[idx + 1], true);
}

function resolveCompressImagesFromArgs(args = process.argv.slice(2)) {
  const key = '--compress-images';
  const idx = args.indexOf(key);
  if (idx < 0) return true;
  return parseBooleanLike(args[idx + 1], true);
}

function resolveImageQualityFromArgs(args = process.argv.slice(2)) {
  const key = '--image-quality';
  const idx = args.indexOf(key);
  if (idx < 0) return 72;
  const n = Number(args[idx + 1]);
  if (!Number.isFinite(n)) return 72;
  return Math.max(1, Math.min(100, Math.round(n)));
}

function normalizeImageFormat(raw, fallback = IMAGE_FORMAT_ORIGINAL) {
  if (raw == null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (!value) return fallback;
  if (value === IMAGE_FORMAT_WEBP) return IMAGE_FORMAT_WEBP;
  if (value === IMAGE_FORMAT_JPEG || value === 'jpg') return IMAGE_FORMAT_JPEG;
  if (value === IMAGE_FORMAT_ORIGINAL || value === 'keep') return IMAGE_FORMAT_ORIGINAL;
  return fallback;
}

function resolveImageFormatFromArgs(args = process.argv.slice(2)) {
  const key = '--image-format';
  const idx = args.indexOf(key);
  if (idx < 0) return IMAGE_FORMAT_ORIGINAL;
  return normalizeImageFormat(args[idx + 1], IMAGE_FORMAT_ORIGINAL);
}

function resolveImageMaxDimensionFromArgs(args = process.argv.slice(2)) {
  const key = '--image-max-dimension';
  const idx = args.indexOf(key);
  if (idx < 0) return 0;
  const n = Number(args[idx + 1]);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
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

function readBuildScreenConfig() {
  if (cachedBuildScreenConfig) return cachedBuildScreenConfig;

  const settingsPath = path.join(BUILD_DIR, 'src', 'settings.json');
  const fallback = {
    width: 1280,
    height: 720,
    orientation: 'auto',
  };

  if (!fs.existsSync(settingsPath)) {
    cachedBuildScreenConfig = fallback;
    return cachedBuildScreenConfig;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const designResolution = settings && settings.screen && settings.screen.designResolution;
    const width = Number(designResolution && designResolution.width);
    const height = Number(designResolution && designResolution.height);
    cachedBuildScreenConfig = {
      width: Number.isFinite(width) && width > 0 ? width : fallback.width,
      height: Number.isFinite(height) && height > 0 ? height : fallback.height,
      orientation: settings && settings.screen && settings.screen.orientation ? settings.screen.orientation : fallback.orientation,
    };
    return cachedBuildScreenConfig;
  } catch (error) {
    cachedBuildScreenConfig = fallback;
    return cachedBuildScreenConfig;
  }
}

function buildUploadBundleConfig(channel, orientation) {
  switch (channel) {
    case 'tiktok':
      return {
        playable_orientation:
          orientation === PROJECT_ORIENTATION_PORTRAIT ? 1 :
            orientation === PROJECT_ORIENTATION_LANDSCAPE ? 2 :
              0,
      };
    case 'snap':
      return {
        orientation: 1,
      };
    default:
      return null;
  }
}

function extractUploadSnippet(html) {
  const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const headInner = headMatch ? headMatch[1].trim() : '';
  const bodyInner = bodyMatch ? bodyMatch[1].trim() : '';
  return [headInner, bodyInner].filter(Boolean).join('\n');
}

function writeUploadBundle(outDir, channel, html, orientation) {
  const bundleDir = path.join(outDir, UPLOAD_BUNDLE_DIRNAME, channel);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'index.html'), html, 'utf8');

  const config = buildUploadBundleConfig(channel, orientation);
  if (config) {
    fs.writeFileSync(path.join(bundleDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  }

  if (channel === 'ironsource') {
    fs.writeFileSync(path.join(bundleDir, 'snippet.html'), extractUploadSnippet(html), 'utf8');
  }

  return bundleDir;
}

function writeSingleHtmlUploadFile(outDir, channel, html) {
  if (!shouldEmitStandaloneHtmlFile(channel)) return null;

  const htmlDir = path.join(outDir, UPLOAD_HTML_DIRNAME);
  fs.mkdirSync(htmlDir, { recursive: true });
  const spec = getChannelUploadSpec(channel);
  const fileName = spec.htmlUploadFileName || `${channel}.html`;
  const filePath = path.join(htmlDir, fileName);
  fs.writeFileSync(filePath, html, 'utf8');
  return filePath;
}

function normalizeBlobCompression(raw, fallback = BLOB_COMPRESSION_NONE) {
  if (raw == null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (!value) return fallback;
  if (value === BLOB_COMPRESSION_GZIP) return BLOB_COMPRESSION_GZIP;
  if (value === BLOB_COMPRESSION_NONE || value === 'off' || value === 'false' || value === '0') {
    return BLOB_COMPRESSION_NONE;
  }
  return fallback;
}

function resolveBlobCompressionFromArgs(args = process.argv.slice(2)) {
  const key = '--blob-compression';
  const idx = args.indexOf(key);
  if (idx >= 0) {
    return normalizeBlobCompression(args[idx + 1], BLOB_COMPRESSION_NONE);
  }

  const legacyToggleKey = '--compress-blob';
  const toggleIdx = args.indexOf(legacyToggleKey);
  if (toggleIdx < 0) return BLOB_COMPRESSION_NONE;
  return parseBooleanLike(args[toggleIdx + 1], false)
    ? BLOB_COMPRESSION_GZIP
    : BLOB_COMPRESSION_NONE;
}

function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function relFromBuild(abs) {
  return toPosix(path.relative(BUILD_DIR, abs));
}

function readText(rel) {
  return fs.readFileSync(path.join(BUILD_DIR, rel), 'utf8');
}

function readBufByAbs(abs) {
  return fs.readFileSync(abs);
}

function escapeInlineScript(source) {
  // Prevent HTML parser from prematurely closing inline <script> blocks.
  return String(source).replace(/<\/script/gi, '<\\/script');
}

function escapeInlineStyle(source) {
  return String(source).replace(/<\/style/gi, '<\\/style');
}

function encodeBase91(buf) {
  let b = 0;
  let n = 0;
  let out = '';

  for (let i = 0; i < buf.length; i++) {
    b |= (buf[i] & 255) << n;
    n += 8;
    if (n > 13) {
      let v = b & 8191;
      if (v > 88) {
        b >>= 13;
        n -= 13;
      } else {
        v = b & 16383;
        b >>= 14;
        n -= 14;
      }
      out += B91_ALPHABET[v % 91] + B91_ALPHABET[Math.floor(v / 91)];
    }
  }

  if (n) {
    out += B91_ALPHABET[b % 91];
    if (n > 7 || b > 90) out += B91_ALPHABET[Math.floor(b / 91)];
  }

  return out;
}

function guessMime(rel) {
  const ext = path.extname(rel).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function shouldPack(rel) {
  if (rel === 'index.html') return false;
  if (INLINE_FILES.has(rel)) return false;
  return true;
}

function isCompressibleImage(rel, mime) {
  const ext = path.extname(rel).toLowerCase();
  if (!COMPRESSIBLE_IMAGE_EXT.has(ext)) return false;
  return /^image\//i.test(String(mime || ''));
}

function formatErrorMessage(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err && typeof err.message === 'string' && err.message.trim()) return err.message;
  return String(err);
}

function asBuffer(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.from(data);
}

function hashBuffer(buf) {
  return `${buf.length}:${crypto.createHash('sha1').update(buf).digest('hex')}`;
}

function resolveTranscodedMime(imageFormat, fallbackMime) {
  if (imageFormat === IMAGE_FORMAT_WEBP) return 'image/webp';
  if (imageFormat === IMAGE_FORMAT_JPEG) return 'image/jpeg';
  return fallbackMime;
}

function ensurePythonImageTranscoder() {
  if (pythonImageTranscoderChecked) {
    return {
      available: pythonImageTranscoderAvailable,
      warning: pythonImageTranscoderWarning,
    };
  }

  pythonImageTranscoderChecked = true;

  if (!fs.existsSync(PY_IMAGE_TRANSCODER)) {
    pythonImageTranscoderWarning = `[pack-single-html] compression skipped: missing transcoder script (${PY_IMAGE_TRANSCODER})`;
    pythonImageTranscoderAvailable = false;
    return {
      available: pythonImageTranscoderAvailable,
      warning: pythonImageTranscoderWarning,
    };
  }

  const probe = spawnSync(PYTHON_BIN, ['--version'], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    encoding: 'utf8',
  });

  if (probe.error || probe.status !== 0) {
    pythonImageTranscoderWarning = `[pack-single-html] compression skipped: python unavailable (${formatErrorMessage(probe.error || probe.stderr)})`;
    pythonImageTranscoderAvailable = false;
    return {
      available: pythonImageTranscoderAvailable,
      warning: pythonImageTranscoderWarning,
    };
  }

  pythonImageTranscoderAvailable = true;
  pythonImageTranscoderWarning = null;
  return {
    available: pythonImageTranscoderAvailable,
    warning: pythonImageTranscoderWarning,
  };
}

async function transcodeImageWithPython(abs, rel, quality, imageFormat, imageMaxDimension, fallbackMime) {
  const args = [
    PY_IMAGE_TRANSCODER,
    '--input',
    abs,
    '--format',
    imageFormat,
    '--quality',
    String(quality),
  ];

  if (Number.isFinite(imageMaxDimension) && imageMaxDimension > 0) {
    args.push('--max-dimension', String(imageMaxDimension));
  }

  const result = spawnSync(PYTHON_BIN, args, {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString('utf8').trim() : '';
    throw new Error(stderr || `python exited with status ${result.status} for ${rel}`);
  }

  const buffer = asBuffer(result.stdout);
  if (!buffer || !buffer.length) {
    throw new Error(`No transcoded bytes returned for ${rel}`);
  }

  return {
    buffer,
    mime: resolveTranscodedMime(imageFormat, fallbackMime),
  };
}

async function resolveImageCompressor(compressImages, imageFormat, imageMaxDimension) {
  if (!compressImages) return { compressor: null, warning: null };

  const shouldTranscode = imageFormat !== IMAGE_FORMAT_ORIGINAL || imageMaxDimension > 0;
  if (!shouldTranscode) return { compressor: null, warning: null };

  const probe = ensurePythonImageTranscoder();
  if (!probe.available) {
    return { compressor: null, warning: probe.warning };
  }

  return {
    compressor: {
      name: `python-pillow:${imageFormat}`,
      encode: (abs, rel, buf, quality, fallbackMime) =>
        transcodeImageWithPython(abs, rel, quality, imageFormat, imageMaxDimension, fallbackMime),
    },
    warning: null,
  };
}

function makeManifestEntry(offset, length, mime, fallbackMime) {
  if (mime && mime !== fallbackMime) return [offset, length, mime];
  return [offset, length];
}

async function compressImageBuffer(abs, rel, buf, quality, compressor, fallbackMime) {
  const next = await compressor.encode(abs, rel, buf, quality, fallbackMime);
  const nextBuffer = asBuffer(next?.buffer || next);
  if (!nextBuffer || nextBuffer.length >= buf.length) {
    return {
      buffer: buf,
      mime: fallbackMime,
      changed: false,
    };
  }

  return {
    buffer: nextBuffer,
    mime: next?.mime || fallbackMime,
    changed: true,
  };
}

async function buildBinaryPack(compressImages, imageQuality, imageFormat, imageMaxDimension) {
  const files = walk(BUILD_DIR);
  /** @type {Record<string, [number, number]>} */
  const manifest = {};
  /** @type {Buffer[]} */
  const chunks = [];
  let blobOffset = 0;
  const stats = {
    compressedCount: 0,
    originalBytes: 0,
    compressedBytes: 0,
    packedBytes: 0,
    fileCount: 0,
    uniqueFileCount: 0,
    reusedSourceCount: 0,
    dedupedCount: 0,
    dedupedBytes: 0,
    compressor: 'none',
  };

  const { compressor, warning } = await resolveImageCompressor(
    compressImages,
    imageFormat,
    imageMaxDimension
  );
  if (compressImages && compressor) stats.compressor = compressor.name;
  if (warning) {
    console.warn(warning);
  }

  const processedCache = new Map();
  const packedCache = new Map();

  for (const abs of files) {
    const rel = relFromBuild(abs);
    if (!shouldPack(rel)) continue;

    stats.fileCount += 1;

    let buf = readBufByAbs(abs);
    const fallbackMime = guessMime(rel);
    let actualMime = fallbackMime;
    const sourceKey = hashBuffer(buf);
    const cachedProcessed = processedCache.get(sourceKey);

    if (cachedProcessed) {
      buf = cachedProcessed.buffer;
      actualMime = cachedProcessed.mime;
      stats.reusedSourceCount += 1;
    } else if (compressImages && compressor && isCompressibleImage(rel, fallbackMime)) {
      stats.originalBytes += buf.length;
      try {
        const compressed = await compressImageBuffer(abs, rel, buf, imageQuality, compressor, fallbackMime);
        if (compressed.changed) {
          buf = compressed.buffer;
          actualMime = compressed.mime;
          stats.compressedCount += 1;
        }
      } catch (err) {
        console.warn(`[pack-single-html] compress fail ${rel}: ${err && err.message ? err.message : err}`);
      }
      stats.compressedBytes += buf.length;
      processedCache.set(sourceKey, { buffer: buf, mime: actualMime });
    } else {
      processedCache.set(sourceKey, { buffer: buf, mime: actualMime });
    }

    const packedKey = hashBuffer(buf);
    const cachedPacked = packedCache.get(packedKey);
    if (cachedPacked) {
      manifest[rel] = makeManifestEntry(cachedPacked.offset, cachedPacked.length, actualMime, fallbackMime);
      stats.dedupedCount += 1;
      stats.dedupedBytes += buf.length;
      continue;
    }

    manifest[rel] = makeManifestEntry(blobOffset, buf.length, actualMime, fallbackMime);
    chunks.push(buf);
    packedCache.set(packedKey, {
      offset: blobOffset,
      length: buf.length,
    });
    blobOffset += buf.length;
    stats.uniqueFileCount += 1;
    stats.packedBytes += buf.length;
  }

  return {
    manifest,
    blob: Buffer.concat(chunks),
    stats,
  };
}

function chunkString(source, chunkSize) {
  const out = [];
  for (let i = 0; i < source.length; i += chunkSize) {
    out.push(source.slice(i, i + chunkSize));
  }
  return out;
}

function buildPackChunkTags(chunks) {
  return chunks
    .map((chunk, idx) => `<script class="__PACK_BIN_CHUNK__" data-idx="${idx}" type="application/octet-stream">${chunk}</script>`)
    .join('\n');
}

function compressBlobForPayload(blob, compression) {
  const selected = normalizeBlobCompression(compression, BLOB_COMPRESSION_NONE);
  const inputBytes = blob.length;

  if (selected === BLOB_COMPRESSION_GZIP) {
    const gz = zlib.gzipSync(blob, { level: zlib.constants.Z_BEST_COMPRESSION });
    if (gz.length < blob.length) {
      return {
        compression: BLOB_COMPRESSION_GZIP,
        blob: gz,
        inputBytes,
        outputBytes: gz.length,
      };
    }
  }

  return {
    compression: BLOB_COMPRESSION_NONE,
    blob,
    inputBytes,
    outputBytes: blob.length,
  };
}


function makeVfsPatchScript() {
  return String.raw`
(function(){
  function install(){
  const BIN_MANIFEST = window.__PACK_MANIFEST__ || {};
  const BIN_BLOB = window.__PACK_BLOB__ || null;
  const PACK_KEYS = Object.keys(BIN_MANIFEST);
  const RESOLVE_CACHE = Object.create(null);
  const ORIGIN_FETCH = window.fetch ? window.fetch.bind(window) : null;
  const MIME_BY_EXT = ${JSON.stringify(MIME_BY_EXT)};

  function bytesToUtf8(u8){
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(u8);
    }
    let out = '';
    for (let i = 0; i < u8.length; i++) out += '%' + u8[i].toString(16).padStart(2, '0');
    return decodeURIComponent(out);
  }

  function getHit(rel){
    if (!rel) return null;
    if (Object.prototype.hasOwnProperty.call(BIN_MANIFEST, rel)) return BIN_MANIFEST[rel];
    return null;
  }

  function getEntryBytes(hit){
    if (!hit) return null;
    if (Array.isArray(hit) && hit.length >= 2) {
      const o = Number(hit[0]);
      const l = Number(hit[1]);
      if (!Number.isFinite(o) || !Number.isFinite(l) || o < 0 || l < 0) return null;
      if (!BIN_BLOB || typeof BIN_BLOB.subarray !== 'function') return null;
      const end = o + l;
      if (end > BIN_BLOB.length) return null;
      return BIN_BLOB.subarray(o, end);
    }
    return null;
  }

  function getEntryText(hit){
    const bytes = getEntryBytes(hit);
    if (!bytes) return null;
    return bytesToUtf8(bytes);
  }

  function stripQueryHash(u){
    const s = String(u);
    return s.split('#')[0].split('?')[0];
  }

  function collapsePath(p){
    const segs = String(p || '').replace(/\\/g, '/').split('/');
    const out = [];
    for (const seg of segs) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (out.length) out.pop();
        continue;
      }
      out.push(seg);
    }
    return out.join('/');
  }

  function norm(input){
    try {
      let url = (input && typeof input === 'object' && 'url' in input) ? input.url : input;
      if (url == null) return null;
      if (typeof url !== 'string') url = String(url);
      url = stripQueryHash(url);
      if (/^(data:|blob:|javascript:)/i.test(url)) return null;
      if (/^https?:\/\//i.test(url)) {
        const U = new URL(url);
        url = U.pathname;
      } else if (/^file:\/\//i.test(url)) {
        const U = new URL(url);
        url = decodeURIComponent(U.pathname || '');
        if (/^\/[A-Za-z]:\//.test(url)) url = url.slice(1);
      }
      url = url.replace(/^\//, '');
      if (url.startsWith('./')) url = url.slice(2);
      return collapsePath(url);
    } catch (e) {
      return null;
    }
  }

  function has(rel){
    return rel && getHit(rel) != null;
  }

  function resolveRel(rel){
    if (!rel) return null;
    if (Object.prototype.hasOwnProperty.call(RESOLVE_CACHE, rel)) {
      return RESOLVE_CACHE[rel];
    }

    let normalized = collapsePath(rel);
    if (has(normalized)) {
      RESOLVE_CACHE[rel] = normalized;
      return normalized;
    }

    normalized = normalized.replace(/^(\.\.\/)+/, '');
    if (has(normalized)) {
      RESOLVE_CACHE[rel] = normalized;
      return normalized;
    }

    for (let i = 0; i < PACK_KEYS.length; i++) {
      const key = PACK_KEYS[i];
      if (normalized === key || normalized.endsWith('/' + key)) {
        RESOLVE_CACHE[rel] = key;
        return key;
      }
    }

    RESOLVE_CACHE[rel] = null;
    return null;
  }

  function guessMime(rel){
    const extMatch = /\.([^.\/]+)$/.exec(String(rel || '').toLowerCase());
    const ext = extMatch ? '.' + extMatch[1] : '';
    return MIME_BY_EXT[ext] || 'application/octet-stream';
  }

  function getEntryMime(rel){
    const hit = getHit(rel);
    if (Array.isArray(hit) && hit.length >= 3 && typeof hit[2] === 'string' && hit[2]) {
      return hit[2];
    }
    return guessMime(rel);
  }

  function isScriptLike(rel){
    const mime = String(getEntryMime(rel) || '').toLowerCase();
    return /javascript|ecmascript/.test(mime) || /\.(m?js)$/i.test(String(rel || ''));
  }

  function resolveHitFromInput(input){
    const rel = resolveRel(norm(input));
    if (!rel) return { rel: null, hit: null };
    return { rel, hit: getHit(rel) };
  }

  function getScriptText(rel, hit){
    if (!rel || !hit || !isScriptLike(rel)) return null;
    return getEntryText(hit);
  }

  function createObjectURL(parts, mime){
    const URL_API = window.URL || window.webkitURL;
    if (!URL_API || typeof URL_API.createObjectURL !== 'function') return null;
    const blob = new Blob(parts, { type: mime });
    return {
      URL_API,
      objectURL: URL_API.createObjectURL(blob),
    };
  }

  function patchSystemShouldFetch(){
    try {
      const S = window.System;
      if (!S || !S.constructor || !S.constructor.prototype) return;
      const proto = S.constructor.prototype;
      if (proto.__vfsPatchedShouldFetch__) return;

      const originalShouldFetch = typeof proto.shouldFetch === 'function'
        ? proto.shouldFetch
        : function(){ return false; };
      const originalSystemFetch = typeof proto.fetch === 'function'
        ? proto.fetch
        : null;

      proto.shouldFetch = function(url){
        const resolved = resolveHitFromInput(url);
        if (resolved.rel) {
          const scriptText = getScriptText(resolved.rel, resolved.hit);
          if (scriptText != null) return true;
        }
        return originalShouldFetch.call(this, url);
      };

      proto.fetch = function(url, init){
        const resolved = resolveHitFromInput(url);
        if (resolved.rel) {
          const response = toResponse(resolved.rel, init);
          if (response) return Promise.resolve(response);
        }
        if (originalSystemFetch) return originalSystemFetch.call(this, url, init);
        if (ORIGIN_FETCH) return ORIGIN_FETCH(url, init);
        return Promise.reject(new Error('No fetch available'));
      };

      proto.__vfsPatchedShouldFetch__ = true;
    } catch (e) {}
  }

  function patchScriptSrc(){
    try {
      const proto = window.HTMLScriptElement && window.HTMLScriptElement.prototype;
      if (!proto || proto.__vfsPatchedScriptSrc__) return;

      const desc = Object.getOwnPropertyDescriptor(proto, 'src');
      if (!desc || typeof desc.set !== 'function') return;

      const origGet = desc.get;
      const origSet = desc.set;

      Object.defineProperty(proto, 'src', {
        configurable: true,
        enumerable: !!desc.enumerable,
        get: function(){
          return origGet ? origGet.call(this) : '';
        },
        set: function(v){
          const resolved = resolveHitFromInput(v);
          const rel = resolved.rel;
          const scriptText = getScriptText(rel, resolved.hit);
          if (scriptText != null) {
            const created = createObjectURL([scriptText], getEntryMime(rel) || 'text/javascript');
            if (created) {
              const { URL_API, objectURL } = created;
              if (typeof this.addEventListener === 'function') {
                const self = this;
                const cleanup = function(){
                  try { URL_API.revokeObjectURL(objectURL); } catch (e) {}
                  try { self.removeEventListener('load', cleanup); } catch (e) {}
                  try { self.removeEventListener('error', cleanup); } catch (e) {}
                };
                this.addEventListener('load', cleanup);
                this.addEventListener('error', cleanup);
              }
              return origSet.call(this, objectURL);
            }
          }
          return origSet.call(this, v);
        }
      });

      if (typeof proto.setAttribute === 'function' && !proto.__vfsPatchedScriptSetAttribute__) {
        const origSetAttribute = proto.setAttribute;
        proto.setAttribute = function(name, value){
          if (String(name || '').toLowerCase() === 'src') {
            this.src = value;
            return;
          }
          return origSetAttribute.call(this, name, value);
        };
        proto.__vfsPatchedScriptSetAttribute__ = true;
      }

      proto.__vfsPatchedScriptSrc__ = true;
    } catch (e) {}
  }

  function patchScriptInsertion(){
    function patchScriptNode(node){
      try {
        if (!node || !node.tagName || String(node.tagName).toLowerCase() !== 'script') return;

        let src = '';
        try {
          if (typeof node.getAttribute === 'function') src = node.getAttribute('src') || '';
        } catch (e) {}
        if (!src) {
          try { src = node.src || ''; } catch (e) {}
        }

        const resolved = resolveHitFromInput(src);
        const scriptText = getScriptText(resolved.rel, resolved.hit);
        if (scriptText == null) return;

        try { if (typeof node.removeAttribute === 'function') node.removeAttribute('src'); } catch (e) {}
        try { node.text = scriptText; } catch (e) { try { node.textContent = scriptText; } catch (e2) {} }
      } catch (e) {}
    }

    try {
      const NP = window.Node && window.Node.prototype;
      if (!NP) return;

      if (typeof NP.appendChild === 'function' && !NP.__vfsPatchedAppendChild__) {
        const origAppendChild = NP.appendChild;
        NP.appendChild = function(node){
          patchScriptNode(node);
          return origAppendChild.call(this, node);
        };
        NP.__vfsPatchedAppendChild__ = true;
      }

      if (typeof NP.insertBefore === 'function' && !NP.__vfsPatchedInsertBefore__) {
        const origInsertBefore = NP.insertBefore;
        NP.insertBefore = function(node, refNode){
          patchScriptNode(node);
          return origInsertBefore.call(this, node, refNode);
        };
        NP.__vfsPatchedInsertBefore__ = true;
      }
    } catch (e) {}
  }

  function toResponse(rel, init){
    const hit = getHit(rel);
    if (!hit) return null;

    const bytes = getEntryBytes(hit);
    if (!bytes) return null;
    const body = bytes;

    const headers = new Headers((init && init.headers) || {});
    if (!headers.has('Content-Type')) headers.set('Content-Type', getEntryMime(rel));
    return new Response(body, { status: 200, headers });
  }

  if (ORIGIN_FETCH) {
    window.fetch = function(input, init){
      const resolved = resolveHitFromInput(input);
      if (resolved.rel) {
        const response = toResponse(resolved.rel, init);
        if (response) return Promise.resolve(response);
      }
      return ORIGIN_FETCH(input, init);
    };
  }

  patchSystemShouldFetch();
  patchScriptSrc();
  patchScriptInsertion();

  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    const setRequestHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function(method, url, async, user, password){
      this.__vfs_method__ = method;
      this.__vfs_url__ = url;
      this.__vfs_async__ = async;
      this.__vfs_user__ = user;
      this.__vfs_password__ = password;
      this.__vfs_headers__ = [];
      return open.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function(name, value){
      if (this.__vfs_headers__) this.__vfs_headers__.push([name, value]);
      return setRequestHeader.apply(this, arguments);
    };

    XHR.prototype.send = function(body){
      const resolved = resolveHitFromInput(this.__vfs_url__);
      const rel = resolved.rel;
      const hit = resolved.hit;
      if (!hit) return send.apply(this, arguments);

      try {
        const mime = getEntryMime(rel);
        const bytes = getEntryBytes(hit);
        if (!bytes) return send.apply(this, arguments);
        const payload = bytes;
        const created = createObjectURL([payload], mime);
        if (!created) return send.apply(this, arguments);
        const { URL_API, objectURL } = created;
        const self = this;

        const cleanup = function(){
          try { URL_API.revokeObjectURL(objectURL); } catch (e) {}
          if (typeof self.removeEventListener === 'function') {
            try { self.removeEventListener('loadend', cleanup); } catch (e) {}
            try { self.removeEventListener('error', cleanup); } catch (e) {}
            try { self.removeEventListener('abort', cleanup); } catch (e) {}
          }
        };

        if (typeof this.addEventListener === 'function') {
          this.addEventListener('loadend', cleanup);
          this.addEventListener('error', cleanup);
          this.addEventListener('abort', cleanup);
        }

        const method = this.__vfs_method__ || 'GET';
        const asyncFlag = this.__vfs_async__;
        const user = this.__vfs_user__;
        const password = this.__vfs_password__;
        const headers = Array.isArray(this.__vfs_headers__) ? this.__vfs_headers__.slice() : [];

        if (asyncFlag === undefined) {
          open.call(this, method, objectURL);
        } else {
          open.call(this, method, objectURL, asyncFlag, user, password);
        }

        for (let i = 0; i < headers.length; i++) {
          const pair = headers[i];
          try { setRequestHeader.call(this, pair[0], pair[1]); } catch (e) {}
        }

        return send.call(this, body == null ? null : body);
      } catch (e) {
        return send.apply(this, arguments);
      }
    };
  }

  const _Image = window.Image;
  if (_Image) {
    const desc = Object.getOwnPropertyDescriptor(_Image.prototype, 'src');
    window.Image = function(w, h){
      const img = new _Image(w, h);
      if (desc && desc.set) {
        Object.defineProperty(img, 'src', {
          set(v){
            const resolved = resolveHitFromInput(v);
            const rel = resolved.rel;
            const hit = resolved.hit;
            if (hit) {
              const bytes = getEntryBytes(hit);
              if (bytes) {
                const created = createObjectURL([bytes], getEntryMime(rel));
                if (created) {
                  const objectURL = created.objectURL;
                  return desc.set.call(img, objectURL);
                }
              }
            }
            return desc.set.call(img, v);
          }
        });
      }
      return img;
    };
    window.Image.prototype = _Image.prototype;
  }
  }

  const ready = window.__PACK_BOOTSTRAP_READY__;
  if (ready && typeof ready.then === 'function') {
    ready.then(function(){ install(); }).catch(function(){ install(); });
    return;
  }

  install();
})();`.trim();
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
}

function inlineScriptTag(source) {
  return `<script>\n${escapeInlineScript(source)}\n</script>`;
}

function inlineImportMapTag(source) {
  return `<script type="systemjs-importmap">\n${String(source).replace(/<\/script/gi, '<\\/script')}\n</script>`;
}

function addFaviconIfMissing(html) {
  if (/<link[^>]+rel=["']icon["']/i.test(html)) return html;
  return html.replace(/<head>/i, '<head>\n  <link rel="icon" href="data:,">');
}

function inlineStyleIfPresent(html) {
  if (!fs.existsSync(path.join(BUILD_DIR, 'style.css'))) return html;
  const css = readText('style.css');
  return html.replace(/<link[^>]+href="style\.css"[^>]*>/i, `<style>\n${escapeInlineStyle(css)}\n</style>`);
}

function inlineScriptSrcAsset(html, relPath) {
  const escaped = relPath
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\//g, '\\/');
  const re = new RegExp(`<script[^>]*src="${escaped}"[^>]*>\\s*<\\/script>`, 'i');
  return html.replace(re, inlineScriptTag(readText(relPath)));
}

function inlineImportMapAsset(html, relPath) {
  const escaped = relPath
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\//g, '\\/');
  const re = new RegExp(`<script[^>]*src="${escaped}"[^>]*type="systemjs-importmap"[^>]*>\\s*<\\/script>`, 'i');
  return html.replace(re, inlineImportMapTag(readText(relPath)));
}

function makePackBootstrapScript(useBase64, blobCompression) {
  return `<script>(function(){
  const PACK_ENCODING = ${JSON.stringify(useBase64 ? 'base64' : 'base91')};
  const PACK_BLOB_COMPRESSION = ${JSON.stringify(blobCompression)};
  const B91_ALPHABET = ${JSON.stringify(B91_ALPHABET)};
  const nodes = document.querySelectorAll('script.__PACK_BIN_CHUNK__');
  const manifestNode = document.getElementById('__PACK_MANIFEST__');
  let payload = '';
  for (let i = 0; i < nodes.length; i++) {
    payload += nodes[i].textContent || '';
  }
  payload = payload.replace(/\\s+/g, '');
  const manifestText = manifestNode ? (manifestNode.textContent || '{}') : '{}';
  const B64_TABLE = new Int16Array(128).fill(-1);
  for (let i = 0; i < 26; i++) {
    B64_TABLE[65 + i] = i;
    B64_TABLE[97 + i] = 26 + i;
  }
  for (let i = 0; i < 10; i++) B64_TABLE[48 + i] = 52 + i;
  B64_TABLE[43] = 62;
  B64_TABLE[47] = 63;
  function b64ToBytes(input){
    let clean = String(input || '')
      .replace(/\\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/[^A-Za-z0-9+/=]/g, '');

    if (!clean) return new Uint8Array(0);

    clean = clean.replace(/=+$/g, '');
    if (clean.length % 4 === 1) clean = clean.slice(0, -1);
    if (clean.length % 4) clean += '='.repeat(4 - (clean.length % 4));

    let pad = 0;
    if (clean.endsWith('==')) pad = 2;
    else if (clean.endsWith('=')) pad = 1;

    const outLen = Math.max(0, ((clean.length >> 2) * 3) - pad);
    const out = new Uint8Array(outLen);
    let off = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const c1 = clean.charCodeAt(i);
      const c2 = clean.charCodeAt(i + 1);
      const c3 = clean.charCodeAt(i + 2);
      const c4 = clean.charCodeAt(i + 3);
      const v1 = c1 < 128 ? B64_TABLE[c1] : -1;
      const v2 = c2 < 128 ? B64_TABLE[c2] : -1;
      const v3 = c3 === 61 ? 0 : (c3 < 128 ? B64_TABLE[c3] : -1);
      const v4 = c4 === 61 ? 0 : (c4 < 128 ? B64_TABLE[c4] : -1);
      if (v1 < 0 || v2 < 0 || v3 < 0 || v4 < 0) throw new Error('Invalid base64 character');

      const n = (v1 << 18) | (v2 << 12) | (v3 << 6) | v4;
      if (off < outLen) out[off++] = (n >> 16) & 255;
      if (c3 !== 61 && off < outLen) out[off++] = (n >> 8) & 255;
      if (c4 !== 61 && off < outLen) out[off++] = n & 255;
    }
    return out;
  }

  function b91ToBytes(input){
    const table = new Int16Array(128).fill(-1);
    for (let i = 0; i < B91_ALPHABET.length; i++) {
      const code = B91_ALPHABET.charCodeAt(i);
      if (code < 128) table[code] = i;
    }

    let v = -1;
    let b = 0;
    let n = 0;
    const out = [];
    const clean = String(input || '').replace(/\\s+/g, '');

    for (let i = 0; i < clean.length; i++) {
      const c = clean.charCodeAt(i);
      if (c >= 128) continue;
      const d = table[c];
      if (d < 0) continue;

      if (v < 0) {
        v = d;
      } else {
        v += d * 91;
        b |= v << n;
        n += (v & 8191) > 88 ? 13 : 14;
        while (n > 7) {
          out.push(b & 255);
          b >>= 8;
          n -= 8;
        }
        v = -1;
      }
    }

    if (v >= 0) {
      out.push((b | (v << n)) & 255);
    }

    return new Uint8Array(out);
  }

  function decodePayload(raw){
    if (PACK_ENCODING === 'base91') return b91ToBytes(raw);
    return b64ToBytes(raw);
  }

  async function maybeDecompress(bytes){
    if (PACK_BLOB_COMPRESSION === 'none') return bytes;

    if (PACK_BLOB_COMPRESSION === 'gzip') {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('DecompressionStream is not available for gzip blob layer.');
      }
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const out = await new Response(stream).arrayBuffer();
      return new Uint8Array(out);
    }

    throw new Error('Unsupported blob compression: ' + PACK_BLOB_COMPRESSION);
  }

  window.__PACK_BOOTSTRAP_READY__ = (async function(){
    try {
      window.__PACK_MANIFEST__ = JSON.parse(manifestText);
      const decoded = decodePayload(payload);
      window.__PACK_BLOB__ = await maybeDecompress(decoded);
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
      }
      if (manifestNode && manifestNode.parentNode) manifestNode.parentNode.removeChild(manifestNode);
    } catch (e) {
      console.error('[pack-single-html] binary pack parse failed:', e && e.message ? e.message : e);
      window.__PACK_MANIFEST__ = {};
      window.__PACK_BLOB__ = new Uint8Array(0);
    }
  })();
})();</script>`;
}

function makeSystemImportStartScript() {
  return `<script>(function(){
  function toPromise(value){
    if (value && typeof value.then === 'function') return value;
    return Promise.resolve(value);
  }
  function waitForPlayableStartGate(){
    try {
      const gate = window.__PLAYABLE_START_GATE__;
      if (typeof gate === 'function') {
        return toPromise(gate());
      }
      return toPromise(gate);
    } catch (err) {
      console.error('[pack-single-html] playable start gate failed:', err && err.message ? err.message : err);
      return Promise.resolve();
    }
  }
  function waitForBootstrap(){
    const ready = window.__PACK_BOOTSTRAP_READY__;
    if (ready && typeof ready.then === 'function') {
      return ready;
    }
    return Promise.resolve();
  }
  function start(){
    System.import('./index.js').catch(function(err) { console.error(err); });
  }
  Promise.all([waitForBootstrap(), waitForPlayableStartGate()]).then(function(){
    start();
  }).catch(function(err){
    console.error('[pack-single-html] startup wait failed:', err && err.message ? err.message : err);
    start();
  });
})();</script>`;
}

function inlineHtml(channel, manifest, blob, useBase64, blobCompression, buildScreenConfig, projectOrientation) {
  let html = fs.readFileSync(path.join(BUILD_DIR, 'index.html'), 'utf8');
  const manifestJson = JSON.stringify(manifest);
  const blobPayload = useBase64 ? blob.toString('base64') : encodeBase91(blob);
  const PACK_CHUNK_SIZE = 256 * 1024;

  const blobChunks = chunkString(blobPayload, PACK_CHUNK_SIZE);
  const packedChunkTags = buildPackChunkTags(blobChunks);
  const manifestTag = `<script id="__PACK_MANIFEST__" type="application/octet-stream">${escapeInlineScript(manifestJson)}</script>`;
  const packedBootstrap = makePackBootstrapScript(useBase64, blobCompression);
  const startScript = makeSystemImportStartScript();

  // 获取渠道专属SDK代码
  const channelSDK = channelSDKs[channel] || '';

  html = addFaviconIfMissing(html);
  html = inlineStyleIfPresent(html);
  html = inlineScriptSrcAsset(html, 'src/polyfills.bundle.js');
  html = inlineScriptSrcAsset(html, 'src/system.bundle.js');
  html = inlineImportMapAsset(html, 'src/import-map.json');

  const injected =
`<script>window.__CHANNEL__=${JSON.stringify(channel)};window.__PLAYABLE_DESIGN_SIZE__=${JSON.stringify({ width: buildScreenConfig.width, height: buildScreenConfig.height })};window.__PLAYABLE_PROJECT_ORIENTATION__=${JSON.stringify(projectOrientation)};</script>
${channelSDK}
${manifestTag}
${packedChunkTags}
${packedBootstrap}
<script>${escapeInlineScript(makeVfsPatchScript())}</script>
<script>${escapeInlineScript(BRIDGE_JS)}</script>
`;

  html = html.replace(
    /<script[^>]*>\s*System\.import\((['"])\.\/index\.js\1\)[\s\S]*?<\/script>/i,
    () => `${injected}\n${startScript}`
  );

  html = html.replace(/<title>.*?<\/title>/i, `<title>Playable-${channel}-${sha1(channel + String(Object.keys(manifest).length))}</title>`);

  return html;
}

export async function packSingleHtml(options = {}) {
  const requestedOutDir = String(options.outDir || resolveOutputDirFromArgs());
  const outDir = path.isAbsolute(requestedOutDir)
    ? requestedOutDir
    : path.resolve(PROJECT_ROOT, requestedOutDir);
  const useBase64 = typeof options.useBase64 === 'boolean' ? options.useBase64 : resolveUseBase64FromArgs();
  const requestedBlobCompression = typeof options.blobCompression === 'string'
    ? normalizeBlobCompression(options.blobCompression, BLOB_COMPRESSION_NONE)
    : resolveBlobCompressionFromArgs();
  const compressImages = typeof options.compressImages === 'boolean'
    ? options.compressImages
    : resolveCompressImagesFromArgs();
  const imageQuality = Number.isFinite(options.imageQuality)
    ? Math.max(1, Math.min(100, Math.round(options.imageQuality)))
    : resolveImageQualityFromArgs();
  const imageFormat = normalizeImageFormat(
    typeof options.imageFormat === 'string' ? options.imageFormat : resolveImageFormatFromArgs()
  );
  const imageMaxDimension = Number.isFinite(options.imageMaxDimension)
    ? Math.max(0, Math.round(options.imageMaxDimension))
    : resolveImageMaxDimensionFromArgs();
  fs.mkdirSync(outDir, { recursive: true });

  const { manifest, blob, stats } = await buildBinaryPack(
    compressImages,
    imageQuality,
    imageFormat,
    imageMaxDimension
  );
  const projectOrientation = inferProjectOrientation();
  const buildScreenConfig = readBuildScreenConfig();
  const blobPack = compressBlobForPayload(blob, requestedBlobCompression);
  const writtenFiles = [];
  const writtenUploadBundles = [];
  const writtenUploadHtmlFiles = [];
  for (const ch of CHANNELS) {
    const out = inlineHtml(ch, manifest, blobPack.blob, useBase64, blobPack.compression, buildScreenConfig, projectOrientation);
    const outPath = path.join(outDir, `${ch}.html`);
    fs.writeFileSync(outPath, out, 'utf8');
    console.log('written:', outPath);
    writtenFiles.push(outPath);
    writtenUploadBundles.push(writeUploadBundle(outDir, ch, out, projectOrientation));
    const singleHtmlUploadPath = writeSingleHtmlUploadFile(outDir, ch, out);
    if (singleHtmlUploadPath) {
      writtenUploadHtmlFiles.push(singleHtmlUploadPath);
    }
  }

  if (requestedBlobCompression !== BLOB_COMPRESSION_NONE) {
    const saved = Math.max(0, blobPack.inputBytes - blobPack.outputBytes);
    console.log(
      `[pack-single-html] blob=${blobPack.compression} requested=${requestedBlobCompression} saved=${saved}B (${blobPack.inputBytes} -> ${blobPack.outputBytes})`
    );
  }

  if (compressImages && stats.compressor !== 'none') {
    const saved = Math.max(0, stats.originalBytes - stats.compressedBytes);
    console.log(
      `[pack-single-html] compressed=${stats.compressedCount} saved=${saved}B q=${imageQuality} format=${imageFormat} maxDim=${imageMaxDimension} via=${stats.compressor}`
    );
  }

  if (stats.dedupedCount > 0) {
    console.log(
      `[pack-single-html] deduped=${stats.dedupedCount} saved=${stats.dedupedBytes}B unique=${stats.uniqueFileCount}/${stats.fileCount}`
    );
  }

  if (writtenUploadBundles.length) {
    console.log(
      `[pack-single-html] uploadBundles=${writtenUploadBundles.length} orientation=${projectOrientation} dir=${path.join(outDir, UPLOAD_BUNDLE_DIRNAME)}`
    );
  }

  if (writtenUploadHtmlFiles.length) {
    console.log(
      `[pack-single-html] uploadHtmlFiles=${writtenUploadHtmlFiles.length} dir=${path.join(outDir, UPLOAD_HTML_DIRNAME)}`
    );
  }

  return {
    outDir,
    files: writtenFiles,
    uploadBundleDir: path.join(outDir, UPLOAD_BUNDLE_DIRNAME),
    uploadHtmlDir: path.join(outDir, UPLOAD_HTML_DIRNAME),
    uploadHtmlFiles: writtenUploadHtmlFiles,
    projectOrientation,
    useBase64,
    blobCompression: {
      requested: requestedBlobCompression,
      applied: blobPack.compression,
      inputBytes: blobPack.inputBytes,
      outputBytes: blobPack.outputBytes,
    },
    bundle: {
      fileCount: stats.fileCount,
      uniqueFileCount: stats.uniqueFileCount,
      packedBytes: stats.packedBytes,
      dedupedCount: stats.dedupedCount,
      dedupedBytes: stats.dedupedBytes,
    },
    imageCompression: {
      enabled: compressImages,
      quality: imageQuality,
      format: imageFormat,
      maxDimension: imageMaxDimension,
      compressor: stats.compressor,
      compressedCount: stats.compressedCount,
      originalBytes: stats.originalBytes,
      compressedBytes: stats.compressedBytes,
    },
  };
}

if (isMainModule()) {
  packSingleHtml().catch((err) => {
    console.error('[pack-single-html] failed:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}
