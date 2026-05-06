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
const IMAGE_FORMAT_PNG = 'png';
const IMAGE_FORMAT_SMART = 'smart';
const IMAGE_FORMAT_WEBP = 'webp';
const IMAGE_FORMAT_JPEG = 'jpeg';
const PYTHON_BIN = process.env.PYTHON || 'python';
const PY_IMAGE_TRANSCODER = path.join(SCRIPT_DIR, 'transcode-image.py');
const UPLOAD_BUNDLE_DIRNAME = 'upload-bundles';
const UPLOAD_HTML_DIRNAME = 'upload-htmls';
const PROJECT_ORIENTATION_BOTH = 'both';
const PROJECT_ORIENTATION_PORTRAIT = 'portrait';
const PROJECT_ORIENTATION_LANDSCAPE = 'landscape';
const PLAYABLE_PACK_BASE_URL = 'https://playable.invalid/';

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
  if (value === IMAGE_FORMAT_SMART || value === 'auto') return IMAGE_FORMAT_SMART;
  if (value === IMAGE_FORMAT_PNG) return IMAGE_FORMAT_PNG;
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

function writeBundleFile(bundleDir, relPath, contents) {
  const targetPath = path.join(bundleDir, ...String(relPath).split('/'));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents);
  return targetPath;
}

function makeExternalPackScriptSource(targetName, payload) {
  return `(function(){window.${targetName}=(typeof window.${targetName}==='string'?window.${targetName}:'')+${JSON.stringify(String(payload || ''))};})();`;
}

function writeExternalPackDataScripts(bundleDir, manifestPayload, payloadChunks) {
  const tagPaths = [];
  writeBundleFile(bundleDir, 'pack/manifest.js', makeExternalPackScriptSource('__PACK_INLINE_MANIFEST__', manifestPayload));
  tagPaths.push('pack/manifest.js');

  payloadChunks.forEach((chunk, index) => {
    const fileName = `pack/chunks/chunk-${String(index).padStart(3, '0')}.js`;
    writeBundleFile(bundleDir, fileName, makeExternalPackScriptSource('__PACK_INLINE_PAYLOAD__', chunk));
    tagPaths.push(fileName);
  });

  return tagPaths
    .map((relPath) => `<script src="${relPath}" charset="utf-8"></script>`)
    .join('\n');
}

function writeUploadBundle(outDir, channel, bundleOptions) {
  const {
    html,
    orientation,
    buildScreenConfig,
    projectOrientation,
    manifest,
    blob,
    useBase64,
    blobCompression,
  } = bundleOptions || {};
  const bundleDir = path.join(outDir, UPLOAD_BUNDLE_DIRNAME, channel);
  const spec = getChannelUploadSpec(channel);
  const bundleStrategy = spec.uploadBundleStrategy || 'single-html';
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  if (bundleStrategy === 'external-pack-scripts') {
    if (!manifest || !blob) {
      throw new Error(`Missing pack data for ${channel} external upload bundle.`);
    }
    writeExternalPackUploadBundle(
      bundleDir,
      channel,
      manifest,
      blob,
      useBase64,
      blobCompression,
      buildScreenConfig,
      projectOrientation
    );
  } else {
    fs.writeFileSync(path.join(bundleDir, 'index.html'), html, 'utf8');
  }

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
  const spec = getChannelUploadSpec(channel);
  const htmlDir = path.join(outDir, UPLOAD_HTML_DIRNAME);
  const fileName = spec.htmlUploadFileName || `${channel}.html`;
  const filePath = path.join(htmlDir, fileName);

  if (!shouldEmitStandaloneHtmlFile(channel)) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
    return null;
  }

  const htmlBytes = Buffer.byteLength(html, 'utf8');
  const exceedsHtmlLimit = Number.isFinite(spec.htmlMaxBytes) && spec.htmlMaxBytes > 0 && htmlBytes > spec.htmlMaxBytes;
  const keepOversizeHtmlFile = spec.keepStandaloneHtmlFileWhenOversize === true;

  if (exceedsHtmlLimit && !keepOversizeHtmlFile) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
    console.warn(
      `[pack-single-html] skip uploadHtml channel=${channel} bytes=${htmlBytes} limit=${spec.htmlMaxBytes}`
    );
    return null;
  }

  fs.mkdirSync(htmlDir, { recursive: true });
  fs.writeFileSync(filePath, html, 'utf8');
  if (exceedsHtmlLimit) {
    console.warn(
      `[pack-single-html] keep oversize uploadHtml channel=${channel} bytes=${htmlBytes} limit=${spec.htmlMaxBytes}`
    );
  }
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

function escapeHtmlTextNode(source) {
  return String(source)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

const SAFE_GLOBAL_THIS_EXPR = '(typeof globalThis!=="undefined"?globalThis:typeof self!=="undefined"?self:typeof window!=="undefined"?window:typeof global!=="undefined"?global:{})';

function isJavaScriptAsset(rel, mime) {
  const ext = path.extname(rel).toLowerCase();
  const normalizedMime = String(mime || '').toLowerCase();
  if (/javascript|ecmascript/.test(normalizedMime)) return true;
  return ext === '.js' || ext === '.mjs';
}

function isJsonAsset(rel, mime) {
  const ext = path.extname(rel).toLowerCase();
  const normalizedMime = String(mime || '').toLowerCase();
  if (/json/.test(normalizedMime)) return true;
  return ext === '.json';
}

function replaceAllLiteral(source, searchValue, replacement) {
  if (!searchValue) {
    return { value: source, count: 0 };
  }
  const count = source.split(searchValue).length - 1;
  if (count <= 0) {
    return { value: source, count: 0 };
  }
  return {
    value: source.split(searchValue).join(replacement),
    count,
  };
}

function replaceFirstLiteral(source, searchValue, replacement) {
  const index = source.indexOf(searchValue);
  if (index < 0) {
    return { value: source, count: 0 };
  }
  return {
    value: `${source.slice(0, index)}${replacement}${source.slice(index + searchValue.length)}`,
    count: 1,
  };
}

function normalizePackRel(rel) {
  return String(rel || '').replace(/\\/g, '/');
}

// Facebook's preview container can block unsafe-eval, so we swap the known
// Cocos/runtime JIT helpers to slower but CSP-safe equivalents.
function applyFacebookNoEvalTransforms(rel, source) {
  const normalizedRel = normalizePackRel(rel);
  let next = String(source);
  const applied = [];

  function replaceAllStep(label, searchValue, replacement) {
    const result = replaceAllLiteral(next, searchValue, replacement);
    if (!result.count) return;
    next = result.value;
    applied.push(`${label}:${result.count}`);
  }

  function replaceFirstStep(label, searchValue, replacement) {
    const result = replaceFirstLiteral(next, searchValue, replacement);
    if (!result.count) return;
    next = result.value;
    applied.push(label);
  }

  function replaceRegexStep(label, pattern, replacement) {
    const matches = next.match(pattern);
    const count = matches ? matches.length : 0;
    if (!count) return;
    next = next.replace(pattern, replacement);
    applied.push(`${label}:${count}`);
  }

  replaceAllStep(
    'global-this',
    'Function("return this")()',
    SAFE_GLOBAL_THIS_EXPR
  );
  replaceAllStep(
    'regenerator-runtime',
    'Function("r","regeneratorRuntime = r")(r)',
    `(function(v){var g=${SAFE_GLOBAL_THIS_EXPR};try{g.regeneratorRuntime=v;}catch(_){}})(r)`
  );
  replaceFirstStep(
    'ccobject-destruct',
    'return Function("o",l)',
    'try{return Function("o",l)}catch(e){return function(o){for(var key in s)o[key]=s[key]}}'
  );
  replaceFirstStep(
    'trycatch-functor',
    'tryCatchFunctor_EDITOR:function(t){return Function("target","try {\\n  target."+t+"();\\n}\\ncatch (e) {\\n  cc._throw(e);\\n}")}',
    'tryCatchFunctor_EDITOR:function(t){return function(target){try{var fn=target&&target[t];return"function"==typeof fn?fn.call(target):void 0}catch(e){cc._throw(e)}}}'
  );
  replaceFirstStep(
    'disable-wasm-feature-probe',
    'I=function(){if((i.os===Eo.IOS||i.os===Eo.OSX)&&/(OS 15_4)|(Version\\/15.4)/.test(window.navigator.userAgent))return!1;try{if("object"==typeof WebAssembly&&"function"==typeof WebAssembly.instantiate){var t=new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));if(t instanceof WebAssembly.Module)return new WebAssembly.Instance(t)instanceof WebAssembly.Instance}}catch(t){return!1}return!1}();',
    'I=!1;'
  );
  replaceFirstStep(
    'animation-property-accessor',
    `setValue:Function("value",'this.target["'+f+'"] = value;'),getValue:Function('return this.target["'+f+'"];')`,
    'setValue:function(value){this.target[f]=value;},getValue:function(){return this.target[f]}'
  );
  replaceFirstStep(
    'component-scheduler-jit',
    'function $P(t,e,i){var n="var a=it.array;for(it.i=0;it.i<a.length;++it.i){var c=a[it.i];"+t+"}",r=e?Function("it","dt",n):Function("it",n);return tE(Function("c","dt",t),r,i)}',
    'function $P(t,e,i){try{var n="var a=it.array;for(it.i=0;it.i<a.length;++it.i){var c=a[it.i];"+t+"}",r=e?Function("it","dt",n):Function("it",n),s=Function("c","dt",t);return tE(s,r,i)}catch(a){var s=function(c,dt){if(!c)return;if(0===t.indexOf("c.start();c._objFlags|=")){typeof c.start==="function"&&c.start();var e=Number(t.slice("c.start();c._objFlags|=".length));isFinite(e)&&(c._objFlags|=e);return}if("c.update(dt)"===t){typeof c.update==="function"&&c.update(dt);return}if("c.lateUpdate(dt)"===t){typeof c.lateUpdate==="function"&&c.lateUpdate(dt)}};var r=function(it,dt){for(var a=it.array;it.i<a.length;++it.i)s(a[it.i],dt)};return tE(s,r,i)}}'
  );
  replaceFirstStep(
    'deserialize-jit-fallback',
    'return(ie(e,C.Node)||ie(e,C.Component))&&r.push("d._id&&(o._id=d._id);"),"_$erialized"===n[n.length-1]&&(r.push("o._$erialized=JSON.parse(JSON.stringify(d));"),r.push("s._fillPlainObject(o._$erialized,d);")),Function("s","o","d","k",r.join(""))}',
    `return(ie(e,C.Node)||ie(e,C.Component))&&r.push("d._id&&(o._id=d._id);"),"_$erialized"===n[n.length-1]&&(r.push("o._$erialized=JSON.parse(JSON.stringify(d));"),r.push("s._fillPlainObject(o._$erialized,d);")),(function(){try{return Function("s","o","d","k",r.join(""))}catch(_){var t=kg(e),a=ie(e,C.Node)||ie(e,C.Component),h="_$erialized"===n[n.length-1];return function(s,o,d,k){for(var r=0;r<n.length;r++){var v=n[r],y=i[v+Eg],b=y||v,S=d[b];if("undefined"==typeof S)continue;var w=Vi.getDefault(i[v+Pg]),x=i[v+Mg];if(t&&(void 0!==w||x)){if(Rg(w,x)){o[v]=S;continue}if(w instanceof C.ValueType){S?(o[v]||(o[v]=new w.constructor),s._deserializeFastDefinedObject(o[v],S,w.constructor)):o[v]=null;continue}S?s._deserializeAndAssignField(o,S,v):o[v]=null;continue}if("object"!=typeof S){o[v]=S;continue}if(w instanceof C.ValueType)S?(o[v]||(o[v]=new w.constructor),s._deserializeFastDefinedObject(o[v],S,w.constructor)):o[v]=null;else S?s._deserializeAndAssignField(o,S,v):o[v]=null}a&&d._id&&(o._id=d._id),h&&(o._$erialized=JSON.parse(JSON.stringify(d)),s._fillPlainObject(o._$erialized,d))}}})()}`
  );
  replaceFirstStep(
    'prefab-global-resolve',
    'if(r)try{if(r=t===Function("return "+i)())return this.funcModuleCache[i]=i,i}catch(t){}}',
    'if(r)try{for(var o="undefined"!=typeof globalThis?globalThis:window,h=i.split("."),u=0;o&&u<h.length;u++)o=o[h[u]];if(r=t===o)return this.funcModuleCache[i]=i,i}catch(t){}}'
  );
  replaceFirstStep(
    'prefab-jit-fallback',
    'this.result=Function("O","F",n)(this.objs,this.funcs);',
    'try{this.result=Function("O","F",n)(this.objs,this.funcs)}catch(e){this.result=function(R){if(R){var e=R._prefab||R.prefab,i=t._prefab||t.prefab,n=e&&e.instance,r=e&&e.targetOverrides;t._iN$t=R;var s=C.instantiate._clone(t,t);return e&&i&&(e.root=R,e.asset=i.asset,e.fileId||(e.fileId=i.fileId),e.nestedPrefabInstanceRoots=i.nestedPrefabInstanceRoots,e.instance=n,e.targetOverrides=r,s._prefab=e),s}return C.instantiate._clone(t,t)}}'
  );

  if (/^cocos-js\/_virtual_cc-.*\.js$/i.test(normalizedRel)) {
    replaceRegexStep(
      'bullet-force-asm',
      /oh\.hasFeature\(oh\.Feature\.WASM\)\?Promise\.all\(\[e\.import\("\.\/bullet\.release\.wasm-([^"]+)\.js"\)\.then\(\(function\(t\)\{return t\.b\}\)\),e\.import\("\.\/bullet\.release\.wasm-([^"]+)\.js"\)\]\)\.then\(\(function\(t\)\{/g,
      '(window.__PLAYABLE_FACEBOOK_ALLOW_WASM__===!0&&oh.hasFeature(oh.Feature.WASM))?Promise.all([e.import("./bullet.release.wasm-$1.js").then((function(t){return t.b})),e.import("./bullet.release.wasm-$2.js")]).then((function(t){'
    );
    replaceRegexStep(
      'spine-force-asm',
      /oh\.hasFeature\(oh\.Feature\.WASM\)\?Promise\.all\(\[e\.import\("\.\/spine\.wasm-([^"]+)\.js"\),e\.import\("\.\/spine-([^"]+)\.js"\)\]\)\.then\(\(function\(t\)\{/g,
      '(window.__PLAYABLE_FACEBOOK_ALLOW_WASM__===!0&&oh.hasFeature(oh.Feature.WASM))?Promise.all([e.import("./spine.wasm-$1.js"),e.import("./spine-$2.js")]).then((function(t){'
    );
    replaceFirstStep(
      'device-manager-force-webgl1',
      's&&C.WebGL2Device&&this._tryInitializeDeviceSync(C.WebGL2Device,r),C.WebGLDevice&&this._tryInitializeDeviceSync(C.WebGLDevice,r),C.EmptyDevice&&this._tryInitializeDeviceSync(C.EmptyDevice,r),this._initSwapchain()',
      'try{globalThis.window&&globalThis.window.__PLAYABLE_FACEBOOK_FORCE_WEBGL1__&&(s=!1,globalThis.window.__PLAYABLE_FACEBOOK_LAST_DEVICE_ORDER__="webgl1-first",globalThis.window.__PLAYABLE_FACEBOOK_LAST_DEVICE_ORDER_AT__=Date.now())}catch(e){}s&&C.WebGL2Device&&this._tryInitializeDeviceSync(C.WebGL2Device,r),C.WebGLDevice&&this._tryInitializeDeviceSync(C.WebGLDevice,r),C.EmptyDevice&&this._tryInitializeDeviceSync(C.EmptyDevice,r),this._initSwapchain()'
    );
  }

  if (normalizedRel === 'application.js') {
    replaceFirstStep(
      'application-init-hook',
      'cc = engine;',
      'cc = engine;try{window.cc=engine;window.__PLAYABLE_FACEBOOK_APP_INIT_ENGINE_AT__=Date.now();if(typeof window.__PLAYABLE_FACEBOOK_PATCH_CC__==="function"){window.__PLAYABLE_FACEBOOK_PATCH_CC__(engine)}}catch(e){window.__PLAYABLE_FACEBOOK_APP_INIT_PATCH_ERROR__=e&&e.message?e.message:String(e);window.__PLAYABLE_FACEBOOK_APP_INIT_PATCH_ERROR_AT__=Date.now()}'
    );
    replaceFirstStep(
      'application-start-begin',
      'return cc.game.init({',
      'window.__PLAYABLE_FACEBOOK_APP_START_AT__=Date.now();return cc.game.init({'
    );
    replaceFirstStep(
      'application-start-run-chain',
      `}).then(function () {
              return cc.game.run();
            });`,
      `}).then(function () {
              window.__PLAYABLE_FACEBOOK_GAME_INIT_DONE_AT__ = Date.now();
              window.__PLAYABLE_FACEBOOK_GAME_RUN_REQUEST_AT__ = Date.now();
              return cc.game.run();
            }).then(function (result) {
              window.__PLAYABLE_FACEBOOK_GAME_RUN_DONE_AT__ = Date.now();
              return result;
            })["catch"](function (error) {
              window.__PLAYABLE_FACEBOOK_APP_START_ERROR__ = error && error.message ? error.message : String(error);
              window.__PLAYABLE_FACEBOOK_APP_START_ERROR_AT__ = Date.now();
              throw error;
            });`
    );
  }

  if (normalizedRel.endsWith('assets/main/index.js')) {
    replaceFirstStep(
      'player-anim-guard',
      'r.setAnimationBool=function(t,n){this._animationController&&this._animationController.setValue(t,n)}',
      'r.setAnimationBool=function(t,n){if(this._animationController)try{this._animationController.setValue(t,n)}catch(e){var i=this;this.__fbPlayablePendingAnimValues||(this.__fbPlayablePendingAnimValues=Object.create(null)),this.__fbPlayablePendingAnimValues[t]=n,window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_KEY__=String(t||""),window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_AT__=Date.now(),window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_ERROR__=e&&e.message?e.message:String(e),setTimeout(function(){if(!i._animationController)return;var e=i.__fbPlayablePendingAnimValues||{};for(var r in e)try{i._animationController.setValue(r,e[r]),delete e[r],window.__PLAYABLE_FACEBOOK_LAST_ANIM_FLUSH_AT__=Date.now()}catch(t){}},0)}}'
    );
    replaceFirstStep(
      'weapon-stop-anim-guard',
      'o.stopAttacking=function(){this.ownerPlayer&&this.ownerPlayer.setAttackAnimation(!1),this._actorAnimator&&"function"==typeof this._actorAnimator.setValue&&this._actorAnimator.setValue("IsAttack",!1),this._isAttacking=!1}',
      'o.stopAttacking=function(){this.ownerPlayer&&this.ownerPlayer.setAttackAnimation(!1);try{this._actorAnimator&&"function"==typeof this._actorAnimator.setValue&&this._actorAnimator.setValue("IsAttack",!1)}catch(e){window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_KEY__="IsAttack",window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_AT__=Date.now(),window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_ERROR__=e&&e.message?e.message:String(e)}this._isAttacking=!1}'
    );
    replaceFirstStep(
      'weapon-attack-anim-guard',
      'o.attack=function(t){this.ownerPlayer&&this.ownerPlayer.setAttackAnimation(!0),this._actorAnimator&&"function"==typeof this._actorAnimator.setValue&&this._actorAnimator.setValue("IsAttack",!0)}',
      'o.attack=function(t){this.ownerPlayer&&this.ownerPlayer.setAttackAnimation(!0);try{this._actorAnimator&&"function"==typeof this._actorAnimator.setValue&&this._actorAnimator.setValue("IsAttack",!0)}catch(e){window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_KEY__="IsAttack",window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_AT__=Date.now(),window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_ERROR__=e&&e.message?e.message:String(e)}}'
    );
    replaceFirstStep(
      'enemy-death-anim-guard',
      'l.setDeathState=function(t){var e;this._animation||(this._animation=null!=(e=this.animationController)?e:this.findAnimationControllerInChildren());this._animation&&this._animation.setValue("Death",t)}',
      'l.setDeathState=function(t){var e;this._animation||(this._animation=null!=(e=this.animationController)?e:this.findAnimationControllerInChildren());try{this._animation&&this._animation.setValue("Death",t)}catch(i){window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_KEY__="Death",window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_AT__=Date.now(),window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_ERROR__=i&&i.message?i.message:String(i)}}'
    );
  }

  return {
    source: next,
    applied,
  };
}

function transformScriptSourceForChannel(channel, rel, source) {
  if (channel !== 'facebook') return String(source);
  const result = applyFacebookNoEvalTransforms(rel, source);
  if (result.applied.length) {
    console.log(`[pack-single-html] facebook no-eval patched ${rel}: ${result.applied.join(', ')}`);
  }
  return result.source;
}

function stripFacebookJsonShaderVariants(value) {
  let changed = false;

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        visit(node[i]);
      }
      return;
    }
    if (Object.prototype.hasOwnProperty.call(node, 'glsl3')) {
      delete node.glsl3;
      changed = true;
    }
    for (const child of Object.values(node)) {
      visit(child);
    }
  }

  visit(value);
  return changed;
}

function transformJsonSourceForChannel(channel, rel, source) {
  if (channel !== 'facebook') return String(source);
  const raw = String(source || '');
  if (!/"glsl3"\s*:/.test(raw)) return raw;
  try {
    const data = JSON.parse(raw);
    if (!stripFacebookJsonShaderVariants(data)) return raw;
    const next = JSON.stringify(data);
    const savedBytes = Math.max(0, Buffer.byteLength(raw, 'utf8') - Buffer.byteLength(next, 'utf8'));
    console.log(`[pack-single-html] facebook json trim ${rel}: strip-glsl3 saved=${savedBytes}B`);
    return next;
  } catch (error) {
    console.warn(`[pack-single-html] facebook json trim skipped ${rel}: ${formatErrorMessage(error)}`);
    return raw;
  }
}

function transformAssetBufferForChannel(channel, rel, buf, mime) {
  const raw = buf.toString('utf8');
  if (isJavaScriptAsset(rel, mime)) {
    const next = transformScriptSourceForChannel(channel, rel, raw);
    if (next === raw) return buf;
    return Buffer.from(next, 'utf8');
  }
  if (isJsonAsset(rel, mime)) {
    const next = transformJsonSourceForChannel(channel, rel, raw);
    if (next === raw) return buf;
    return Buffer.from(next, 'utf8');
  }
  return buf;
}

function shouldPack(rel) {
  if (rel === 'index.html') return false;
  if (INLINE_FILES.has(rel)) return false;
  return true;
}

function shouldExcludeFacebookWasmAsset(rel) {
  const normalizedRel = normalizePackRel(rel);
  return /^cocos-js\/assets\/bullet\.release\.wasm-.*\.wasm$/i.test(normalizedRel)
    || /^cocos-js\/bullet\.release\.wasm-.*\.js$/i.test(normalizedRel)
    || /^cocos-js\/assets\/spine-.*\.wasm$/i.test(normalizedRel)
    || /^cocos-js\/spine\.wasm-.*\.js$/i.test(normalizedRel)
    || /^cocos-js\/spine-(?!asm-|js-).+\.js$/i.test(normalizedRel);
}

function shouldPackForChannel(channel, rel) {
  if (!shouldPack(rel)) return false;
  if (channel === 'facebook' && shouldExcludeFacebookWasmAsset(rel)) return false;
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
  if (imageFormat === IMAGE_FORMAT_SMART) return fallbackMime;
  if (imageFormat === IMAGE_FORMAT_PNG) return 'image/png';
  if (imageFormat === IMAGE_FORMAT_WEBP) return 'image/webp';
  if (imageFormat === IMAGE_FORMAT_JPEG) return 'image/jpeg';
  return fallbackMime;
}

function resolveRequestedPythonImageFormat(imageFormat, fallbackMime) {
  if (imageFormat === IMAGE_FORMAT_SMART) {
    return IMAGE_FORMAT_SMART;
  }
  if (imageFormat !== IMAGE_FORMAT_ORIGINAL) {
    return imageFormat;
  }

  const mime = String(fallbackMime || '').toLowerCase();
  if (mime === 'image/webp') {
    return IMAGE_FORMAT_PNG;
  }

  return null;
}

function sniffImageMimeFromBuffer(buffer, fallbackMime) {
  const bytes = asBuffer(buffer);
  if (!bytes || bytes.length < 4) return fallbackMime;
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) {
    return IMAGE_FORMAT_PNG;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return IMAGE_FORMAT_JPEG;
  }
  if (bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50) {
    return IMAGE_FORMAT_WEBP;
  }
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
    '--quality',
    String(quality),
  ];
  const requestedFormat = resolveRequestedPythonImageFormat(imageFormat, fallbackMime);

  if (requestedFormat) {
    args.splice(3, 0, '--format', requestedFormat);
  }

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
  const outputImageFormat = requestedFormat === IMAGE_FORMAT_SMART
    ? sniffImageMimeFromBuffer(buffer, fallbackMime)
    : (requestedFormat || imageFormat);

  return {
    buffer,
    mime: resolveTranscodedMime(outputImageFormat, fallbackMime),
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

async function buildBinaryPack(compressImages, imageQuality, imageFormat, imageMaxDimension, channel = '') {
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
    if (!shouldPackForChannel(channel, rel)) continue;

    stats.fileCount += 1;

    let buf = readBufByAbs(abs);
    const fallbackMime = guessMime(rel);
    let actualMime = fallbackMime;
    const sourceKey = hashBuffer(buf);
    const processedKey = channel && isJavaScriptAsset(rel, fallbackMime)
      ? `${channel}:${rel}:${sourceKey}`
      : (channel && isJsonAsset(rel, fallbackMime)
        ? `${channel}:json:${sourceKey}`
        : sourceKey);
    const cachedProcessed = processedCache.get(processedKey);

    if (cachedProcessed) {
      buf = cachedProcessed.buffer;
      actualMime = cachedProcessed.mime;
      stats.reusedSourceCount += 1;
    } else {
      if (compressImages && compressor && isCompressibleImage(rel, fallbackMime)) {
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
      }

      buf = transformAssetBufferForChannel(channel, rel, buf, actualMime);
      processedCache.set(processedKey, { buffer: buf, mime: actualMime });
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

function makePackBaseUrlExpr(channel) {
  if (channel === 'facebook') {
    return `'https:' + '//' + 'play' + 'able' + '.' + 'invalid' + '/'`;
  }
  return JSON.stringify(PLAYABLE_PACK_BASE_URL);
}

function buildPackStorageTag(tagName, attrs, payload) {
  const normalizedTag = tagName === 'template' ? 'template' : 'textarea';
  return `<${normalizedTag}${attrs} hidden>${escapeHtmlTextNode(payload)}</${normalizedTag}>`;
}

function buildPackChunkTags(chunks, storageTagName = 'textarea') {
  return chunks
    .map((chunk, idx) => buildPackStorageTag(storageTagName, ` class="__PACK_BIN_CHUNK__" data-idx="${idx}" data-pack-kind="chunk"`, chunk))
    .join('\n');
}

function buildPackManifestTag(manifestPayload, storageTagName = 'textarea') {
  return buildPackStorageTag(storageTagName, ` id="__PACK_MANIFEST__" data-pack-kind="manifest"`, manifestPayload);
}

function buildPackInlineDataScript(manifestPayload, chunks) {
  const manifestText = String(manifestPayload || '');
  const payloadText = Array.isArray(chunks) ? chunks.join('') : '';
  const MANIFEST_SEGMENT_SIZE = 64 * 1024;
  const PAYLOAD_SEGMENT_SIZE = 256 * 1024;
  const manifestSegments = chunkString(manifestText, MANIFEST_SEGMENT_SIZE);
  const payloadSegments = chunkString(payloadText, PAYLOAD_SEGMENT_SIZE);
  const lines = ['<script>(function(){', '  var manifestText = "";'];

  for (const segment of manifestSegments) {
    lines.push(`  manifestText += ${JSON.stringify(segment)};`);
  }

  lines.push('  window.__PACK_INLINE_MANIFEST__ = manifestText;');
  lines.push('  var payloadText = "";');

  for (const segment of payloadSegments) {
    lines.push(`  payloadText += ${JSON.stringify(segment)};`);
  }

  lines.push('  window.__PACK_INLINE_PAYLOAD__ = payloadText;');
  lines.push('})();</script>');
  return lines.join('\n');
}

function encodePackManifest(manifestJson, manifestEncoding) {
  if (manifestEncoding === 'utf8-base64') {
    return Buffer.from(manifestJson, 'utf8').toString('base64');
  }
  if (manifestEncoding === 'utf8-base91') {
    return encodeBase91(Buffer.from(manifestJson, 'utf8'));
  }
  return manifestJson;
}

function resolvePackStorageConfig(channel, useBase64) {
  if (channel === 'facebook') {
    return {
      storageMode: 'inline-script',
      nodeTagName: 'template',
      manifestEncoding: useBase64 ? 'utf8-base64' : 'utf8-base91',
    };
  }
  return {
    storageMode: 'dom-node',
    nodeTagName: 'textarea',
    manifestEncoding: 'json',
  };
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


function makeVfsPatchScript(channel) {
  const fetchPropExpr = channel === 'facebook' ? `'fe' + 'tch'` : `'fetch'`;
  const xhrPropExpr = channel === 'facebook' ? `'XML' + 'Http' + 'Request'` : `'XMLHttpRequest'`;
  const packBaseUrlExpr = makePackBaseUrlExpr(channel);
  return String.raw`
(function(){
  function install(){
  const BIN_MANIFEST = window.__PACK_MANIFEST__ || {};
  const BIN_BLOB = window.__PACK_BLOB__ || null;
  const PACK_KEYS = Object.keys(BIN_MANIFEST);
  const RESOLVE_CACHE = Object.create(null);
  const PACK_BASE_URL = ${packBaseUrlExpr};
  const FETCH_PROP = ${fetchPropExpr};
  const XHR_PROP = ${xhrPropExpr};
  const ORIGIN_FETCH = typeof window[FETCH_PROP] === 'function' ? window[FETCH_PROP].bind(window) : null;
  const MIME_BY_EXT = ${JSON.stringify(MIME_BY_EXT)};
  const PACK_AVOID_OBJECT_URL = ${channel === 'facebook' ? 'true' : 'false'};
  const PACK_INLINE_SCRIPT_MODULES = ${channel === 'facebook' ? 'true' : 'false'};
  const PACK_FORCE_BLOBLESS_TRANSPORT = ${channel === 'facebook' ? 'true' : 'false'};
  const FACEBOOK_DIAG_ENABLED = ${channel === 'facebook' ? 'true' : 'false'};
  const OBJECT_URL_PREFIX = PACK_BASE_URL + '__playable_object_url__/';
  const OBJECT_URL_STORE = Object.create(null);
  const IMAGE_PROTO_WRAP_MAP = typeof WeakMap === 'function' ? new WeakMap() : null;
  const NATIVE_URL_API = window.URL || window.webkitURL;
  const NATIVE_OBJECT_URL_CREATE_KEY = 'create' + 'ObjectURL';
  const NATIVE_OBJECT_URL_REVOKE_KEY = 'revoke' + 'ObjectURL';
  const NATIVE_CREATE_OBJECT_URL = NATIVE_URL_API && typeof NATIVE_URL_API[NATIVE_OBJECT_URL_CREATE_KEY] === 'function'
    ? NATIVE_URL_API[NATIVE_OBJECT_URL_CREATE_KEY].bind(NATIVE_URL_API)
    : null;
  const NATIVE_REVOKE_OBJECT_URL = NATIVE_URL_API && typeof NATIVE_URL_API[NATIVE_OBJECT_URL_REVOKE_KEY] === 'function'
    ? NATIVE_URL_API[NATIVE_OBJECT_URL_REVOKE_KEY].bind(NATIVE_URL_API)
    : null;
  let objectUrlSeq = 0;
  const RESOURCE_PENDING = Object.create(null);
  let resourcePendingCount = 0;

  function diagSetWindow(key, value){
    if (!FACEBOOK_DIAG_ENABLED || !key) return;
    try {
      window[key] = value;
    } catch (e) {}
  }

  function trimDiagValue(value, maxLength){
    const limit = Number(maxLength) > 0 ? Number(maxLength) : 96;
    if (value == null) return '';
    let text = '';
    if (typeof value === 'string') {
      text = value;
    } else {
      try {
        text = JSON.stringify(value);
      } catch (error) {
        text = String(value);
      }
    }
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (text.length > limit) {
      text = text.slice(0, Math.max(0, limit - 3)) + '...';
    }
    return text;
  }

  function diagResourceLabel(rel, url){
    let normalizedRel = rel ? String(rel) : '';
    if (!normalizedRel) {
      try {
        normalizedRel = resolveRel(norm(url)) || '';
      } catch (e) {}
    }
    if (normalizedRel) return trimDiagValue(normalizedRel, 112);
    if (url == null) return '';
    return trimDiagValue(String(url), 112);
  }

  function recordResourceStage(kind, stage, rel, url, info){
    if (!FACEBOOK_DIAG_ENABLED) return;
    const label = diagResourceLabel(rel, url);
    const kindLabel = String(kind || '');
    const stageLabel = String(stage || '');
    const summary = kindLabel + ':' + label;
    const infoText = trimDiagValue(info, 120);
    diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_KIND__', kindLabel);
    diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_STAGE__', stageLabel);
    diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_LABEL__', label);
    diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_INFO__', infoText);
    diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_AT__', Date.now());
    if (stageLabel === 'request' || stageLabel === 'open' || stageLabel === 'pending' || stageLabel === 'native') {
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_REQUEST__', summary);
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_REQUEST_INFO__', infoText);
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_REQUEST_AT__', Date.now());
    } else if (stageLabel === 'ok' || stageLabel === 'load' || stageLabel === 'success') {
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_OK__', summary);
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_OK_INFO__', infoText);
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_OK_AT__', Date.now());
    } else if (stageLabel === 'error' || stageLabel === 'fail' || stageLabel === 'timeout' || stageLabel === 'abort') {
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_ERROR__', summary);
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_ERROR_INFO__', infoText);
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_RESOURCE_ERROR_AT__', Date.now());
    }
  }

  function beginPendingResource(kind, rel, url, info){
    if (!FACEBOOK_DIAG_ENABLED) return '';
    const token = String(kind || 'resource') + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    if (!RESOURCE_PENDING[token]) {
      RESOURCE_PENDING[token] = 1;
      resourcePendingCount += 1;
      diagSetWindow('__PLAYABLE_FACEBOOK_PENDING_RESOURCE_COUNT__', resourcePendingCount);
    }
    recordResourceStage(kind, 'pending', rel, url, info);
    return token;
  }

  function settlePendingResource(token, kind, stage, rel, url, info){
    if (!FACEBOOK_DIAG_ENABLED) return;
    if (token && RESOURCE_PENDING[token]) {
      delete RESOURCE_PENDING[token];
      if (resourcePendingCount > 0) resourcePendingCount -= 1;
      diagSetWindow('__PLAYABLE_FACEBOOK_PENDING_RESOURCE_COUNT__', resourcePendingCount);
    }
    recordResourceStage(kind, stage, rel, url, info);
  }

  function getPendingResourceCount(){
    return Number(resourcePendingCount || 0);
  }

  function getLastResourceActivityAt(){
    try {
      return Math.max(
        Number(window.__PLAYABLE_FACEBOOK_LAST_RESOURCE_AT__ || 0),
        Number(window.__PLAYABLE_FACEBOOK_LAST_RESOURCE_REQUEST_AT__ || 0),
        Number(window.__PLAYABLE_FACEBOOK_LAST_RESOURCE_OK_AT__ || 0),
        Number(window.__PLAYABLE_FACEBOOK_LAST_IMAGE_REQUEST_AT__ || 0),
        Number(window.__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT_AT__ || 0)
      );
    } catch (e) {}
    return 0;
  }

  function exposePackVfsApi(){
    try {
      window.__PLAYABLE_PACK_VFS_API__ = {
        resolveHitFromInput: resolveHitFromInput,
        getEntryBytes: getEntryBytes,
        getEntryMime: getEntryMime,
        getPendingResourceCount: getPendingResourceCount,
        getLastResourceActivityAt: getLastResourceActivityAt,
      };
      window.__PLAYABLE_PACK_VFS_API_READY_AT__ = Date.now();
    } catch (e) {}
  }

  function bytesToUtf8(u8){
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(u8);
    }
    let out = '';
    for (let i = 0; i < u8.length; i++) out += '%' + u8[i].toString(16).padStart(2, '0');
    return decodeURIComponent(out);
  }

  function textToBytes(text){
    const value = String(text == null ? '' : text);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(value);
    }
    const encoded = unescape(encodeURIComponent(value));
    const out = new Uint8Array(encoded.length);
    for (let i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i);
    return out;
  }

  function partToBytes(part){
    if (part == null) return new Uint8Array(0);
    if (part instanceof Uint8Array) return part;
    if (typeof ArrayBuffer !== 'undefined') {
      if (part instanceof ArrayBuffer) return new Uint8Array(part);
      if (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(part)) {
        return new Uint8Array(part.buffer, part.byteOffset || 0, part.byteLength || 0);
      }
    }
    if (typeof part === 'string') return textToBytes(part);
    return textToBytes(String(part));
  }

  function concatPartsToBytes(parts){
    if (!parts || !parts.length) return new Uint8Array(0);
    const chunks = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const bytes = partToBytes(parts[i]);
      if (!bytes) continue;
      chunks.push(bytes);
      total += bytes.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].byteLength;
    }
    return out;
  }

  function bytesToBase64(bytes){
    if (!bytes || !bytes.length || typeof btoa !== 'function') return '';
    let out = '';
    // Each independently encoded chunk must end on a 3-byte boundary, otherwise
    // concatenating the chunk base64 strings corrupts the payload.
    const chunkSize = 0x6000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const view = bytes.subarray(i, i + chunkSize);
      let binary = '';
      for (let j = 0; j < view.length; j++) binary += String.fromCharCode(view[j]);
      out += btoa(binary);
    }
    return out;
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

  function canStoreObjectUrlSource(source){
    if (source == null) return false;
    if (typeof Blob !== 'undefined' && source instanceof Blob) return true;
    if (source instanceof Uint8Array) return true;
    if (typeof ArrayBuffer !== 'undefined') {
      if (source instanceof ArrayBuffer) return true;
      if (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(source)) return true;
    }
    return typeof source === 'string';
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
      if (/^blob:/i.test(url)) {
        const nested = norm(url.slice(5));
        if (nested) return nested;
        return null;
      }
      if (/^about:/i.test(url)) {
        url = url.slice(6);
        if (!url || url === 'blank' || url === 'srcdoc') return null;
      }
      if (/^(data:|javascript:)/i.test(url)) return null;
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

  function canonicalizePackUrl(input){
    const resolved = resolveHitFromInput(input);
    if (!resolved.rel) return null;
    try {
      return new URL(resolved.rel, PACK_BASE_URL).href;
    } catch (e) {
      return PACK_BASE_URL + resolved.rel;
    }
  }

  exposePackVfsApi();

  function getScriptText(rel, hit){
    if (!rel || !hit || !isScriptLike(rel)) return null;
    return getEntryText(hit);
  }

  function detectObjectUrlSupport(){
    if (!NATIVE_URL_API || !NATIVE_CREATE_OBJECT_URL) return false;
    try {
      const probeUrl = NATIVE_CREATE_OBJECT_URL(new Blob(['pack-probe'], { type: 'text/plain' }));
      if (!probeUrl || typeof probeUrl !== 'string') return false;
      try {
        if (NATIVE_REVOKE_OBJECT_URL) NATIVE_REVOKE_OBJECT_URL(probeUrl);
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  const PACK_CAN_USE_OBJECT_URL = detectObjectUrlSupport();

  function shouldUseBloblessTransport(){
    return PACK_FORCE_BLOBLESS_TRANSPORT || (PACK_AVOID_OBJECT_URL && !PACK_CAN_USE_OBJECT_URL);
  }

  function getStoredObjectUrlKey(input){
    if (input == null) return null;
    let url = (input && typeof input === 'object' && 'url' in input) ? input.url : input;
    if (url == null) return null;
    if (typeof url !== 'string') url = String(url);
    if (url.indexOf('blob:') === 0) url = url.slice(5);
    if (url.indexOf(OBJECT_URL_PREFIX) === 0) return url.slice(OBJECT_URL_PREFIX.length);
    try {
      const absolute = new URL(url, PACK_BASE_URL).href;
      if (absolute.indexOf(OBJECT_URL_PREFIX) === 0) {
        return absolute.slice(OBJECT_URL_PREFIX.length);
      }
    } catch (e) {}
    return null;
  }

  function getStoredObjectUrlEntry(input){
    const key = getStoredObjectUrlKey(input);
    if (!key) return null;
    return OBJECT_URL_STORE[key] || null;
  }

  function rememberObjectUrlSource(source){
    const key = 'obj-' + (++objectUrlSeq);
    const entry = {
      key: key,
      url: 'blob:' + OBJECT_URL_PREFIX + key,
      source: source,
      mime: source && typeof source.type === 'string' && source.type ? source.type : 'application/octet-stream',
      revoked: false,
      bytes: null,
      bytesPromise: null,
      dataUrl: '',
      dataUrlPromise: null,
    };
    OBJECT_URL_STORE[key] = entry;
    return entry.url;
  }

  function getStoredObjectMime(entry){
    return entry && entry.mime ? entry.mime : 'application/octet-stream';
  }

  function getStoredObjectBytes(entry){
    if (!entry) return Promise.reject(new Error('Missing stored object URL entry'));
    if (entry.bytes) return Promise.resolve(entry.bytes);
    if (entry.bytesPromise) return entry.bytesPromise;

    let promise;
    if (typeof Blob !== 'undefined' && entry.source instanceof Blob && typeof entry.source.arrayBuffer === 'function') {
      promise = entry.source.arrayBuffer().then(function(buffer){
        return new Uint8Array(buffer);
      });
    } else if (entry.source instanceof Uint8Array) {
      promise = Promise.resolve(entry.source);
    } else if (typeof ArrayBuffer !== 'undefined' && entry.source instanceof ArrayBuffer) {
      promise = Promise.resolve(new Uint8Array(entry.source));
    } else if (typeof ArrayBuffer !== 'undefined'
      && typeof ArrayBuffer.isView === 'function'
      && ArrayBuffer.isView(entry.source)) {
      promise = Promise.resolve(new Uint8Array(entry.source.buffer, entry.source.byteOffset || 0, entry.source.byteLength || 0));
    } else {
      promise = Promise.resolve(partToBytes(entry.source));
    }

    entry.bytesPromise = Promise.resolve(promise).then(function(bytes){
      entry.bytes = bytes instanceof Uint8Array ? bytes : partToBytes(bytes);
      return entry.bytes;
    }).catch(function(error){
      entry.bytesPromise = null;
      throw error;
    });

    return entry.bytesPromise;
  }

  function getStoredObjectDataUrl(entry){
    if (!entry) return Promise.reject(new Error('Missing stored object URL entry'));
    if (entry.dataUrl) return Promise.resolve(entry.dataUrl);
    if (entry.dataUrlPromise) return entry.dataUrlPromise;

    entry.dataUrlPromise = getStoredObjectBytes(entry).then(function(bytes){
      entry.dataUrl = 'data:' + getStoredObjectMime(entry) + ';base64,' + bytesToBase64(bytes);
      return entry.dataUrl;
    }).catch(function(error){
      entry.dataUrlPromise = null;
      throw error;
    });

    return entry.dataUrlPromise;
  }

  function createNativeObjectUrl(parts, mime){
    if (!PACK_CAN_USE_OBJECT_URL || !NATIVE_CREATE_OBJECT_URL) return null;
    try {
      const normalizedMime = mime || 'application/octet-stream';
      const blob = new Blob(parts, { type: normalizedMime });
      const resourceUrl = NATIVE_CREATE_OBJECT_URL(blob);
      if (!resourceUrl || typeof resourceUrl !== 'string') return null;
      return {
        url: resourceUrl,
        kind: 'native-blob',
        revoke: function(){
          try {
            if (NATIVE_REVOKE_OBJECT_URL) NATIVE_REVOKE_OBJECT_URL(resourceUrl);
          } catch (e) {}
        },
      };
    } catch (e) {}
    return null;
  }

  function isEmbeddedPreviewForImageTransport(){
    try {
      if (window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT_OVERRIDE__ === false) {
        return false;
      }
      if (window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT_OVERRIDE__ === true) {
        return true;
      }
    } catch (e) {}
    try {
      return window.top !== window;
    } catch (e) {}
    return true;
  }

  function shouldPreferNativeImageObjectUrl(){
    if (!FACEBOOK_DIAG_ENABLED) return false;
    // Meta embedded preview is much less reliable with blob-backed image URLs.
    // Keep native blobs for direct-open local testing, but force data URLs in containers.
    if (isEmbeddedPreviewForImageTransport()) return false;
    return PACK_CAN_USE_OBJECT_URL && !!NATIVE_CREATE_OBJECT_URL;
  }

  function createImageResourceUrl(parts, mime){
    if (shouldPreferNativeImageObjectUrl()) {
      const nativeCreated = createNativeObjectUrl(parts, mime);
      if (nativeCreated) return nativeCreated;
    }
    const created = createResourceUrl(parts, mime);
    if (created && !created.kind) {
      created.kind = String(created.url || '').indexOf('data:') === 0 ? 'data-url' : 'object-url';
    }
    return created;
  }

  function installObjectUrlShim(){
    if (!shouldUseBloblessTransport()) return;
    try {
      const URL_API = window.URL || window.webkitURL;
      if (!URL_API || URL_API.__vfsPatchedObjectUrlShim__) return;
      const createKey = 'create' + 'ObjectURL';
      const revokeKey = 'revoke' + 'ObjectURL';

      const originalCreate = typeof URL_API[createKey] === 'function'
        ? URL_API[createKey].bind(URL_API)
        : null;
      const originalRevoke = typeof URL_API[revokeKey] === 'function'
        ? URL_API[revokeKey].bind(URL_API)
        : null;

      URL_API[createKey] = function(source){
        if (canStoreObjectUrlSource(source)) {
          return rememberObjectUrlSource(source);
        }
        if (originalCreate) {
          return originalCreate(source);
        }
        return '';
      };

      URL_API[revokeKey] = function(url){
        const entry = getStoredObjectUrlEntry(url);
        if (entry) {
          entry.revoked = true;
          return;
        }
        if (originalRevoke) {
          return originalRevoke(url);
        }
      };

      URL_API.__vfsPatchedObjectUrlShim__ = true;
    } catch (e) {}
  }

  function createResourceUrl(parts, mime, preferDataUrl){
    const normalizedMime = mime || 'application/octet-stream';
    if (preferDataUrl || shouldUseBloblessTransport()) {
      const bytes = concatPartsToBytes(parts);
      return {
        url: 'data:' + normalizedMime + ';base64,' + bytesToBase64(bytes),
        revoke: function(){},
      };
    }
    const URL_API = window.URL || window.webkitURL;
    const createKey = 'create' + 'ObjectURL';
    const revokeKey = 'revoke' + 'ObjectURL';
    if (!URL_API || typeof URL_API[createKey] !== 'function') return null;
    const blob = new Blob(parts, { type: normalizedMime });
    const resourceUrl = URL_API[createKey](blob);
    return {
      url: resourceUrl,
      revoke: function(){
        try {
          if (typeof URL_API[revokeKey] === 'function') URL_API[revokeKey](resourceUrl);
        } catch (e) {}
      },
    };
  }

  function patchSystemShouldFetch(){
    try {
      const S = window.System;
      if (!S || !S.constructor || !S.constructor.prototype) return;
      const proto = S.constructor.prototype;
      if (proto.__vfsPatchedShouldFetch__) return;

      const originalResolve = typeof proto.resolve === 'function'
        ? proto.resolve
        : null;
      const originalInstantiate = typeof proto.instantiate === 'function'
        ? proto.instantiate
        : null;
      const originalShouldFetch = typeof proto.shouldFetch === 'function'
        ? proto.shouldFetch
        : function(){ return false; };
      const originalSystemFetch = typeof proto[FETCH_PROP] === 'function'
        ? proto[FETCH_PROP]
        : null;

      if (originalResolve) {
        proto.resolve = function(specifier, parentUrl){
          const resolvedUrl = originalResolve.call(this, specifier, parentUrl);
          return canonicalizePackUrl(resolvedUrl) || resolvedUrl;
        };
      }

      proto.shouldFetch = function(url){
        const resolved = resolveHitFromInput(url);
        if (resolved.rel) {
          const scriptText = getScriptText(resolved.rel, resolved.hit);
          if (scriptText != null) {
            if (PACK_INLINE_SCRIPT_MODULES) return false;
            return originalShouldFetch.call(this, url);
          }
        }
        return originalShouldFetch.call(this, url);
      };

      proto[FETCH_PROP] = function(url, init){
        const objectUrlEntry = getStoredObjectUrlEntry(url);
        const resolved = resolveHitFromInput(url);
        const pendingToken = beginPendingResource(
          'fetch',
          resolved.rel,
          url,
          objectUrlEntry
            ? 'system-stored'
            : (resolved.rel ? 'system-pack' : 'system-native')
        );
        if (objectUrlEntry) {
          return toStoredObjectResponse(objectUrlEntry, init).then(function(response){
            settlePendingResource(pendingToken, 'fetch', 'ok', resolved.rel, url, getStoredObjectMime(objectUrlEntry));
            return response;
          }).catch(function(error){
            settlePendingResource(pendingToken, 'fetch', 'error', resolved.rel, url, error);
            throw error;
          });
        }
        if (resolved.rel) {
          const response = toResponse(resolved.rel, init);
          if (response) {
            settlePendingResource(pendingToken, 'fetch', 'ok', resolved.rel, url, getEntryMime(resolved.rel));
            return Promise.resolve(response);
          }
        }
        if (originalSystemFetch) {
          return Promise.resolve(originalSystemFetch.call(this, url, init)).then(function(response){
            settlePendingResource(
              pendingToken,
              'fetch',
              'ok',
              resolved.rel,
              url,
              'system-native:' + String(response && typeof response.status !== 'undefined' ? response.status : '')
            );
            return response;
          }).catch(function(error){
            settlePendingResource(pendingToken, 'fetch', 'error', resolved.rel, url, error);
            throw error;
          });
        }
        if (ORIGIN_FETCH) {
          return Promise.resolve(ORIGIN_FETCH(url, init)).then(function(response){
            settlePendingResource(
              pendingToken,
              'fetch',
              'ok',
              resolved.rel,
              url,
              'origin-native:' + String(response && typeof response.status !== 'undefined' ? response.status : '')
            );
            return response;
          }).catch(function(error){
            settlePendingResource(pendingToken, 'fetch', 'error', resolved.rel, url, error);
            throw error;
          });
        }
        settlePendingResource(pendingToken, 'fetch', 'error', resolved.rel, url, 'No fetch available');
        return Promise.reject(new Error('No fetch available'));
      };

      proto.instantiate = function(url, parentUrl){
        const resolved = resolveHitFromInput(url);
        if (resolved.rel) {
          const scriptText = getScriptText(resolved.rel, resolved.hit);
          if (scriptText != null && PACK_INLINE_SCRIPT_MODULES) {
            const sourceUrl = canonicalizePackUrl(resolved.rel) || String(url || resolved.rel);
            const host = document.head || document.documentElement || document.body;
            if (!host) {
              window.__PLAYABLE_PACK_INSTANTIATE_ERROR__ = 'No script host available';
              window.__PLAYABLE_PACK_INSTANTIATE_ERROR_AT__ = Date.now();
              window.__PLAYABLE_PACK_INSTANTIATE_LAST_REL__ = resolved.rel;
              throw new Error('No script host available for ' + resolved.rel);
            }

            window.__PLAYABLE_PACK_INSTANTIATE_LAST_REL__ = resolved.rel;
            window.__PLAYABLE_PACK_INSTANTIATE_LAST_URL__ = sourceUrl;
            window.__PLAYABLE_PACK_INSTANTIATE_LAST_PARENT__ = parentUrl ? String(parentUrl) : '';
            window.__PLAYABLE_PACK_INSTANTIATE_LAST_AT__ = Date.now();

            const scriptNode = document.createElement('script');
            scriptNode.async = false;
            scriptNode.type = 'text/javascript';
            scriptNode.setAttribute('data-pack-inline-module', resolved.rel);
            try {
              scriptNode.text = scriptText + '\n//# sourceURL=' + sourceUrl;
            } catch (error) {
              scriptNode.textContent = scriptText + '\n//# sourceURL=' + sourceUrl;
            }

            host.appendChild(scriptNode);
            try {
              if (scriptNode.parentNode) {
                scriptNode.parentNode.removeChild(scriptNode);
              }
            } catch (error) {}

            const registration = typeof this.getRegister === 'function'
              ? this.getRegister()
              : (window.System && typeof window.System.getRegister === 'function'
                ? window.System.getRegister()
                : null);

            if (!registration) {
              window.__PLAYABLE_PACK_INSTANTIATE_ERROR__ = 'System.register result missing';
              window.__PLAYABLE_PACK_INSTANTIATE_ERROR_AT__ = Date.now();
              throw new Error('System.register result missing for ' + resolved.rel);
            }

            window.__PLAYABLE_PACK_INSTANTIATE_DONE_AT__ = Date.now();
            return registration;
          }
        }

        if (originalInstantiate) {
          return originalInstantiate.call(this, url, parentUrl);
        }
        throw new Error('No instantiate available');
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
          const requested = this && this.__vfsRequestedSrc__;
          if (requested) return requested;
          return origGet ? origGet.call(this) : '';
        },
        set: function(v){
          const resolved = resolveHitFromInput(v);
          const rel = resolved.rel;
          const scriptText = getScriptText(rel, resolved.hit);
          if (scriptText != null) {
            if (PACK_INLINE_SCRIPT_MODULES) {
              setInstanceValue(this, '__vfsRequestedSrc__', v == null ? '' : String(v));
              const scriptUrl = canonicalizePackUrl(rel) || (v == null ? '' : String(v));
              setInstanceValue(this, '__vfsInlinePackScriptText__', scriptText);
              setInstanceValue(this, '__vfsInlinePackScriptRel__', rel);
              try {
                const EP = window.Element && window.Element.prototype;
                const rawSetAttribute = EP && typeof EP.setAttribute === 'function'
                  ? EP.setAttribute
                  : null;
                if (rawSetAttribute) {
                  rawSetAttribute.call(this, 'src', scriptUrl);
                }
              } catch (e) {}
              return;
            }
            if (PACK_AVOID_OBJECT_URL && !PACK_CAN_USE_OBJECT_URL) {
              return origSet.call(this, v);
            }
            const created = createResourceUrl([scriptText], getEntryMime(rel) || 'text/javascript');
            if (created) {
              if (typeof this.addEventListener === 'function') {
                const self = this;
                const cleanup = function(){
                  created.revoke();
                  try { self.removeEventListener('load', cleanup); } catch (e) {}
                  try { self.removeEventListener('error', cleanup); } catch (e) {}
                };
                this.addEventListener('load', cleanup);
                this.addEventListener('error', cleanup);
              }
              return origSet.call(this, created.url);
            }
          }
          setInstanceValue(this, '__vfsInlinePackScriptText__', null);
          setInstanceValue(this, '__vfsInlinePackScriptRel__', null);
          setInstanceValue(this, '__vfsRequestedSrc__', v == null ? '' : String(v));
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
    function dispatchScriptLoad(node){
      if (!node || !node.__vfsInlinePackScript__ || node.__vfsInlinePackScriptLoaded__) return;
      try {
        if (!node.parentNode) return;
        if (typeof node.isConnected === 'boolean' && !node.isConnected) return;
        if (typeof Event === 'function' && typeof node.dispatchEvent === 'function') {
          node.__vfsInlinePackScriptLoaded__ = true;
          node.dispatchEvent(new Event('load'));
          return;
        }
        if (document && typeof document.createEvent === 'function' && typeof node.dispatchEvent === 'function') {
          const evt = document.createEvent('Event');
          evt.initEvent('load', false, false);
          node.__vfsInlinePackScriptLoaded__ = true;
          node.dispatchEvent(evt);
        }
      } catch (e) {}
    }

    function patchScriptNode(node){
      try {
        if (!node || !node.tagName || String(node.tagName).toLowerCase() !== 'script') return;

        let rel = node.__vfsInlinePackScriptRel__ || null;
        let scriptText = node.__vfsInlinePackScriptText__ || null;
        let src = '';
        if (scriptText == null) {
          try {
            if (typeof node.getAttribute === 'function') src = node.getAttribute('src') || '';
          } catch (e) {}
          if (!src) {
            try { src = node.src || ''; } catch (e) {}
          }

          const resolved = resolveHitFromInput(src);
          rel = resolved.rel;
          scriptText = getScriptText(rel, resolved.hit);
        }
        if (scriptText == null) return;

        try { if (typeof node.removeAttribute === 'function') node.removeAttribute('src'); } catch (e) {}
        try { node.text = scriptText; } catch (e) { try { node.textContent = scriptText; } catch (e2) {} }
        node.__vfsInlinePackScript__ = true;
        node.__vfsInlinePackScriptText__ = null;
        node.__vfsInlinePackScriptRel__ = rel || null;
        if (typeof node.addEventListener === 'function' && !node.__vfsInlinePackScriptLoadTracked__) {
          node.addEventListener('load', function(){
            node.__vfsInlinePackScriptLoaded__ = true;
          });
          node.__vfsInlinePackScriptLoadTracked__ = true;
        }
      } catch (e) {}
    }

    try {
      const NP = window.Node && window.Node.prototype;
      if (!NP) return;

      if (typeof NP.appendChild === 'function' && !NP.__vfsPatchedAppendChild__) {
        const origAppendChild = NP.appendChild;
        NP.appendChild = function(node){
          patchScriptNode(node);
          const result = origAppendChild.call(this, node);
          if (PACK_INLINE_SCRIPT_MODULES) dispatchScriptLoad(node);
          return result;
        };
        NP.__vfsPatchedAppendChild__ = true;
      }

      if (typeof NP.insertBefore === 'function' && !NP.__vfsPatchedInsertBefore__) {
        const origInsertBefore = NP.insertBefore;
        NP.insertBefore = function(node, refNode){
          patchScriptNode(node);
          const result = origInsertBefore.call(this, node, refNode);
          if (PACK_INLINE_SCRIPT_MODULES) dispatchScriptLoad(node);
          return result;
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

  function toStoredObjectResponse(entry, init){
    return getStoredObjectBytes(entry).then(function(bytes){
      const headers = new Headers((init && init.headers) || {});
      if (!headers.has('Content-Type')) headers.set('Content-Type', getStoredObjectMime(entry));
      return new Response(bytes, { status: 200, headers });
    });
  }

  if (ORIGIN_FETCH) {
    window[FETCH_PROP] = function(input, init){
      const objectUrlEntry = getStoredObjectUrlEntry(input);
      const resolved = resolveHitFromInput(input);
      const pendingToken = beginPendingResource(
        'fetch',
        resolved.rel,
        input,
        objectUrlEntry ? 'window-stored' : (resolved.rel ? 'window-pack' : 'window-native')
      );
      if (objectUrlEntry) {
        return toStoredObjectResponse(objectUrlEntry, init).then(function(response){
          settlePendingResource(pendingToken, 'fetch', 'ok', resolved.rel, input, getStoredObjectMime(objectUrlEntry));
          return response;
        }).catch(function(error){
          settlePendingResource(pendingToken, 'fetch', 'error', resolved.rel, input, error);
          throw error;
        });
      }
      if (resolved.rel) {
        const response = toResponse(resolved.rel, init);
        if (response) {
          settlePendingResource(pendingToken, 'fetch', 'ok', resolved.rel, input, getEntryMime(resolved.rel));
          return Promise.resolve(response);
        }
      }
      return Promise.resolve(ORIGIN_FETCH(input, init)).then(function(response){
        settlePendingResource(
          pendingToken,
          'fetch',
          'ok',
          resolved.rel,
          input,
          'window-native:' + String(response && typeof response.status !== 'undefined' ? response.status : '')
        );
        return response;
      }).catch(function(error){
        settlePendingResource(pendingToken, 'fetch', 'error', resolved.rel, input, error);
        throw error;
      });
    };
  }

  patchSystemShouldFetch();
  patchScriptSrc();
  patchScriptInsertion();
  installObjectUrlShim();

  function setInstanceValue(target, key, value){
    if (!target || !key) return;
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: value,
      });
      return;
    } catch (e) {}
    try {
      target[key] = value;
    } catch (e) {}
  }

  function createDomEvent(type){
    try {
      if (typeof Event === 'function') return new Event(type);
    } catch (e) {}
    try {
      if (document && typeof document.createEvent === 'function') {
        const evt = document.createEvent('Event');
        evt.initEvent(type, false, false);
        return evt;
      }
    } catch (e) {}
    return { type: type };
  }

  function dispatchTargetEvent(target, type){
    const evt = createDomEvent(type);
    try {
      if (target && typeof target.dispatchEvent === 'function') {
        target.dispatchEvent(evt);
        return;
      }
    } catch (e) {}
    try {
      const handler = target && target['on' + type];
      if (typeof handler === 'function') handler.call(target, evt);
    } catch (e) {}
  }

  function getXhrTextBody(bytes){
    return bytesToUtf8(bytes);
  }

  function buildXhrResponseBody(xhr, bytes, mime){
    const responseType = String((xhr && xhr.responseType) || '').toLowerCase();
    if (responseType === 'arraybuffer') {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    if (responseType === 'blob') {
      return new Blob([bytes], { type: mime || 'application/octet-stream' });
    }
    const text = getXhrTextBody(bytes);
    if (responseType === 'json') {
      try {
        return text ? JSON.parse(text) : null;
      } catch (e) {
        return null;
      }
    }
    return text;
  }

  function createHeaderAccessors(headers){
    const keys = Object.keys(headers || {});
    return {
      getAllResponseHeaders: function(){
        return keys.map(function(key){ return key + ': ' + headers[key]; }).join('\r\n');
      },
      getResponseHeader: function(name){
        const normalized = String(name || '').toLowerCase();
        for (let i = 0; i < keys.length; i++) {
          if (String(keys[i]).toLowerCase() === normalized) return headers[keys[i]];
        }
        return null;
      },
    };
  }

  function deliverXhrPayload(xhr, bytes, mime, responseURL){
    const response = buildXhrResponseBody(xhr, bytes, mime);
    const textBody = String((xhr && xhr.responseType) || '').toLowerCase() === 'arraybuffer'
      || String((xhr && xhr.responseType) || '').toLowerCase() === 'blob'
      ? null
      : getXhrTextBody(bytes);
    const headers = {
      'content-type': mime || 'application/octet-stream',
      'content-length': String(bytes.byteLength || bytes.length || 0),
    };
    const accessors = createHeaderAccessors(headers);

    setInstanceValue(xhr, '__vfs_has_memory_payload__', true);
    setInstanceValue(xhr, '__vfs_status__', 200);
    setInstanceValue(xhr, '__vfs_statusText__', 'OK');
    setInstanceValue(xhr, '__vfs_responseURL__', responseURL);
    setInstanceValue(xhr, '__vfs_response__', response);
    if (textBody != null) setInstanceValue(xhr, '__vfs_responseText__', textBody);
    setInstanceValue(xhr, '__vfs_getAllResponseHeaders__', accessors.getAllResponseHeaders);
    setInstanceValue(xhr, '__vfs_getResponseHeader__', accessors.getResponseHeader);

    setInstanceValue(xhr, 'status', 200);
    setInstanceValue(xhr, 'statusText', 'OK');
    setInstanceValue(xhr, 'responseURL', responseURL);
    setInstanceValue(xhr, 'response', response);
    if (textBody != null) setInstanceValue(xhr, 'responseText', textBody);
    setInstanceValue(xhr, 'getAllResponseHeaders', accessors.getAllResponseHeaders);
    setInstanceValue(xhr, 'getResponseHeader', accessors.getResponseHeader);

    setInstanceValue(xhr, '__vfs_readyState__', 2);
    setInstanceValue(xhr, 'readyState', 2);
    dispatchTargetEvent(xhr, 'readystatechange');
    setInstanceValue(xhr, '__vfs_readyState__', 3);
    setInstanceValue(xhr, 'readyState', 3);
    dispatchTargetEvent(xhr, 'readystatechange');
    setInstanceValue(xhr, '__vfs_readyState__', 4);
    setInstanceValue(xhr, 'readyState', 4);
    dispatchTargetEvent(xhr, 'readystatechange');
    dispatchTargetEvent(xhr, 'load');
    dispatchTargetEvent(xhr, 'loadend');
  }

  function deliverXhrFromMemory(xhr, rel, hit){
    const bytes = getEntryBytes(hit);
    if (!bytes) throw new Error('Missing pack payload for ' + rel);
    deliverXhrPayload(xhr, bytes, getEntryMime(rel), canonicalizePackUrl(rel) || String(xhr.__vfs_url__ || rel || ''));
  }

  function deliverXhrFromStoredObject(xhr, entry){
    return getStoredObjectBytes(entry).then(function(bytes){
      deliverXhrPayload(xhr, bytes, getStoredObjectMime(entry), entry.url || String(xhr.__vfs_url__ || ''));
    });
  }

  function failXhrFromMemory(xhr, rel, error){
    setInstanceValue(xhr, '__vfs_has_memory_payload__', true);
    setInstanceValue(xhr, '__vfs_status__', 0);
    setInstanceValue(xhr, '__vfs_statusText__', '');
    setInstanceValue(xhr, '__vfs_responseURL__', canonicalizePackUrl(rel) || String(xhr.__vfs_url__ || rel || ''));
    setInstanceValue(xhr, '__vfs_readyState__', 4);
    setInstanceValue(xhr, 'status', 0);
    setInstanceValue(xhr, 'statusText', '');
    setInstanceValue(xhr, 'responseURL', canonicalizePackUrl(rel) || String(xhr.__vfs_url__ || rel || ''));
    setInstanceValue(xhr, 'readyState', 4);
    dispatchTargetEvent(xhr, 'readystatechange');
    dispatchTargetEvent(xhr, 'error');
    dispatchTargetEvent(xhr, 'loadend');
  }

  function ensureXhrDiagListeners(xhr){
    if (!FACEBOOK_DIAG_ENABLED || !xhr || xhr.__vfsFacebookDiagListenersAttached__) return;
    if (typeof xhr.addEventListener !== 'function') return;

    function settle(stage, info){
      const pendingToken = xhr.__vfs_fb_diag_pending_token__ || '';
      settlePendingResource(
        pendingToken,
        'xhr',
        stage,
        xhr.__vfs_fb_diag_rel__ || '',
        xhr.__vfs_url__ || '',
        info
      );
      xhr.__vfs_fb_diag_pending_token__ = '';
    }

    xhr.addEventListener('load', function(){
      settle('ok', 'status=' + String(xhr && typeof xhr.status !== 'undefined' ? xhr.status : ''));
    });
    xhr.addEventListener('error', function(){
      settle('error', 'status=' + String(xhr && typeof xhr.status !== 'undefined' ? xhr.status : 0));
    });
    xhr.addEventListener('abort', function(){
      settle('abort', 'xhr-abort');
    });
    xhr.addEventListener('timeout', function(){
      settle('timeout', 'xhr-timeout');
    });
    xhr.__vfsFacebookDiagListenersAttached__ = true;
  }

  const XHR = window[XHR_PROP];
  if (XHR) {
    const xhrProto = XHR.prototype;
    if (xhrProto && !xhrProto.__vfsMemoryAccessorsInstalled__) {
      function wrapXhrStateProp(name, storageKey){
        try {
          const desc = Object.getOwnPropertyDescriptor(xhrProto, name);
          if (desc && desc.configurable === false) return false;
          const originalGet = desc && typeof desc.get === 'function' ? desc.get : null;
          const originalSet = desc && typeof desc.set === 'function' ? desc.set : null;
          Object.defineProperty(xhrProto, name, {
            configurable: true,
            enumerable: desc ? !!desc.enumerable : false,
            get: function(){
              if (this && this.__vfs_has_memory_payload__ && Object.prototype.hasOwnProperty.call(this, storageKey)) {
                return this[storageKey];
              }
              if (originalGet) {
                try {
                  return originalGet.call(this);
                } catch (e) {}
              }
              return this && Object.prototype.hasOwnProperty.call(this, storageKey) ? this[storageKey] : undefined;
            },
            set: function(value){
              if (originalSet) {
                try {
                  originalSet.call(this, value);
                  return;
                } catch (e) {}
              }
              try {
                this[storageKey] = value;
              } catch (e) {}
            },
          });
          return true;
        } catch (e) {}
        return false;
      }

      function wrapXhrStateMethod(name, storageKey){
        try {
          const original = typeof xhrProto[name] === 'function' ? xhrProto[name] : null;
          xhrProto[name] = function(){
            if (this && this.__vfs_has_memory_payload__ && typeof this[storageKey] === 'function') {
              return this[storageKey].apply(this, arguments);
            }
            if (original) {
              return original.apply(this, arguments);
            }
            return name === 'getAllResponseHeaders' ? '' : null;
          };
          return true;
        } catch (e) {}
        return false;
      }

      wrapXhrStateProp('readyState', '__vfs_readyState__');
      wrapXhrStateProp('status', '__vfs_status__');
      wrapXhrStateProp('statusText', '__vfs_statusText__');
      wrapXhrStateProp('responseURL', '__vfs_responseURL__');
      wrapXhrStateProp('response', '__vfs_response__');
      wrapXhrStateProp('responseText', '__vfs_responseText__');
      wrapXhrStateMethod('getAllResponseHeaders', '__vfs_getAllResponseHeaders__');
      wrapXhrStateMethod('getResponseHeader', '__vfs_getResponseHeader__');
      xhrProto.__vfsMemoryAccessorsInstalled__ = true;
    }

    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    const setRequestHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function(method, url, async, user, password){
      ensureXhrDiagListeners(this);
      this.__vfs_method__ = method;
      this.__vfs_url__ = url;
      this.__vfs_async__ = async;
      this.__vfs_user__ = user;
      this.__vfs_password__ = password;
      this.__vfs_headers__ = [];
      this.__vfs_object_url_entry__ = getStoredObjectUrlEntry(url);
      if (this.__vfs_object_url_entry__) {
        this.__vfs_short_circuit_open__ = true;
        return;
      }
      const resolved = resolveHitFromInput(url);
      this.__vfs_fb_diag_rel__ = resolved.rel || '';
      recordResourceStage('xhr', 'open', resolved.rel, url, method);
      if (resolved.rel) {
        this.__vfs_short_circuit_open__ = true;
        return;
      }
      this.__vfs_short_circuit_open__ = false;
      return open.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function(name, value){
      if (this.__vfs_headers__) this.__vfs_headers__.push([name, value]);
      if (this.__vfs_short_circuit_open__) return;
      return setRequestHeader.apply(this, arguments);
    };

    XHR.prototype.send = function(body){
      const objectUrlEntry = this.__vfs_object_url_entry__ || getStoredObjectUrlEntry(this.__vfs_url__);
      this.__vfs_fb_diag_pending_token__ = beginPendingResource(
        'xhr',
        this.__vfs_fb_diag_rel__ || '',
        this.__vfs_url__ || '',
        objectUrlEntry ? 'stored' : (this.__vfs_short_circuit_open__ ? 'pack' : 'native')
      );
      if (objectUrlEntry) {
        const self = this;
        const runStoredObject = function(){
          dispatchTargetEvent(self, 'loadstart');
          deliverXhrFromStoredObject(self, objectUrlEntry).catch(function(error){
            failXhrFromMemory(self, objectUrlEntry.url || String(self.__vfs_url__ || ''), error);
          });
        };
        if (this.__vfs_async__ === false && objectUrlEntry.bytes) {
          deliverXhrPayload(this, objectUrlEntry.bytes, getStoredObjectMime(objectUrlEntry), objectUrlEntry.url || String(this.__vfs_url__ || ''));
          return;
        }
        setTimeout(runStoredObject, 0);
        return;
      }

      const resolved = resolveHitFromInput(this.__vfs_url__);
      const rel = resolved.rel;
      const hit = resolved.hit;
      if (!hit) return send.apply(this, arguments);

      if (shouldUseBloblessTransport()) {
        const self = this;
        const run = function(){
          dispatchTargetEvent(self, 'loadstart');
          try {
            deliverXhrFromMemory(self, rel, hit);
          } catch (error) {
            failXhrFromMemory(self, rel, error);
          }
        };
        if (this.__vfs_async__ === false) {
          run();
          return;
        }
        setTimeout(run, 0);
        return;
      }

      try {
        const mime = getEntryMime(rel);
        const bytes = getEntryBytes(hit);
        if (!bytes) return send.apply(this, arguments);
        const payload = bytes;
        const created = createResourceUrl([payload], mime);
        if (!created) return send.apply(this, arguments);
        const self = this;

        const cleanup = function(){
          created.revoke();
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

        if (this.__vfs_short_circuit_open__) {
          if (asyncFlag === undefined) {
            open.call(this, method, created.url);
          } else {
            open.call(this, method, created.url, asyncFlag, user, password);
          }
        } else if (asyncFlag === undefined) {
          open.call(this, method, created.url);
        } else {
          open.call(this, method, created.url, asyncFlag, user, password);
        }

        for (let i = 0; i < headers.length; i++) {
          const pair = headers[i];
          try { setRequestHeader.call(this, pair[0], pair[1]); } catch (e) {}
        }

        return send.call(this, body == null ? null : body);
      } catch (e) {
        settlePendingResource(
          this.__vfs_fb_diag_pending_token__ || '',
          'xhr',
          'error',
          this.__vfs_fb_diag_rel__ || rel || '',
          this.__vfs_url__ || '',
          e
        );
        this.__vfs_fb_diag_pending_token__ = '';
        return send.apply(this, arguments);
      }
    };
  }

  function assignVirtualImageSrc(target, desc, value){
    function debugImagePatch(stage, payload){
      try {
        if (!window.__PLAYABLE_FACEBOOK_DEBUG_IMAGE__) return;
        console.log('[fb-image-patch]', stage, JSON.stringify(payload || {}));
      } catch (e) {}
    }
    function clearImageDiagProbe(){
      if (!target) return;
      try {
        if (target.__vfs_fb_diag_probe_timer__) {
          clearTimeout(target.__vfs_fb_diag_probe_timer__);
        }
      } catch (e) {}
      target.__vfs_fb_diag_probe_timer__ = 0;
      target.__vfs_fb_diag_probe_token__ = '';
      target.__vfs_fb_diag_synthetic_event__ = '';
    }
    function dispatchSyntheticImageEvent(type, info){
      if (!target || typeof target.dispatchEvent !== 'function') return false;
      let event = null;
      try {
        if (typeof Event === 'function') {
          event = new Event(type);
        }
      } catch (e) {}
      if (!event) {
        try {
          if (document && typeof document.createEvent === 'function') {
            event = document.createEvent('Event');
            event.initEvent(type, false, false);
          }
        } catch (e) {}
      }
      if (!event) return false;
      try {
        target.__vfs_fb_diag_synthetic_event__ = String(type || '');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_PROBE__', String(type || ''));
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_PROBE_INFO__', info || '');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_PROBE_AT__', Date.now());
      } catch (e) {}
      try {
        target.dispatchEvent(event);
        return true;
      } catch (error) {}
      return false;
    }
    function armImageDiagProbe(rel, originalUrl, created, info){
      if (!FACEBOOK_DIAG_ENABLED || !target || typeof setTimeout !== 'function') return;
      if (!created || (created.kind !== 'data-url' && created.kind !== 'data-url-fallback')) return;
      clearImageDiagProbe();
      const pendingToken = String(target.__vfs_fb_diag_pending_token__ || '');
      if (!pendingToken) return;
      target.__vfs_fb_diag_probe_token__ = pendingToken;
      const probeSteps = [180, 450, 1000, 2200, 4200];
      let probeIndex = 0;
      const probe = function(stage){
        if (!target) return;
        if (!target.__vfs_fb_diag_pending_token__) return;
        if (String(target.__vfs_fb_diag_pending_token__) !== String(target.__vfs_fb_diag_probe_token__ || pendingToken)) return;
        const width = Number(target.naturalWidth || target.width || 0);
        const height = Number(target.naturalHeight || target.height || 0);
        const sizeLabel = String(width) + 'x' + String(height);
        if (target.complete && (width > 0 || height > 0)) {
          debugImagePatch('synthetic-load', {
            src: String(originalUrl || ''),
            rel: rel || '',
            stage: stage || 'probe',
            size: sizeLabel,
          });
          dispatchSyntheticImageEvent('load', String(stage || 'probe') + ':' + sizeLabel);
          return;
        }
        probeIndex += 1;
        if (probeIndex >= probeSteps.length) {
          diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_PROBE__', 'waiting');
          diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_PROBE_INFO__', String(stage || 'probe') + ':' + sizeLabel);
          diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_PROBE_AT__', Date.now());
          return;
        }
        target.__vfs_fb_diag_probe_timer__ = setTimeout(function(){
          probe('timer-' + String(probeIndex));
        }, probeSteps[probeIndex]);
      };
      target.__vfs_fb_diag_probe_timer__ = setTimeout(function(){
        probe('timer-0');
      }, probeSteps[probeIndex]);
      try {
        if (typeof target.decode === 'function') {
          Promise.resolve(target.decode()).then(function(){
            setTimeout(function(){
              probe('decode');
            }, 180);
          }).catch(function(){
            setTimeout(function(){
              probe('decode-reject');
            }, 180);
          });
        }
      } catch (e) {}
    }
    function ensureImageDiagListeners(){
      if (!FACEBOOK_DIAG_ENABLED || !target || target.__vfsFacebookDiagListenersAttached__) return;
      if (typeof target.addEventListener !== 'function') return;
      target.addEventListener('load', function(){
        const sizeLabel = String(Number(target.naturalWidth || target.width || 0)) + 'x' + String(Number(target.naturalHeight || target.height || 0));
        const syntheticLabel = target.__vfs_fb_diag_synthetic_event__ === 'load' ? ':synthetic' : '';
        clearImageDiagProbe();
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT__', 'load');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT_INFO__', sizeLabel + syntheticLabel);
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT_AT__', Date.now());
        settlePendingResource(
          target.__vfs_fb_diag_pending_token__ || '',
          'img',
          'load',
          target.__vfs_fb_diag_rel__ || '',
          target.__vfs_fb_diag_url__ || target.currentSrc || target.src || '',
          sizeLabel + syntheticLabel
        );
        target.__vfs_fb_diag_pending_token__ = '';
      });
      target.addEventListener('error', function(){
        const syntheticLabel = target.__vfs_fb_diag_synthetic_event__ === 'error' ? ':synthetic' : '';
        clearImageDiagProbe();
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT__', 'error');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT_INFO__', 'image-error' + syntheticLabel);
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT_AT__', Date.now());
        settlePendingResource(
          target.__vfs_fb_diag_pending_token__ || '',
          'img',
          'error',
          target.__vfs_fb_diag_rel__ || '',
          target.__vfs_fb_diag_url__ || target.currentSrc || target.src || '',
          'image-error' + syntheticLabel
        );
        target.__vfs_fb_diag_pending_token__ = '';
      });
      target.__vfsFacebookDiagListenersAttached__ = true;
    }
    function beginImageDiag(rel, url, info){
      if (!FACEBOOK_DIAG_ENABLED || !target) return;
      ensureImageDiagListeners();
      clearImageDiagProbe();
      if (target.__vfs_fb_diag_pending_token__) {
        settlePendingResource(
          target.__vfs_fb_diag_pending_token__,
          'img',
          'abort',
          target.__vfs_fb_diag_rel__ || '',
          target.__vfs_fb_diag_url__ || '',
          'src-replaced'
        );
      }
      target.__vfs_fb_diag_rel__ = rel || '';
      target.__vfs_fb_diag_url__ = url == null ? '' : String(url);
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_REQUEST__', diagResourceLabel(rel, url));
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_REQUEST_INFO__', info || '');
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_REQUEST_AT__', Date.now());
      target.__vfs_fb_diag_pending_token__ = beginPendingResource('img', rel, url, info);
    }
    function attachImageUrlCleanup(created){
      if (!created || typeof created.revoke !== 'function' || typeof target.addEventListener !== 'function') return;
      const cleanup = function(){
        try { created.revoke(); } catch (e) {}
        try { target.removeEventListener('load', cleanup); } catch (e) {}
        try { target.removeEventListener('error', cleanup); } catch (e) {}
      };
      target.addEventListener('load', cleanup);
      target.addEventListener('error', cleanup);
    }
    function setImageWithCreatedUrl(rel, originalUrl, bytes, mime, created, info){
      if (!created) return false;
      debugImagePatch('image-url', {
        src: String(originalUrl || ''),
        rel: rel || '',
        mime: mime || '',
        bytes: bytes && (bytes.byteLength || bytes.length || 0) || 0,
        kind: created.kind || '',
        urlPrefix: String(created.url || '').slice(0, 48),
      });
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT__', created.kind || '');
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_REL__', rel || '');
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_INFO__', info || '');
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_AT__', Date.now());
      attachImageUrlCleanup(created);
      if (created.kind === 'native-blob' && bytes && typeof target.addEventListener === 'function') {
        let retried = false;
        const fallbackToDataUrl = function(){
          if (retried) return;
          retried = true;
          try { target.removeEventListener('error', fallbackToDataUrl); } catch (e) {}
          const fallbackUrl = 'data:' + (mime || 'application/octet-stream') + ';base64,' + bytesToBase64(bytes);
          debugImagePatch('native-blob-fallback', {
            src: String(originalUrl || ''),
            rel: rel || '',
            mime: mime || '',
            bytes: bytes.byteLength || bytes.length || 0,
          });
          beginImageDiag(rel || '', originalUrl, (info || 'pack-hit') + '-data-fallback');
          diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT__', 'data-url-fallback');
          diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_REL__', rel || '');
          diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_INFO__', info || '');
          diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_AT__', Date.now());
          clearImageCrossOrigin();
          try {
            desc.set.call(target, fallbackUrl);
          } catch (error) {
            settlePendingResource(target.__vfs_fb_diag_pending_token__ || '', 'img', 'error', rel, originalUrl, error);
            target.__vfs_fb_diag_pending_token__ = '';
            throw error;
          }
        };
        const clearFallback = function(){
          try { target.removeEventListener('load', clearFallback); } catch (e) {}
          try { target.removeEventListener('error', fallbackToDataUrl); } catch (e) {}
        };
        target.addEventListener('error', fallbackToDataUrl);
        target.addEventListener('load', clearFallback);
      }
      clearImageCrossOrigin();
      try {
        desc.set.call(target, created.url);
        armImageDiagProbe(rel, originalUrl, created, info);
      } catch (error) {
        settlePendingResource(target.__vfs_fb_diag_pending_token__ || '', 'img', 'error', rel, originalUrl, error);
        target.__vfs_fb_diag_pending_token__ = '';
        throw error;
      }
      return true;
    }
    function clearImageCrossOrigin(){
      try {
        if (target && 'crossOrigin' in target) {
          target.crossOrigin = null;
        }
      } catch (e) {}
      try {
        if (target && typeof target.removeAttribute === 'function') {
          target.removeAttribute('crossorigin');
        }
      } catch (e) {}
    }

    const objectUrlEntry = getStoredObjectUrlEntry(value);
    if (objectUrlEntry) {
      beginImageDiag('', value, 'stored-object');
      getStoredObjectBytes(objectUrlEntry).then(function(bytes){
        const mime = getStoredObjectMime(objectUrlEntry);
        const created = createImageResourceUrl([bytes], mime);
        if (setImageWithCreatedUrl('', value, bytes, mime, created, 'stored-object')) {
          return;
        }
        const fallbackUrl = 'data:' + mime + ';base64,' + bytesToBase64(bytes);
        debugImagePatch('object-url-data-fallback', {
          src: String(value || ''),
          mime: mime,
          bytes: bytes.byteLength || bytes.length || 0,
        });
        clearImageCrossOrigin();
        try {
          desc.set.call(target, fallbackUrl);
        } catch (error) {
          settlePendingResource(target.__vfs_fb_diag_pending_token__ || '', 'img', 'error', '', value, error);
          target.__vfs_fb_diag_pending_token__ = '';
          throw error;
        }
      }).catch(function(error){
        debugImagePatch('object-url-fallback', {
          src: String(value || ''),
          error: error && error.message ? error.message : String(error || ''),
        });
        clearImageCrossOrigin();
        try {
          desc.set.call(target, value);
        } catch (innerError) {
          settlePendingResource(target.__vfs_fb_diag_pending_token__ || '', 'img', 'error', '', value, innerError);
          target.__vfs_fb_diag_pending_token__ = '';
          throw innerError;
        }
      });
      return;
    }

    const resolved = resolveHitFromInput(value);
    const rel = resolved.rel;
    const hit = resolved.hit;
    beginImageDiag(rel || '', value, hit ? 'pack-hit' : 'native');
    if (hit) {
      const bytes = getEntryBytes(hit);
      if (bytes) {
        const mime = getEntryMime(rel);
        const created = createImageResourceUrl([bytes], mime);
        if (setImageWithCreatedUrl(rel, value, bytes, mime, created, 'pack-hit')) {
          return;
        }
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT__', 'pack-hit-no-url');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_REL__', rel || '');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_INFO__', mime || '');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_AT__', Date.now());
      } else {
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT__', 'pack-hit-no-bytes');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_REL__', rel || '');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_INFO__', '');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_AT__', Date.now());
      }
    } else {
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT__', 'native-src');
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_REL__', rel || '');
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_INFO__', '');
      diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT_AT__', Date.now());
    }

    debugImagePatch('miss', { src: String(value || '') });
    try {
      desc.set.call(target, value);
    } catch (error) {
      settlePendingResource(target.__vfs_fb_diag_pending_token__ || '', 'img', 'error', rel, value, error);
      target.__vfs_fb_diag_pending_token__ = '';
      throw error;
    }
  }

  function patchImageElementPrototype(proto){
    try {
      if (!proto || proto.__vfsPatchedImageSrc__) return;
      const desc = Object.getOwnPropertyDescriptor(proto, 'src');
      if (!desc || typeof desc.set !== 'function') return;
      const origGet = desc.get;
      Object.defineProperty(proto, 'src', {
        configurable: true,
        enumerable: !!desc.enumerable,
        get: function(){
          return origGet ? origGet.call(this) : '';
        },
        set: function(v){
          assignVirtualImageSrc(this, desc, v);
        }
      });
      if (typeof proto.setAttribute === 'function' && !proto.__vfsPatchedImageSetAttribute__) {
        const origSetAttribute = proto.setAttribute;
        proto.setAttribute = function(name, value){
          if (String(name || '').toLowerCase() === 'src') {
            this.src = value;
            return;
          }
          return origSetAttribute.call(this, name, value);
        };
        proto.__vfsPatchedImageSetAttribute__ = true;
      }
      proto.__vfsPatchedImageSrc__ = true;
    } catch (e) {}
  }

  function findImageSrcDescriptor(proto){
    let current = proto || null;
    while (current) {
      const desc = Object.getOwnPropertyDescriptor(current, 'src');
      if (desc && typeof desc.set === 'function') return desc;
      current = Object.getPrototypeOf(current);
    }
    return null;
  }

  const IMAGE_SRC_DESCRIPTOR = findImageSrcDescriptor(window.HTMLImageElement && window.HTMLImageElement.prototype)
    || findImageSrcDescriptor(window.Image && window.Image.prototype);

  function getWrappedImagePrototype(proto){
    if (!proto || !IMAGE_SRC_DESCRIPTOR) return null;
    if (IMAGE_PROTO_WRAP_MAP && IMAGE_PROTO_WRAP_MAP.has(proto)) {
      return IMAGE_PROTO_WRAP_MAP.get(proto);
    }
    try {
      const wrappedProto = Object.create(proto);
      Object.defineProperty(wrappedProto, 'src', {
        configurable: true,
        enumerable: true,
        get: function(){
          return IMAGE_SRC_DESCRIPTOR.get ? IMAGE_SRC_DESCRIPTOR.get.call(this) : '';
        },
        set: function(v){
          assignVirtualImageSrc(this, IMAGE_SRC_DESCRIPTOR, v);
        }
      });
      if (typeof proto.setAttribute === 'function') {
        wrappedProto.setAttribute = function(name, value){
          if (String(name || '').toLowerCase() === 'src') {
            this.src = value;
            return;
          }
          return proto.setAttribute.call(this, name, value);
        };
      }
      if (IMAGE_PROTO_WRAP_MAP) {
        IMAGE_PROTO_WRAP_MAP.set(proto, wrappedProto);
      }
      return wrappedProto;
    } catch (e) {}
    return null;
  }

  function wrapImageInstance(target){
    try {
      if (!target || !IMAGE_SRC_DESCRIPTOR || target.__vfsWrappedImageInstance__) return target;
      const currentProto = Object.getPrototypeOf(target);
      const wrappedProto = getWrappedImagePrototype(currentProto);
      if (wrappedProto && typeof Object.setPrototypeOf === 'function') {
        Object.setPrototypeOf(target, wrappedProto);
        target.__vfsWrappedImageInstance__ = true;
        return target;
      }
      Object.defineProperty(target, 'src', {
        configurable: true,
        enumerable: true,
        get: function(){
          return IMAGE_SRC_DESCRIPTOR.get ? IMAGE_SRC_DESCRIPTOR.get.call(this) : '';
        },
        set: function(v){
          assignVirtualImageSrc(this, IMAGE_SRC_DESCRIPTOR, v);
        }
      });
      target.__vfsWrappedImageInstance__ = true;
    } catch (e) {}
    return target;
  }

  patchImageElementPrototype(window.HTMLImageElement && window.HTMLImageElement.prototype);
  patchImageElementPrototype(window.Image && window.Image.prototype);

  try {
    if (document && typeof document.createElement === 'function' && !document.__vfsPatchedCreateElementForImage__) {
      const originalCreateElement = document.createElement;
      document.createElement = function(name){
        const node = originalCreateElement.apply(this, arguments);
        if (String(name || '').toLowerCase() === 'img') {
          wrapImageInstance(node);
        }
        return node;
      };
      document.__vfsPatchedCreateElementForImage__ = true;
    }
  } catch (e) {}

  try {
    const NativeImage = window.Image;
    if (typeof NativeImage === 'function' && !NativeImage.__vfsWrappedConstructor__) {
      let WrappedImage = null;
      try {
        WrappedImage = class WrappedImage extends NativeImage {
          constructor(w, h){
            super(w, h);
            this.__vfsWrappedImageInstance__ = true;
          }
          get src(){
            return IMAGE_SRC_DESCRIPTOR && IMAGE_SRC_DESCRIPTOR.get
              ? IMAGE_SRC_DESCRIPTOR.get.call(this)
              : '';
          }
          set src(v){
            assignVirtualImageSrc(this, IMAGE_SRC_DESCRIPTOR, v);
          }
        };
      } catch (e) {}
      if (WrappedImage) {
        WrappedImage.__vfsWrappedConstructor__ = true;
        window.Image = WrappedImage;
      }
    }
  } catch (e) {}
  }

  const ready = window.__PACK_BOOTSTRAP_READY__;
  if (ready && typeof ready.then === 'function') {
    ready.then(function(){ install(); }).catch(function(){ install(); });
    return;
  }

  install();
})();`.trim();
}

function makeFacebookMetaCompatScript() {
  return String.raw`
(function(){
  if (window.__CHANNEL__ !== 'facebook') return;

  window.__PLAYABLE_FACEBOOK_META_COMPAT__ = true;
  window.__PLAYABLE_FACEBOOK_HOST_ONLY_OPEN__ = true;
  window.__PLAYABLE_DISABLE_AUTO_PAUSE__ = true;
  window.__PLAYABLE_FACEBOOK_ALLOW_WASM__ = false;
  window.__PLAYABLE_FACEBOOK_WASM_MODE__ = 'asm-only';
  window.__PLAYABLE_FACEBOOK_APPSTATE_OVERRIDDEN__ = false;
  window.__PLAYABLE_FACEBOOK_RUNTIME_PATCH__ = 'event-blocker-v17-hide-webgl2-device-manager-force-webgl1-camera-create-window-webgl-image-canvas';

  function defineConstantProperty(target, key, value){
    if (!target || !key) return;
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: false,
        get: function(){ return value; }
      });
      return true;
    } catch (e) {}
    try {
      target[key] = value;
      return target[key] === value;
    } catch (e) {}
    return false;
  }

  function isArrayBufferViewLike(value){
    try {
      if (typeof ArrayBuffer !== 'undefined') {
        if (value instanceof ArrayBuffer) return true;
        if (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(value)) return true;
      }
    } catch (e) {}
    return false;
  }

  const textureUploadCanvasMap = typeof WeakMap === 'function' ? new WeakMap() : null;
  const wrappedWebGLContextMap = typeof WeakMap === 'function' ? new WeakMap() : null;

  function getLocationProtocol(){
    try {
      return String(window.location && window.location.protocol || '').toLowerCase();
    } catch (e) {}
    return '';
  }

  function getLocationHref(){
    try {
      return String(window.location && window.location.href || '');
    } catch (e) {}
    return '';
  }

  function getDocumentReferrer(){
    try {
      return String(document && document.referrer || '');
    } catch (e) {}
    return '';
  }

  function isEmbeddedPreview(){
    try {
      return window.top !== window;
    } catch (e) {}
    return true;
  }

  function resolveAggressiveCompatMode(){
    try {
      if (window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT_OVERRIDE__ === false) {
        return false;
      }
      if (window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT_OVERRIDE__ === true) {
        return true;
      }
    } catch (e) {}
    return isEmbeddedPreview();
  }

  function shouldUseAggressiveCompat(reason){
    const enabled = resolveAggressiveCompatMode();
    try {
      window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT__ = enabled;
      window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT_MODE__ = enabled ? 'embedded' : 'direct-open';
      if (reason) {
        window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT_REASON__ = String(reason || '');
        window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT_REASON_AT__ = Date.now();
      }
    } catch (e) {}
    return enabled;
  }

  function getPackVfsApi(){
    try {
      if (window.__PLAYABLE_PACK_VFS_API__ && typeof window.__PLAYABLE_PACK_VFS_API__ === 'object') {
        return window.__PLAYABLE_PACK_VFS_API__;
      }
    } catch (e) {}
    return null;
  }

  function resolvePackHitFromInput(input){
    try {
      const api = getPackVfsApi();
      if (api && typeof api.resolveHitFromInput === 'function') {
        const resolved = api.resolveHitFromInput(input);
        if (resolved && typeof resolved === 'object') {
          return resolved;
        }
      }
    } catch (e) {}
    return { rel: null, hit: null };
  }

  function getPackEntryBytes(hit){
    try {
      const api = getPackVfsApi();
      if (api && typeof api.getEntryBytes === 'function') {
        return api.getEntryBytes(hit);
      }
    } catch (e) {}
    return null;
  }

  function getPackEntryMime(rel){
    try {
      const api = getPackVfsApi();
      if (api && typeof api.getEntryMime === 'function') {
        return api.getEntryMime(rel);
      }
    } catch (e) {}
    return '';
  }

  function getPackPendingResourceCount(){
    try {
      const api = getPackVfsApi();
      if (api && typeof api.getPendingResourceCount === 'function') {
        return Number(api.getPendingResourceCount() || 0);
      }
    } catch (e) {}
    try {
      return Number(window.__PLAYABLE_FACEBOOK_PENDING_RESOURCE_COUNT__ || 0);
    } catch (e) {}
    return 0;
  }

  function getPackLastResourceActivityAt(){
    try {
      const api = getPackVfsApi();
      if (api && typeof api.getLastResourceActivityAt === 'function') {
        return Number(api.getLastResourceActivityAt() || 0);
      }
    } catch (e) {}
    try {
      return Math.max(
        Number(window.__PLAYABLE_FACEBOOK_LAST_RESOURCE_AT__ || 0),
        Number(window.__PLAYABLE_FACEBOOK_LAST_RESOURCE_REQUEST_AT__ || 0),
        Number(window.__PLAYABLE_FACEBOOK_LAST_RESOURCE_OK_AT__ || 0),
        Number(window.__PLAYABLE_FACEBOOK_LAST_IMAGE_REQUEST_AT__ || 0),
        Number(window.__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT_AT__ || 0)
      );
    } catch (e) {}
    return 0;
  }

  function bytesToBase64Compat(bytes){
    if (!bytes || !bytes.length || typeof btoa !== 'function') return '';
    let out = '';
    const chunkSize = 0x6000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const view = bytes.subarray(i, i + chunkSize);
      let binary = '';
      for (let j = 0; j < view.length; j++) binary += String.fromCharCode(view[j]);
      out += btoa(binary);
    }
    return out;
  }

  function shouldForceOpaquePreviewWebGL1(){
    try {
      if (window.__PLAYABLE_FACEBOOK_FORCE_WEBGL1_OVERRIDE__ === false) {
        window.__PLAYABLE_FACEBOOK_FORCE_WEBGL1_REASON__ = 'override-false';
        return false;
      }
      if (window.__PLAYABLE_FACEBOOK_FORCE_WEBGL1_OVERRIDE__ === true) {
        window.__PLAYABLE_FACEBOOK_FORCE_WEBGL1_REASON__ = 'override-true';
        return true;
      }
    } catch (e) {}

    window.__PLAYABLE_FACEBOOK_FORCE_WEBGL1_REASON__ = 'facebook-channel';
    return true;
  }

  const forceOpaquePreviewWebGL1 = shouldForceOpaquePreviewWebGL1();
  const initialAggressiveCompat = shouldUseAggressiveCompat('bootstrap-init');
  window.__PLAYABLE_FACEBOOK_FORCE_WEBGL1__ = forceOpaquePreviewWebGL1;
  window.__PLAYABLE_FACEBOOK_FORCE_WEBGL1_PROTOCOL__ = getLocationProtocol();
  window.__PLAYABLE_FACEBOOK_FORCE_WEBGL1_EMBED__ = isEmbeddedPreview();
  window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT_INITIAL__ = initialAggressiveCompat;

  if (forceOpaquePreviewWebGL1) {
    try {
      if (defineConstantProperty(window, 'WebGL2RenderingContext', undefined)) {
        window.__PLAYABLE_FACEBOOK_WEBGL2_CTOR_PATCHED__ = true;
        window.__PLAYABLE_FACEBOOK_WEBGL2_CTOR_PATCHED_AT__ = Date.now();
      }
    } catch (e) {}
    try {
      if (typeof globalThis === 'object' && globalThis && globalThis !== window) {
        defineConstantProperty(globalThis, 'WebGL2RenderingContext', undefined);
      }
    } catch (e) {}
  }

  function isWebGLContextName(name){
    return name === 'webgl'
      || name === 'experimental-webgl'
      || name === 'webgl2'
      || name === 'experimental-webgl2';
  }

  function detectResolvedGLContextName(gl, requestedName){
    try {
      if (window.WebGL2RenderingContext && gl instanceof window.WebGL2RenderingContext) {
        return 'webgl2';
      }
    } catch (e) {}
    try {
      if (window.WebGLRenderingContext && gl instanceof window.WebGLRenderingContext) {
        return 'webgl';
      }
    } catch (e) {}
    return requestedName || 'webgl';
  }

  function getSafeTextureUploadSource(source){
    try {
      if (!source || typeof source !== 'object' || isArrayBufferViewLike(source)) {
        return source;
      }

      const isImageElement = (window.HTMLImageElement && source instanceof window.HTMLImageElement)
        || (!!source.tagName && String(source.tagName).toUpperCase() === 'IMG');
      if (!isImageElement) {
        return source;
      }

      const width = Math.max(0, Math.round(Number(source.naturalWidth || source.width || 0)));
      const height = Math.max(0, Math.round(Number(source.naturalHeight || source.height || 0)));
      if (!width || !height || !document || typeof document.createElement !== 'function') {
        return source;
      }

      let canvas = textureUploadCanvasMap ? textureUploadCanvasMap.get(source) : source.__fbPlayableTextureUploadCanvas__;
      if (!canvas) {
        canvas = document.createElement('canvas');
        if (textureUploadCanvasMap) {
          textureUploadCanvasMap.set(source, canvas);
        } else {
          source.__fbPlayableTextureUploadCanvas__ = canvas;
        }
      }

      if (!canvas) {
        return source;
      }

      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (!ctx || typeof ctx.drawImage !== 'function') {
        return source;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);

      window.__PLAYABLE_FACEBOOK_LAST_TEXTURE_UPLOAD_SOURCE__ = 'canvas';
      window.__PLAYABLE_FACEBOOK_LAST_TEXTURE_UPLOAD_AT__ = Date.now();
      return canvas;
    } catch (error) {
      try {
        window.__PLAYABLE_FACEBOOK_LAST_TEXTURE_UPLOAD_ERROR__ = error && error.message ? error.message : String(error);
      } catch (e) {}
      return source;
    }
  }

  function patchWebGLTextureUploadProto(proto){
    if (!proto || proto.__fbPlayableTextureUploadPatched__) return;

    function wrapMethod(name){
      const original = proto[name];
      if (typeof original !== 'function') return;
      proto[name] = function(){
        if (!arguments.length) {
          return original.apply(this, arguments);
        }
        const args = Array.prototype.slice.call(arguments);
        const sourceIndex = args.length - 1;
        args[sourceIndex] = getSafeTextureUploadSource(args[sourceIndex]);
        return original.apply(this, args);
      };
    }

    wrapMethod('texImage2D');
    wrapMethod('texSubImage2D');
    proto.__fbPlayableTextureUploadPatched__ = true;
  }

  function patchWebGLContextInstance(gl, requestedName){
    if (!gl || typeof gl !== 'object') {
      return gl;
    }

    try {
      if (wrappedWebGLContextMap && wrappedWebGLContextMap.has(gl)) {
        return gl;
      }
      if (!wrappedWebGLContextMap && gl.__fbPlayableContextWrapped__) {
        return gl;
      }
    } catch (e) {}

    function wrapTextureUpload(name){
      const original = gl[name];
      if (typeof original !== 'function') return;
      try {
        gl[name] = function(){
          if (!arguments.length) {
            return original.apply(this, arguments);
          }
          const args = Array.prototype.slice.call(arguments);
          const sourceIndex = args.length - 1;
          args[sourceIndex] = getSafeTextureUploadSource(args[sourceIndex]);
          return original.apply(this, args);
        };
      } catch (e) {}
    }

    function wrapMarker(name, markerKey){
      const original = gl[name];
      if (typeof original !== 'function') return;
      try {
        gl[name] = function(){
          try {
            window[markerKey] = (window[markerKey] || 0) + 1;
            window.__PLAYABLE_FACEBOOK_LAST_GL_CALL__ = name;
            window.__PLAYABLE_FACEBOOK_LAST_GL_CALL_AT__ = Date.now();
            if (name === 'bindFramebuffer') {
              window.__PLAYABLE_FACEBOOK_LAST_FRAMEBUFFER_TARGET__ = arguments[1] == null ? 'default' : 'custom';
            }
          } catch (e) {}
          return original.apply(this, arguments);
        };
      } catch (e) {}
    }

    wrapTextureUpload('texImage2D');
    wrapTextureUpload('texSubImage2D');
    wrapMarker('drawArrays', '__PLAYABLE_FACEBOOK_DRAW_ARRAYS_COUNT__');
    wrapMarker('drawElements', '__PLAYABLE_FACEBOOK_DRAW_ELEMENTS_COUNT__');
    wrapMarker('drawArraysInstanced', '__PLAYABLE_FACEBOOK_DRAW_ARRAYS_INSTANCED_COUNT__');
    wrapMarker('drawElementsInstanced', '__PLAYABLE_FACEBOOK_DRAW_ELEMENTS_INSTANCED_COUNT__');
    wrapMarker('drawRangeElements', '__PLAYABLE_FACEBOOK_DRAW_RANGE_ELEMENTS_COUNT__');
    wrapMarker('clear', '__PLAYABLE_FACEBOOK_CLEAR_COUNT__');
    wrapMarker('useProgram', '__PLAYABLE_FACEBOOK_USE_PROGRAM_COUNT__');
    wrapMarker('bindFramebuffer', '__PLAYABLE_FACEBOOK_BIND_FRAMEBUFFER_COUNT__');

    const resolvedName = detectResolvedGLContextName(gl, requestedName);
    try {
      window.__PLAYABLE_FACEBOOK_LAST_CONTEXT_NAME__ = resolvedName;
      window.__PLAYABLE_FACEBOOK_LAST_CONTEXT_REQUEST__ = requestedName || '';
      window.__PLAYABLE_FACEBOOK_LAST_CONTEXT_AT__ = Date.now();
    } catch (e) {}

    try {
      if (wrappedWebGLContextMap) {
        wrappedWebGLContextMap.set(gl, true);
      } else {
        gl.__fbPlayableContextWrapped__ = true;
      }
    } catch (e) {}
    return gl;
  }

  function patchCanvasGetContext(){
    const proto = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
    if (!proto || proto.__fbPlayableGetContextPatched__) return;

    const originalGetContext = proto.getContext;
    if (typeof originalGetContext !== 'function') return;

    proto.getContext = function(type){
      const requestedName = String(type == null ? '' : type).toLowerCase();
      try {
        window.__PLAYABLE_FACEBOOK_LAST_CONTEXT_REQUEST__ = requestedName;
        window.__PLAYABLE_FACEBOOK_LAST_CONTEXT_REQUEST_AT__ = Date.now();
        const attrs = arguments.length > 1 ? arguments[1] : null;
        window.__PLAYABLE_FACEBOOK_LAST_CONTEXT_OPTIONS__ = attrs == null ? '' : JSON.stringify(attrs);
      } catch (e) {}

      if (forceOpaquePreviewWebGL1 && (requestedName === 'webgl2' || requestedName === 'experimental-webgl2')) {
        try {
          window.__PLAYABLE_FACEBOOK_LAST_CONTEXT_BLOCKED__ = requestedName;
          window.__PLAYABLE_FACEBOOK_LAST_CONTEXT_BLOCKED_AT__ = Date.now();
        } catch (e) {}
        return null;
      }

      const ctx = originalGetContext.apply(this, arguments);
      if (!ctx || !isWebGLContextName(requestedName)) {
        return ctx;
      }
      return patchWebGLContextInstance(ctx, requestedName);
    };

    proto.__fbPlayableGetContextPatched__ = true;
  }

  function patchWebGLTextureUploads(){
    try {
      patchWebGLTextureUploadProto(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
    } catch (e) {}
    try {
      patchWebGLTextureUploadProto(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
    } catch (e) {}
  }

  defineConstantProperty(document, 'hidden', false);
  defineConstantProperty(document, 'webkitHidden', false);
  defineConstantProperty(document, 'msHidden', false);
  defineConstantProperty(document, 'visibilityState', 'visible');
  defineConstantProperty(document, 'webkitVisibilityState', 'visible');
  defineConstantProperty(document, 'msVisibilityState', 'visible');

  try {
    document.hasFocus = function(){ return true; };
  } catch (e) {}

  patchCanvasGetContext();
  patchWebGLTextureUploads();

  function createDomEvent(type){
    try {
      if (typeof Event === 'function') return new Event(type);
    } catch (e) {}
    try {
      if (document && typeof document.createEvent === 'function') {
        const evt = document.createEvent('Event');
        evt.initEvent(type, false, false);
        return evt;
      }
    } catch (e) {}
    return { type: type };
  }

  function getPlayableCanvas(cc){
    try {
      if (cc && cc.game && cc.game.canvas) return cc.game.canvas;
    } catch (e) {}
    try {
      return document.getElementById('GameCanvas');
    } catch (e) {}
    return null;
  }

  function getViewportSize(canvas){
    let width = 0;
    let height = 0;

    try {
      if (canvas && typeof canvas.getBoundingClientRect === 'function') {
        const rect = canvas.getBoundingClientRect();
        width = Math.max(width, Math.round(rect && rect.width ? rect.width : 0));
        height = Math.max(height, Math.round(rect && rect.height ? rect.height : 0));
      }
    } catch (e) {}

    try {
      const parent = canvas && canvas.parentElement;
      if (parent && typeof parent.getBoundingClientRect === 'function') {
        const rect = parent.getBoundingClientRect();
        width = Math.max(width, Math.round(rect && rect.width ? rect.width : 0));
        height = Math.max(height, Math.round(rect && rect.height ? rect.height : 0));
      }
    } catch (e) {}

    try {
      width = Math.max(width, Math.round(window.innerWidth || 0));
      height = Math.max(height, Math.round(window.innerHeight || 0));
    } catch (e) {}

    try {
      const docEl = document && document.documentElement;
      if (docEl) {
        width = Math.max(width, Math.round(docEl.clientWidth || 0));
        height = Math.max(height, Math.round(docEl.clientHeight || 0));
      }
    } catch (e) {}

    return { width: width, height: height };
  }

  function getCanvasInternalSize(canvas){
    let width = 0;
    let height = 0;

    try {
      width = Math.max(width, Math.round(Number(canvas && canvas.width) || 0));
      height = Math.max(height, Math.round(Number(canvas && canvas.height) || 0));
    } catch (e) {}

    try {
      if (canvas && typeof canvas.getAttribute === 'function') {
        width = Math.max(width, Math.round(Number(canvas.getAttribute('width')) || 0));
        height = Math.max(height, Math.round(Number(canvas.getAttribute('height')) || 0));
      }
    } catch (e) {}

    return { width: width, height: height };
  }

  function forceViewRefresh(cc, reason){
    if (window.__fbPlayableViewRefreshLock__) return false;
    window.__fbPlayableViewRefreshLock__ = true;
    try {
      const view = cc && cc.view;
      const canvas = getPlayableCanvas(cc);
      const size = getViewportSize(canvas);
      const internalSize = getCanvasInternalSize(canvas);
      if (!view) return false;

      const needsRecovery = !!canvas
        && size.width > 0
        && size.height > 0
        && (internalSize.width <= 1 || internalSize.height <= 1);

      window.__PLAYABLE_FACEBOOK_LAST_VIEWPORT__ = size.width + 'x' + size.height;
      window.__PLAYABLE_FACEBOOK_LAST_CANVAS_INTERNAL__ = internalSize.width + 'x' + internalSize.height;
      window.__PLAYABLE_FACEBOOK_LAST_VIEW_REFRESH_REASON__ = reason || '';

      if (!needsRecovery) {
        return false;
      }

      try {
        if (typeof view.setFrameSize === 'function') {
          view.setFrameSize(size.width, size.height);
        }
      } catch (e) {}
      try {
        if (typeof view.setCanvasSize === 'function') {
          view.setCanvasSize(size.width, size.height);
        }
      } catch (e) {}
      try {
        canvas.width = size.width;
        canvas.height = size.height;
      } catch (e) {}
      try {
        if (typeof canvas.setAttribute === 'function') {
          canvas.setAttribute('width', String(size.width));
          canvas.setAttribute('height', String(size.height));
        }
      } catch (e) {}

      try {
        if (typeof view.resizeWithBrowserSize === 'function') {
          view.resizeWithBrowserSize(true);
        }
      } catch (e) {}
      try {
        if (typeof view._updateAdaptResult === 'function') {
          view._updateAdaptResult();
        }
      } catch (e) {}

      window.__PLAYABLE_FACEBOOK_LAST_VIEW_REFRESH_AT__ = Date.now();
      return true;
    } catch (e) {}
    finally {
      window.__fbPlayableViewRefreshLock__ = false;
    }
    return false;
  }

  function installViewportWatchdog(){
    if (window.__fbPlayableViewportWatchdogInstalled__) return;

    let lastKey = '';
    let attempts = 0;
    const timer = setInterval(function(){
      attempts += 1;
      const size = getViewportSize(getPlayableCanvas(window.cc));
      const key = [
        size.width,
        size.height,
        document && document.visibilityState ? document.visibilityState : '',
      ].join('x');

      if (key !== lastKey) {
        lastKey = key;
        forceViewRefresh(window.cc, 'viewport-watchdog');
      }

      if (attempts >= 40) {
        clearInterval(timer);
      }
    }, 250);

    ['resize', 'orientationchange', 'pageshow', 'focus', 'message'].forEach(function(eventName){
      try {
        window.addEventListener(eventName, function(){
          forceViewRefresh(window.cc, 'event:' + eventName);
        }, true);
      } catch (e) {}
    });

    window.__fbPlayableViewportWatchdogInstalled__ = true;
  }

  function installAnimationFrameWatchdog(){
    if (window.__fbPlayableRafWatchdogInstalled__) return;

    const nativeRAF = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : null;
    const nativeCAF = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : null;
    const fallbackDelay = 50;
    let nextHandle = 1;
    const active = Object.create(null);

    function nowTs(){
      try {
        if (window.performance && typeof window.performance.now === 'function') {
          return window.performance.now();
        }
      } catch (e) {}
      return Date.now();
    }

    function cancelEntry(entry){
      if (!entry || entry.done) return;
      entry.done = true;
      delete active[entry.handle];
      if (entry.timerId != null) {
        clearTimeout(entry.timerId);
        entry.timerId = null;
      }
      if (entry.nativeHandle != null && nativeCAF) {
        try {
          nativeCAF(entry.nativeHandle);
        } catch (e) {}
        entry.nativeHandle = null;
      }
    }

    function flushEntry(entry, source, timestamp){
      if (!entry || entry.done) return;
      entry.done = true;
      delete active[entry.handle];
      if (entry.timerId != null) {
        clearTimeout(entry.timerId);
        entry.timerId = null;
      }
      if (source !== 'native' && entry.nativeHandle != null && nativeCAF) {
        try {
          nativeCAF(entry.nativeHandle);
        } catch (e) {}
      }
      entry.nativeHandle = null;
      window.__PLAYABLE_FACEBOOK_LAST_RAF_SOURCE__ = source;
      window.__PLAYABLE_FACEBOOK_LAST_RAF_AT__ = Date.now();
      const tick = typeof timestamp === 'number' ? timestamp : nowTs();
      try {
        entry.callback(tick);
      } catch (error) {
        setTimeout(function(){ throw error; }, 0);
      }
    }

    function scheduleFallback(entry){
      entry.timerId = setTimeout(function(){
        flushEntry(entry, 'timeout', nowTs());
      }, fallbackDelay);
    }

    function wrappedRAF(callback){
      if (typeof callback !== 'function') {
        const noop = function(){};
        return nativeRAF ? nativeRAF(noop) : setTimeout(noop, fallbackDelay);
      }

      const handle = nextHandle++;
      const entry = {
        handle: handle,
        callback: callback,
        nativeHandle: null,
        timerId: null,
        done: false,
      };
      active[handle] = entry;
      scheduleFallback(entry);

      if (nativeRAF) {
        try {
          entry.nativeHandle = nativeRAF(function(timestamp){
            flushEntry(entry, 'native', timestamp);
          });
        } catch (e) {
          entry.nativeHandle = null;
        }
      }

      return handle;
    }

    function wrappedCAF(handle){
      const entry = active[handle];
      if (entry) {
        cancelEntry(entry);
        return;
      }
      if (nativeCAF) {
        try {
          nativeCAF(handle);
          return;
        } catch (e) {}
      }
      clearTimeout(handle);
    }

    window.requestAnimationFrame = wrappedRAF;
    window.cancelAnimationFrame = wrappedCAF;
    try { window.webkitRequestAnimationFrame = wrappedRAF; } catch (e) {}
    try { window.webkitCancelAnimationFrame = wrappedCAF; } catch (e) {}
    try { window.mozRequestAnimationFrame = wrappedRAF; } catch (e) {}
    try { window.mozCancelAnimationFrame = wrappedCAF; } catch (e) {}
    try { window.msRequestAnimationFrame = wrappedRAF; } catch (e) {}
    try { window.msCancelAnimationFrame = wrappedCAF; } catch (e) {}

    window.__PLAYABLE_FACEBOOK_RAF_WATCHDOG__ = 'timeout-backstop-v1';
    window.__PLAYABLE_FACEBOOK_RAF_TIMEOUT_MS__ = fallbackDelay;
    window.__fbPlayableRafWatchdogInstalled__ = true;
  }

  installAnimationFrameWatchdog();
  installViewportWatchdog();

  function installEventBlocker(target, blockedEvents, marker){
    if (!target || typeof target.addEventListener !== 'function' || target[marker]) return;
    const originalAddEventListener = target.addEventListener;
    blockedEvents.forEach(function(eventName){
      originalAddEventListener.call(target, eventName, function(event){
        window.__PLAYABLE_FACEBOOK_LAST_BLOCKED_EVENT__ = eventName;
        window.__PLAYABLE_FACEBOOK_LAST_BLOCKED_EVENT_AT__ = Date.now();
        if (event && typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
        if (event && typeof event.stopPropagation === 'function') {
          event.stopPropagation();
        }
        if (event && typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        return false;
      }, true);
    });
    target[marker] = true;
  }

  function patchAddEventListener(target, blockedEvents, marker){
    if (!target || typeof target.addEventListener !== 'function' || target[marker]) return;
    const originalAddEventListener = target.addEventListener;
    target.addEventListener = function(type, listener, options){
      const eventName = String(type || '').toLowerCase();
      if (blockedEvents.indexOf(eventName) >= 0) {
        return;
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
    target[marker] = true;
  }

  installEventBlocker(document, ['visibilitychange', 'webkitvisibilitychange', 'msvisibilitychange', 'pagehide'], '__fbPlayableDocEventBlockerInstalled__');
  installEventBlocker(window, ['blur', 'pagehide', 'freeze'], '__fbPlayableWindowEventBlockerInstalled__');

  patchAddEventListener(document, ['visibilitychange', 'webkitvisibilitychange', 'msvisibilitychange', 'pagehide'], '__fbPlayableDocAddEventPatched__');
  patchAddEventListener(window, ['blur', 'pagehide', 'freeze'], '__fbPlayableWindowAddEventPatched__');

  function tryNotifyReady(){
    forceViewRefresh(window.cc, 'try-notify-ready');
    try {
      if (typeof window.__PLAYABLE_FACEBOOK_NOTIFY_READY__ === 'function') {
        return !!window.__PLAYABLE_FACEBOOK_NOTIFY_READY__();
      }
      if (window.PlayableSDK && typeof window.PlayableSDK.ready === 'function') {
        return !!window.PlayableSDK.ready();
      }
    } catch (e) {}
    return false;
  }

  function getCtorClassName(ctor){
    try {
      return (ctor && ctor.prototype && ctor.prototype.__classname__)
        || (ctor && ctor.__classname__)
        || (ctor && ctor.name)
        || '';
    } catch (e) {}
    return '';
  }

  function getComponentClassName(component){
    try {
      return getCtorClassName(component && component.constructor);
    } catch (e) {}
    return '';
  }

  function walkSceneNodes(root, visit){
    if (!root || typeof visit !== 'function') return;
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      visit(current);
      const children = current.children || [];
      for (let i = 0; i < children.length; i += 1) {
        queue.push(children[i]);
      }
    }
  }

  function findSceneComponent(scene, className){
    let found = null;
    walkSceneNodes(scene, function(node){
      if (found) return;
      const comps = node && node.components ? node.components : [];
      for (let i = 0; i < comps.length; i += 1) {
        if (getComponentClassName(comps[i]) === className) {
          found = comps[i];
          return;
        }
      }
    });
    return found;
  }

  function getAnimationControllerCtor(cc){
    try {
      if (cc && cc.animation && cc.animation.AnimationController) {
        return cc.animation.AnimationController;
      }
    } catch (e) {}
    try {
      if (cc && cc.AnimationController) {
        return cc.AnimationController;
      }
    } catch (e) {}
    return null;
  }

  function recordPendingAnimationValue(controller, key, value, error){
    if (!controller) return;
    try {
      const pending = controller.__fbPlayablePendingAnimValues__
        || (controller.__fbPlayablePendingAnimValues__ = Object.create(null));
      pending[String(key)] = value;
    } catch (e) {}
    window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_KEY__ = String(key || '');
    window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_AT__ = Date.now();
    if (error) {
      try {
        window.__PLAYABLE_FACEBOOK_LAST_ANIM_VALUE_ERROR__ = error && error.message ? error.message : String(error);
      } catch (e) {}
    }
  }

  function getOriginalAnimationSetValue(controller){
    try {
      const proto = controller && Object.getPrototypeOf(controller);
      if (proto && typeof proto.__fbPlayableOriginalSetValue__ === 'function') {
        return proto.__fbPlayableOriginalSetValue__;
      }
    } catch (e) {}
    try {
      if (controller && typeof controller.setValue === 'function') {
        return controller.setValue;
      }
    } catch (e) {}
    return null;
  }

  function flushPendingAnimationValues(controller){
    const pending = controller && controller.__fbPlayablePendingAnimValues__;
    if (!pending) return false;
    const apply = getOriginalAnimationSetValue(controller);
    if (typeof apply !== 'function') return false;
    let flushed = false;
    for (const key in pending) {
      try {
        apply.call(controller, key, pending[key]);
        delete pending[key];
        flushed = true;
      } catch (error) {
        window.__PLAYABLE_FACEBOOK_LAST_ANIM_RETRY_AT__ = Date.now();
        try {
          window.__PLAYABLE_FACEBOOK_LAST_ANIM_RETRY_ERROR__ = error && error.message ? error.message : String(error);
        } catch (e) {}
      }
    }
    try {
      if (!Object.keys(pending).length) {
        delete controller.__fbPlayablePendingAnimValues__;
      }
    } catch (e) {}
    if (flushed) {
      window.__PLAYABLE_FACEBOOK_LAST_ANIM_FLUSH_AT__ = Date.now();
    }
    return flushed;
  }

  function patchAnimationController(cc){
    try {
      const ctor = getAnimationControllerCtor(cc);
      const proto = ctor && ctor.prototype;
      if (!proto || proto.__fbPlayableMetaCompatPatched__) return false;

      if (typeof proto.setValue_experimental === 'function') {
        const originalSetValueExperimental = proto.setValue_experimental;
        proto.setValue_experimental = function(key, value){
          try {
            return originalSetValueExperimental.apply(this, arguments);
          } catch (error) {
            recordPendingAnimationValue(this, key, value, error);
            return undefined;
          }
        };
        proto.__fbPlayableOriginalSetValueExperimental__ = originalSetValueExperimental;
      }

      if (typeof proto.setValue === 'function') {
        const originalSetValue = proto.setValue;
        proto.setValue = function(key, value){
          try {
            return originalSetValue.apply(this, arguments);
          } catch (error) {
            recordPendingAnimationValue(this, key, value, error);
            return undefined;
          }
        };
        proto.__fbPlayableOriginalSetValue__ = originalSetValue;
      }

      proto.__fbPlayableMetaCompatPatched__ = true;
      window.__PLAYABLE_FACEBOOK_ANIM_PATCHED_AT__ = Date.now();
      return true;
    } catch (e) {}
    return false;
  }

  function getRootMainWindow(cc){
    try {
      const root = cc && cc.director && cc.director.root;
      if (!root) return null;
      return root.mainWindow || root.curWindow || root.tempWindow || null;
    } catch (e) {}
    return null;
  }

  function getRenderWindowDebugName(renderWindow){
    if (!renderWindow) return 'null';
    try {
      return String(
        renderWindow.title
        || renderWindow._title
        || renderWindow.name
        || renderWindow._name
        || renderWindow.renderWindowId
        || 'window'
      );
    } catch (e) {}
    return 'window';
  }

  function getCameraInternal(cameraComponent){
    if (!cameraComponent) return null;
    try {
      if (cameraComponent.camera) return cameraComponent.camera;
    } catch (e) {}
    try {
      if (cameraComponent._camera) return cameraComponent._camera;
    } catch (e) {}
    return null;
  }

  function getCameraWindow(camera){
    if (!camera) return null;
    try {
      if (camera.window) return camera.window;
    } catch (e) {}
    try {
      if (camera._window) return camera._window;
    } catch (e) {}
    return null;
  }

  function getCameraTargetWindow(cameraComponent, cc){
    try {
      const targetTexture = cameraComponent && cameraComponent.targetTexture;
      if (targetTexture && targetTexture.window) {
        return targetTexture.window;
      }
    } catch (e) {}
    return getRootMainWindow(cc);
  }

  function getCameraRenderScene(cameraComponent){
    try {
      if (cameraComponent && typeof cameraComponent._getRenderScene === 'function') {
        return cameraComponent._getRenderScene();
      }
    } catch (e) {}
    try {
      const node = cameraComponent && cameraComponent.node;
      const scene = node && node.scene;
      return scene && scene.renderScene ? scene.renderScene : null;
    } catch (e) {}
    return null;
  }

  function isCameraComponent(component){
    const compName = getComponentClassName(component);
    if (compName === 'Camera' || compName === 'cc.Camera' || compName === 'CameraComponent' || compName === 'cc.CameraComponent') {
      return true;
    }
    if (!component) return false;
    return typeof component._createCamera === 'function'
      && typeof component.screenPointToRay === 'function';
  }

  function repairSingleCameraComponent(cameraComponent, cc, reason){
    try {
      if (!cameraComponent) return false;
      let internalCamera = getCameraInternal(cameraComponent);
      let repaired = false;
      if (!internalCamera && typeof cameraComponent._createCamera === 'function') {
        try {
          cameraComponent._createCamera();
          internalCamera = getCameraInternal(cameraComponent);
          repaired = !!internalCamera;
        } catch (error) {
          try {
            window.__PLAYABLE_FACEBOOK_LAST_CAMERA_REPAIR_ERROR__ = error && error.message ? error.message : String(error);
          } catch (e) {}
        }
      }
      if (!internalCamera) return false;

      const targetWindow = getCameraTargetWindow(cameraComponent, cc);
      const targetScene = getCameraRenderScene(cameraComponent);
      const currentWindow = getCameraWindow(internalCamera);

      if (targetWindow && currentWindow !== targetWindow) {
        try {
          if (typeof internalCamera.changeTargetWindow === 'function') {
            internalCamera.changeTargetWindow(targetWindow);
            repaired = true;
          } else {
            try {
              if (currentWindow && typeof currentWindow.detachCamera === 'function') {
                currentWindow.detachCamera(internalCamera);
              }
            } catch (e) {}
            try {
              internalCamera.window = targetWindow;
              repaired = true;
            } catch (e) {}
            try {
              internalCamera._window = targetWindow;
              repaired = true;
            } catch (e) {}
            try {
              if (typeof targetWindow.attachCamera === 'function') {
                targetWindow.attachCamera(internalCamera);
                repaired = true;
              }
            } catch (e) {}
          }
        } catch (error) {
          try {
            window.__PLAYABLE_FACEBOOK_LAST_CAMERA_REPAIR_ERROR__ = error && error.message ? error.message : String(error);
          } catch (e) {}
        }
      }

      const reboundWindow = getCameraWindow(internalCamera);
      if (reboundWindow && targetWindow && reboundWindow === targetWindow) {
        try {
          if (cameraComponent.targetTexture) {
            if (typeof internalCamera.setFixedSize === 'function' && reboundWindow.width > 0 && reboundWindow.height > 0) {
              internalCamera.setFixedSize(reboundWindow.width, reboundWindow.height);
            }
            internalCamera.isWindowSize = false;
          } else {
            internalCamera.isWindowSize = true;
          }
        } catch (e) {}
      }

      if (targetScene && internalCamera.scene !== targetScene) {
        try {
          if (typeof cameraComponent._attachToScene === 'function') {
            cameraComponent._attachToScene();
            repaired = true;
          } else {
            if (internalCamera.scene && typeof internalCamera.scene.removeCamera === 'function') {
              internalCamera.scene.removeCamera(internalCamera);
            }
            if (typeof targetScene.addCamera === 'function') {
              targetScene.addCamera(internalCamera);
              repaired = true;
            }
          }
        } catch (error) {
          try {
            window.__PLAYABLE_FACEBOOK_LAST_CAMERA_ATTACH_ERROR__ = error && error.message ? error.message : String(error);
          } catch (e) {}
        }
      }

      if (repaired) {
        window.__PLAYABLE_FACEBOOK_LAST_CAMERA_REPAIR_NODE__ = cameraComponent.node && cameraComponent.node.name ? cameraComponent.node.name : '';
        window.__PLAYABLE_FACEBOOK_LAST_CAMERA_REPAIR_REASON__ = reason || '';
        window.__PLAYABLE_FACEBOOK_LAST_CAMERA_REPAIR_TARGET__ = getRenderWindowDebugName(targetWindow);
        window.__PLAYABLE_FACEBOOK_LAST_CAMERA_REPAIR_WINDOW__ = getRenderWindowDebugName(getCameraWindow(internalCamera));
        window.__PLAYABLE_FACEBOOK_LAST_CAMERA_REPAIR_AT__ = Date.now();
      }

      return repaired;
    } catch (e) {}
    return false;
  }

  function patchCameraComponent(cc){
    try {
      const ctor = cc && (cc.Camera || cc.CameraComponent);
      const proto = ctor && ctor.prototype;
      if (!proto || proto.__fbPlayableMetaCompatPatchedCamera__) return false;

      if (typeof proto._createCamera === 'function') {
        const originalCreateCamera = proto._createCamera;
        proto._createCamera = function(){
          const result = originalCreateCamera.apply(this, arguments);
          repairSingleCameraComponent(this, cc, 'camera-create');
          return result;
        };
        proto.__fbPlayableOriginalCreateCamera__ = originalCreateCamera;
      }

      if (typeof proto.onEnable === 'function') {
        const originalOnEnable = proto.onEnable;
        proto.onEnable = function(){
          const result = originalOnEnable.apply(this, arguments);
          repairSingleCameraComponent(this, cc, 'camera-enable');
          return result;
        };
        proto.__fbPlayableOriginalCameraOnEnable__ = originalOnEnable;
      }

      if (typeof proto._updateTargetTexture === 'function') {
        const originalUpdateTargetTexture = proto._updateTargetTexture;
        proto._updateTargetTexture = function(){
          const result = originalUpdateTargetTexture.apply(this, arguments);
          repairSingleCameraComponent(this, cc, 'camera-target-texture');
          return result;
        };
        proto.__fbPlayableOriginalUpdateTargetTexture__ = originalUpdateTargetTexture;
      }

      proto.__fbPlayableMetaCompatPatchedCamera__ = true;
      window.__PLAYABLE_FACEBOOK_CAMERA_PATCHED_AT__ = Date.now();
      return true;
    } catch (e) {}
    return false;
  }

  function syncNamedSingletonExport(className, instance){
    if (!className || !instance) return false;
    let repaired = false;

    function assign(ctor){
      if (!ctor || typeof ctor !== 'function') return;
      if (getCtorClassName(ctor) !== className) return;
      try {
        if (ctor._instance !== instance) {
          ctor._instance = instance;
          repaired = true;
        }
      } catch (e) {}
    }

    assign(instance.constructor);

    try {
      const system = window.System;
      if (system && typeof system.entries === 'function') {
        const entries = system.entries();
        const iterator = entries && typeof entries.next === 'function'
          ? entries
          : entries && typeof entries[Symbol.iterator] === 'function'
            ? entries[Symbol.iterator]()
            : null;
        let step = null;
        let guard = 0;
        while (iterator && typeof iterator.next === 'function' && !(step = iterator.next()).done && guard < 4096) {
          guard += 1;
          const record = step.value;
          const mod = record && record[1];
          if (!mod || typeof mod !== 'object') continue;
          for (const key in mod) {
            assign(mod[key]);
          }
        }
      }
    } catch (e) {}

    if (repaired) {
      window.__PLAYABLE_FACEBOOK_LAST_SINGLETON_SYNC__ = className;
      window.__PLAYABLE_FACEBOOK_LAST_SINGLETON_SYNC_AT__ = Date.now();
    }
    return repaired;
  }

  function repairSceneBindings(cc){
    try {
      const director = cc && cc.director;
      const scene = director && typeof director.getScene === 'function'
        ? director.getScene()
        : null;
      if (!scene) return false;

      let repaired = false;
      const rootMainWindow = getRootMainWindow(cc);
      window.__PLAYABLE_FACEBOOK_LAST_MAIN_WINDOW__ = getRenderWindowDebugName(rootMainWindow);
      const player = findSceneComponent(scene, 'PlayerController');
      const coinCollection = player && typeof player.getComponent === 'function'
        ? player.getComponent('CoinCollection')
        : null;

      if (player) {
        window.__PLAYABLE_FACEBOOK_LAST_PLAYER_NODE__ = player.node && player.node.name ? player.node.name : '';
        repaired = syncNamedSingletonExport('PlayerController', player) || repaired;
      }

      const animCtor = getAnimationControllerCtor(cc);
      walkSceneNodes(scene, function(node){
        const comps = node && node.components ? node.components : [];
        for (let i = 0; i < comps.length; i += 1) {
          const comp = comps[i];
          if (!comp) continue;
          const compName = getComponentClassName(comp);

          if (isCameraComponent(comp) && repairSingleCameraComponent(comp, cc, 'scene-walk')) {
            repaired = true;
          }

          if (animCtor) {
            try {
              if (comp instanceof animCtor && flushPendingAnimationValues(comp)) {
                repaired = true;
              }
            } catch (e) {}
          } else if (compName.indexOf('AnimationController') >= 0 && flushPendingAnimationValues(comp)) {
            repaired = true;
          }

          if (!player) continue;

          if (compName === 'JoystickController' && !comp.playerController) {
            try {
              comp.playerController = player;
              repaired = true;
            } catch (e) {}
          }

          if (compName === 'DirectionalArrow') {
            try {
              if (!comp.playerController) {
                comp.playerController = player;
                repaired = true;
              }
            } catch (e) {}
            try {
              if (!comp._coinCollection && coinCollection) {
                comp._coinCollection = coinCollection;
                repaired = true;
              }
            } catch (e) {}
          }

          if (compName === 'EnemyController' && !comp._player) {
            try {
              comp._player = player.node || null;
              repaired = true;
            } catch (e) {}
          }

          if (compName === 'IconUI') {
            try {
              if (!comp._coinCollection && coinCollection) {
                comp._coinCollection = coinCollection;
                repaired = true;
              }
            } catch (e) {}
            try {
              if (coinCollection && comp.enabled === false) {
                comp.enabled = true;
                repaired = true;
              }
            } catch (e) {}
          }
        }
      });

      if (repaired) {
        window.__PLAYABLE_FACEBOOK_LAST_SCENE_REPAIR_AT__ = Date.now();
      }
      return repaired;
    } catch (e) {}
    return false;
  }

  function patchDirector(cc){
    try {
      const director = cc && cc.director;
      if (!director || director.__fbPlayableMetaCompatPatched__) return false;

      if (shouldUseAggressiveCompat('patch-director-pause') && typeof director.pause === 'function') {
        const originalPause = director.pause;
        director.pause = function(){
          window.__PLAYABLE_FACEBOOK_IGNORED_PAUSE__ = true;
          window.__PLAYABLE_FACEBOOK_LAST_IGNORED_PAUSE_AT__ = Date.now();
          return true;
        };
        director.__fbPlayableOriginalPause__ = originalPause;
      }

      if (typeof director.loadScene === 'function' && !director.__fbPlayableLoadSceneWrapped__) {
        const originalLoadScene = director.loadScene;
        director.loadScene = function(sceneName){
          const candidate = String(sceneName || '');
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = 'director-call';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = 'director-load';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
          const args = Array.prototype.slice.call(arguments);
          for (let i = args.length - 1; i >= 0; i -= 1) {
            if (typeof args[i] !== 'function') continue;
            const originalCallback = args[i];
            args[i] = function(error){
              window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = error ? 'director-callback-error' : 'director-callback-ok';
              window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
              window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = 'director-load';
              window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = error && error.message ? error.message : '';
              window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
              return originalCallback.apply(this, arguments);
            };
            break;
          }
          try {
            return originalLoadScene.apply(this, args);
          } catch (error) {
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = 'director-throw';
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = 'director-load';
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = error && error.message ? error.message : String(error);
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
            throw error;
          }
        };
        director.__fbPlayableOriginalLoadScene__ = originalLoadScene;
        director.__fbPlayableLoadSceneWrapped__ = true;
      }

      director.__fbPlayableMetaCompatPatched__ = true;
      return true;
    } catch (e) {}
    return false;
  }

  function trimFacebookDiagText(value, maxLength){
    const limit = Number(maxLength) > 0 ? Number(maxLength) : 96;
    if (value == null) return '';
    let text = '';
    if (typeof value === 'string') {
      text = value;
    } else {
      try {
        text = JSON.stringify(value);
      } catch (error) {
        text = String(value);
      }
    }
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (text.length > limit) {
      text = text.slice(0, Math.max(0, limit - 3)) + '...';
    }
    return text;
  }

  function describeFacebookDiagValue(value){
    if (value == null) return '';
    if (typeof value === 'string') return trimFacebookDiagText(value, 112);
    if (Array.isArray(value)) {
      return trimFacebookDiagText(value.slice(0, 3).map(function(entry){
        return describeFacebookDiagValue(entry);
      }).filter(Boolean).join(','), 112);
    }
    if (typeof value === 'object') {
      if (value.bundle && value.path) return trimFacebookDiagText(String(value.bundle) + ':' + String(value.path), 112);
      if (value.path) return trimFacebookDiagText(value.path, 112);
      if (value.url) return trimFacebookDiagText(value.url, 112);
      if (value.__uuid__) return trimFacebookDiagText(value.__uuid__, 112);
      if (value.uuid) return trimFacebookDiagText(value.uuid, 112);
      if (value._uuid) return trimFacebookDiagText(value._uuid, 112);
      if (value.dir) return trimFacebookDiagText(value.dir, 112);
      if (value.bundle) return trimFacebookDiagText(value.bundle, 112);
      if (value.nativeUrl) return trimFacebookDiagText(value.nativeUrl, 112);
      if (value.name) return trimFacebookDiagText(value.name, 112);
      if (value.constructor && value.constructor.name && value.constructor.name !== 'Object') {
        return trimFacebookDiagText(value.constructor.name, 112);
      }
    }
    return trimFacebookDiagText(String(value), 112);
  }

  function describeFacebookDiagPayload(value){
    if (value == null) return '';
    if (typeof ArrayBuffer !== 'undefined') {
      if (value instanceof ArrayBuffer) {
        return trimFacebookDiagText('ArrayBuffer(' + String(value.byteLength || 0) + ')', 112);
      }
      if (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(value)) {
        const ctorName = value && value.constructor && value.constructor.name
          ? value.constructor.name
          : 'TypedArray';
        const size = Number.isFinite(value.byteLength)
          ? value.byteLength
          : (Number.isFinite(value.length) ? value.length : 0);
        return trimFacebookDiagText(ctorName + '(' + String(size) + ')', 112);
      }
    }
    if (Array.isArray(value)) {
      return trimFacebookDiagText(
        'Array(' + String(value.length) + '):'
        + value.slice(0, 3).map(function(entry){
          return describeFacebookDiagValue(entry);
        }).filter(Boolean).join(','),
        112
      );
    }
    return describeFacebookDiagValue(value);
  }

  function describeFacebookDiagError(value){
    if (value == null) return '';
    if (typeof value === 'string') return trimFacebookDiagText(value, 180);
    if (typeof value === 'object') {
      const parts = [];
      if (value.name && value.name !== 'Error') parts.push(value.name);
      if (value.message) parts.push(value.message);
      if (parts.length) return trimFacebookDiagText(parts.join(': '), 180);
      if (value.stack) return trimFacebookDiagText(value.stack, 180);
    }
    return trimFacebookDiagText(describeFacebookDiagPayload(value), 180);
  }

  function describeFacebookDiagOptionsLabel(options){
    if (!options || typeof options !== 'object') return '';
    if (options.bundle && options.path) {
      return trimFacebookDiagText(String(options.bundle) + ':' + String(options.path), 112);
    }
    return describeFacebookDiagValue(
      options.__uuid__
      || options.uuid
      || options._uuid
      || options.path
      || options.url
      || options.bundle
      || ''
    );
  }

  function describeFacebookDiagRequestLabel(parts, fallback){
    const labels = [];
    const seen = Object.create(null);
    function append(label){
      const text = trimFacebookDiagText(label, 112);
      if (!text || seen[text]) return;
      seen[text] = true;
      labels.push(text);
    }
    if (Array.isArray(parts)) {
      for (let i = 0; i < parts.length; i += 1) {
        const label = describeFacebookDiagValue(parts[i]);
        if (label) append(label);
      }
    }
    if (!labels.length && fallback != null) {
      const fallbackLabel = describeFacebookDiagPayload(fallback);
      if (fallbackLabel) append(fallbackLabel);
    }
    return trimFacebookDiagText(labels.join(':'), 112);
  }

  function recordFacebookAssetStage(stage, subject, info){
    try {
      const stageLabel = trimFacebookDiagText(stage, 48);
      const subjectLabel = trimFacebookDiagText(subject, 112);
      const isFailure = String(stage || '').indexOf('error') >= 0 || String(stage || '').indexOf('throw') >= 0;
      const infoText = trimFacebookDiagText(
        isFailure ? describeFacebookDiagError(info) : describeFacebookDiagPayload(info),
        isFailure ? 180 : 112
      );

      window.__PLAYABLE_FACEBOOK_LAST_ASSET_STAGE__ = stageLabel;
      window.__PLAYABLE_FACEBOOK_LAST_ASSET_SUBJECT__ = subjectLabel;
      window.__PLAYABLE_FACEBOOK_LAST_ASSET_INFO__ = infoText;
      window.__PLAYABLE_FACEBOOK_LAST_ASSET_AT__ = Date.now();
      if (isFailure) {
        window.__PLAYABLE_FACEBOOK_LAST_ASSET_ERROR__ = trimFacebookDiagText(
          [
            stageLabel,
            infoText,
            subjectLabel,
          ].filter(Boolean).join(':'),
          180
        );
        window.__PLAYABLE_FACEBOOK_LAST_ASSET_ERROR_INFO__ = infoText;
        window.__PLAYABLE_FACEBOOK_LAST_ASSET_ERROR_AT__ = Date.now();
      }
    } catch (e) {}
  }

  function wrapFacebookTrailingCallback(args, handler){
    if (!args || !args.length) return false;
    for (let i = args.length - 1; i >= 0; i -= 1) {
      if (typeof args[i] !== 'function') continue;
      const originalCallback = args[i];
      args[i] = function(){
        try {
          handler.apply(this, arguments);
        } catch (error) {}
        return originalCallback.apply(this, arguments);
      };
      return true;
    }
    return false;
  }

  const FACEBOOK_COMPAT_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.ico', '.tiff', '.webp', '.image'];

  function detectFacebookCompatImageExtension(url){
    const cleanUrl = String(url || '').split('?')[0].split('#')[0];
    const match = /\.([a-z0-9]+)$/i.exec(cleanUrl);
    return match ? ('.' + String(match[1] || '').toLowerCase()) : '.image';
  }

  function createFacebookCompatDomImage(url, rel, bytes, mime, callback){
    const image = window.Image ? new window.Image() : null;
    if (!image) {
      callback(new Error('Image constructor unavailable'), null);
      return null;
    }

    let settled = false;
    let probeTimer = 0;
    let probeIndex = 0;
    const probeSteps = [60, 160, 360, 760, 1500, 2800, 4200];
    const sourceMime = mime || getEntryMime(rel) || 'image/png';

    function cleanup(){
      try {
        image.removeEventListener('load', onLoad);
      } catch (e) {}
      try {
        image.removeEventListener('error', onError);
      } catch (e) {}
      try {
        if (probeTimer) clearTimeout(probeTimer);
      } catch (e) {}
      probeTimer = 0;
    }

    function getSizeLabel(){
      const width = Math.max(0, Number(image.naturalWidth || image.width || 0));
      const height = Math.max(0, Number(image.naturalHeight || image.height || 0));
      return {
        width,
        height,
        label: String(width) + 'x' + String(height),
      };
    }

    function finish(error, result, stage){
      if (settled) return;
      settled = true;
      cleanup();
      try {
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT__', error ? 'compat-error' : 'compat-load');
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT_INFO__', trimFacebookDiagText(stage || '', 96));
        diagSetWindow('__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT_AT__', Date.now());
      } catch (e) {}
      callback(error || null, error ? null : (result || image));
    }

    function maybeFinish(stage, allowZeroSize){
      const size = getSizeLabel();
      if (!image.complete) return false;
      if (size.width > 0 || size.height > 0 || allowZeroSize) {
        const suffix = allowZeroSize && !size.width && !size.height ? ':forced' : '';
        finish(null, image, String(stage || 'probe') + ':' + size.label + suffix);
        return true;
      }
      return false;
    }

    function armProbe(){
      if (settled) return;
      const delay = probeSteps[Math.min(probeIndex, probeSteps.length - 1)];
      probeTimer = setTimeout(function(){
        if (maybeFinish('probe-' + String(probeIndex), probeIndex >= probeSteps.length - 2)) {
          return;
        }
        if (probeIndex >= probeSteps.length - 1) {
          finish(new Error('Image load timeout: ' + String(url || rel || 'unknown')), null, 'timeout');
          return;
        }
        probeIndex += 1;
        armProbe();
      }, delay);
    }

    function onLoad(){
      if (maybeFinish('load', true)) {
        return;
      }
      finish(null, image, 'load-no-size');
    }

    function onError(){
      finish(new Error('Image load failed: ' + String(url || rel || 'unknown')), null, 'error');
    }

    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);

    try {
      if ('crossOrigin' in image) {
        image.crossOrigin = null;
      }
    } catch (e) {}

    try {
      image.src = 'data:' + sourceMime + ';base64,' + bytesToBase64Compat(bytes);
    } catch (error) {
      finish(error, null, 'src-throw');
      return image;
    }

    setTimeout(function(){
      maybeFinish('post-src', false);
    }, 0);

    try {
      if (typeof image.decode === 'function') {
        Promise.resolve(image.decode()).then(function(){
          maybeFinish('decode', true);
        }).catch(function(){
          maybeFinish('decode-reject', true);
        });
      }
    } catch (e) {}

    armProbe();
    return image;
  }

  function installFacebookImageDownloadCompat(cc){
    try {
      if (!shouldUseAggressiveCompat('image-download-compat')) return false;
      const assetManager = cc && cc.assetManager;
      const downloader = assetManager && assetManager.downloader;
      if (!downloader || downloader.__fbPlayableImageDownloadCompatInstalled__) return false;
      const downloaders = downloader._downloaders;
      if (!downloaders || typeof downloaders !== 'object') return false;

      const originalHandlers = Object.create(null);
      FACEBOOK_COMPAT_IMAGE_EXTENSIONS.forEach(function(ext){
        if (typeof downloaders[ext] === 'function') {
          originalHandlers[ext] = downloaders[ext];
        }
      });

      function compatImageDownloader(url, options, callback){
        const ext = detectFacebookCompatImageExtension(url);
        const originalHandler = originalHandlers[ext] || null;
        const requestLabel = describeFacebookDiagValue(url);
        const done = typeof callback === 'function' ? callback : function(){};
        recordFacebookAssetStage('download-image-compat-call', requestLabel, ext);

        const resolved = resolvePackHitFromInput(url);
        const rel = resolved && resolved.rel ? resolved.rel : '';
        const hit = resolved && resolved.hit ? resolved.hit : null;

        if (!hit) {
          if (typeof originalHandler === 'function') {
            return originalHandler.call(downloader, url, options, function(error, result){
              recordFacebookAssetStage(
                error ? 'download-image-compat-pass-error' : 'download-image-compat-pass-ok',
                requestLabel,
                error || result
              );
              done(error, result);
            });
          }
          done(new Error('Missing image downloader for ' + ext), null);
          return null;
        }

        try {
          const bytes = getPackEntryBytes(hit);
          if (!bytes || !bytes.length) {
            throw new Error('Missing image bytes');
          }
          const mime = getPackEntryMime(rel) || 'image/png';
          return createFacebookCompatDomImage(url, rel, bytes, mime, function(error, image){
            recordFacebookAssetStage(
              error ? 'download-image-compat-error' : 'download-image-compat-ok',
              rel || requestLabel,
              error || image
            );
            done(error, image);
          });
        } catch (error) {
          recordFacebookAssetStage('download-image-compat-throw', rel || requestLabel, error);
          if (typeof originalHandler === 'function') {
            return originalHandler.call(downloader, url, options, function(originalError, result){
              recordFacebookAssetStage(
                originalError ? 'download-image-compat-fallback-error' : 'download-image-compat-fallback-ok',
                requestLabel,
                originalError || result
              );
              done(originalError, result);
            });
          }
          done(error, null);
          return null;
        }
      }

      FACEBOOK_COMPAT_IMAGE_EXTENSIONS.forEach(function(ext){
        downloaders[ext] = compatImageDownloader;
      });

      downloader.__fbPlayableOriginalImageDownloaders__ = originalHandlers;
      downloader.__fbPlayableImageDownloadCompatInstalled__ = true;
      return true;
    } catch (e) {}
    return false;
  }

  function patchBundleDiagnostics(bundle){
    try {
      if (!bundle || bundle.__fbPlayableDiagnosticsPatched__) return false;
      const bundleName = bundle.name || bundle._name || 'bundle';

      if (typeof bundle.loadScene === 'function' && !bundle.__fbPlayableLoadSceneWrapped__) {
        const originalBundleLoadScene = bundle.loadScene;
        bundle.loadScene = function(sceneName){
          const candidate = String(sceneName || '');
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = 'bundle-call';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = 'bundle:' + bundleName;
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
          recordFacebookAssetStage('bundle-loadScene-call', bundleName + ':' + candidate, '');
          const args = Array.prototype.slice.call(arguments);
          wrapFacebookTrailingCallback(args, function(error, sceneAssetOrScene){
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = error ? 'bundle-callback-error' : 'bundle-callback-ok';
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = 'bundle:' + bundleName;
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = error && error.message
              ? error.message
              : describeFacebookDiagValue(sceneAssetOrScene);
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
            recordFacebookAssetStage(
              error ? 'bundle-loadScene-error' : 'bundle-loadScene-ok',
              bundleName + ':' + candidate,
              error || sceneAssetOrScene
            );
          });
          try {
            return originalBundleLoadScene.apply(this, args);
          } catch (error) {
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = 'bundle-throw';
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = 'bundle:' + bundleName;
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = error && error.message ? error.message : String(error);
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
            recordFacebookAssetStage('bundle-loadScene-throw', bundleName + ':' + candidate, error);
            throw error;
          }
        };
        bundle.__fbPlayableOriginalLoadScene__ = originalBundleLoadScene;
        bundle.__fbPlayableLoadSceneWrapped__ = true;
      }

      if (typeof bundle.load === 'function' && !bundle.__fbPlayableLoadWrapped__) {
        const originalBundleLoad = bundle.load;
        bundle.load = function(request){
          const requestLabel = describeFacebookDiagValue(request);
          recordFacebookAssetStage('bundle-load-call', bundleName + ':' + requestLabel, '');
          const args = Array.prototype.slice.call(arguments);
          wrapFacebookTrailingCallback(args, function(error, asset){
            recordFacebookAssetStage(
              error ? 'bundle-load-error' : 'bundle-load-ok',
              bundleName + ':' + requestLabel,
              error || asset
            );
          });
          try {
            return originalBundleLoad.apply(this, args);
          } catch (error) {
            recordFacebookAssetStage('bundle-load-throw', bundleName + ':' + requestLabel, error);
            throw error;
          }
        };
        bundle.__fbPlayableOriginalLoad__ = originalBundleLoad;
        bundle.__fbPlayableLoadWrapped__ = true;
      }

      bundle.__fbPlayableDiagnosticsPatched__ = true;
      return true;
    } catch (e) {}
    return false;
  }

  function patchAssetManagerDiagnostics(cc){
    try {
      const assetManager = cc && cc.assetManager;
      if (!assetManager || assetManager.__fbPlayableDiagnosticsPatched__) return false;

      const existingBundles = assetManager.bundles;
      if (existingBundles && typeof existingBundles.forEach === 'function') {
        existingBundles.forEach(function(bundle){
          patchBundleDiagnostics(bundle);
        });
      } else if (Array.isArray(existingBundles)) {
        existingBundles.forEach(function(bundle){
          patchBundleDiagnostics(bundle);
        });
      }

      if (typeof assetManager.loadAny === 'function' && !assetManager.__fbPlayableLoadAnyWrapped__) {
        const originalLoadAny = assetManager.loadAny;
        assetManager.loadAny = function(request){
          const requestLabel = describeFacebookDiagValue(request);
          recordFacebookAssetStage('loadAny-call', requestLabel, '');
          const args = Array.prototype.slice.call(arguments);
          wrapFacebookTrailingCallback(args, function(error, asset){
            recordFacebookAssetStage(error ? 'loadAny-error' : 'loadAny-ok', requestLabel, error || asset);
          });
          try {
            return originalLoadAny.apply(this, args);
          } catch (error) {
            recordFacebookAssetStage('loadAny-throw', requestLabel, error);
            throw error;
          }
        };
        assetManager.__fbPlayableOriginalLoadAny__ = originalLoadAny;
        assetManager.__fbPlayableLoadAnyWrapped__ = true;
      }

      if (typeof assetManager.loadBundle === 'function' && !assetManager.__fbPlayableLoadBundleWrapped__) {
        const originalLoadBundle = assetManager.loadBundle;
        assetManager.loadBundle = function(request){
          const requestLabel = describeFacebookDiagValue(request);
          recordFacebookAssetStage('loadBundle-call', requestLabel, '');
          const args = Array.prototype.slice.call(arguments);
          wrapFacebookTrailingCallback(args, function(error, bundle){
            if (!error && bundle) patchBundleDiagnostics(bundle);
            recordFacebookAssetStage(error ? 'loadBundle-error' : 'loadBundle-ok', requestLabel, error || bundle);
          });
          try {
            return originalLoadBundle.apply(this, args);
          } catch (error) {
            recordFacebookAssetStage('loadBundle-throw', requestLabel, error);
            throw error;
          }
        };
        assetManager.__fbPlayableOriginalLoadBundle__ = originalLoadBundle;
        assetManager.__fbPlayableLoadBundleWrapped__ = true;
      }

      const downloader = assetManager.downloader;
      if (downloader && typeof downloader.download === 'function' && !downloader.__fbPlayableDownloadWrapped__) {
        const originalDownload = downloader.download;
        downloader.download = function(id, url, type){
          const requestLabel = describeFacebookDiagValue(url || id);
          const typeLabel = describeFacebookDiagValue(type);
          recordFacebookAssetStage('download-call', requestLabel, typeLabel);
          const args = Array.prototype.slice.call(arguments);
          wrapFacebookTrailingCallback(args, function(error, result){
            recordFacebookAssetStage(error ? 'download-error' : 'download-ok', requestLabel, error || result);
          });
          try {
            return originalDownload.apply(this, args);
          } catch (error) {
            recordFacebookAssetStage('download-throw', requestLabel, error);
            throw error;
          }
        };
        downloader.__fbPlayableOriginalDownload__ = originalDownload;
        downloader.__fbPlayableDownloadWrapped__ = true;
      }

      installFacebookImageDownloadCompat(cc);

      const parser = assetManager.parser;
      if (parser && typeof parser.parse === 'function' && !parser.__fbPlayableParseWrapped__) {
        const originalParse = parser.parse;
        parser.parse = function(id, file, type, options){
          const args = Array.prototype.slice.call(arguments);
          const optionsLabel = describeFacebookDiagOptionsLabel(args[3]);
          const requestLabel = describeFacebookDiagRequestLabel(
            [args[0], args[2], optionsLabel],
            args[1]
          );
          recordFacebookAssetStage(
            'parse-call',
            requestLabel,
            [
              describeFacebookDiagPayload(args[1]),
              optionsLabel,
            ].filter(Boolean).join('|')
          );
          wrapFacebookTrailingCallback(args, function(error, result){
            recordFacebookAssetStage(error ? 'parse-error' : 'parse-ok', requestLabel, error || result);
          });
          try {
            return originalParse.apply(this, args);
          } catch (error) {
            recordFacebookAssetStage('parse-throw', requestLabel, error);
            throw error;
          }
        };
        parser.__fbPlayableOriginalParse__ = originalParse;
        parser.__fbPlayableParseWrapped__ = true;
      }

      const factory = assetManager.factory;
      if (factory && typeof factory.create === 'function' && !factory.__fbPlayableCreateWrapped__) {
        const originalCreate = factory.create;
        factory.create = function(id, data, type, options){
          const args = Array.prototype.slice.call(arguments);
          const optionsLabel = describeFacebookDiagOptionsLabel(args[3]);
          const requestLabel = describeFacebookDiagRequestLabel(
            [args[0], args[2], optionsLabel],
            args[1]
          );
          recordFacebookAssetStage(
            'factory-create-call',
            requestLabel,
            [
              describeFacebookDiagPayload(args[1]),
              optionsLabel,
            ].filter(Boolean).join('|')
          );
          wrapFacebookTrailingCallback(args, function(error, result){
            recordFacebookAssetStage(
              error ? 'factory-create-error' : 'factory-create-ok',
              requestLabel,
              error || result
            );
          });
          try {
            return originalCreate.apply(this, args);
          } catch (error) {
            recordFacebookAssetStage('factory-create-throw', requestLabel, error);
            throw error;
          }
        };
        factory.__fbPlayableOriginalCreate__ = originalCreate;
        factory.__fbPlayableCreateWrapped__ = true;
      }

      assetManager.__fbPlayableDiagnosticsPatched__ = true;
      return true;
    } catch (e) {}
    return false;
  }

  function forceTimerPacer(game){
    try {
      if (!shouldUseAggressiveCompat('force-timer-pacer')) return false;
      const pacer = game && game._pacer;
      if (!pacer || pacer.__fbPlayableTimerForced__) return false;
      pacer._rAF = undefined;
      pacer._cAF = undefined;
      pacer.__fbPlayableTimerForced__ = true;
      window.__PLAYABLE_FACEBOOK_PACER_MODE__ = 'setTimeout';
      window.__PLAYABLE_FACEBOOK_LAST_PACER_PATCH_AT__ = Date.now();
      if (pacer._isPlaying && typeof pacer.stop === 'function' && typeof pacer.start === 'function') {
        pacer.stop();
        pacer.start();
      }
      return true;
    } catch (e) {}
    return false;
  }

  function applyFacebookGameOverrides(options){
    if (!options || typeof options !== 'object') return options;
    const nextOptions = options;
    const overrideSettings = nextOptions.overrideSettings || (nextOptions.overrideSettings = {});
    const splashSettings = overrideSettings.splashScreen || (overrideSettings.splashScreen = {});
    splashSettings.totalTime = 0;
    return nextOptions;
  }

  function pushUniqueSceneCandidate(out, value){
    const next = String(value || '').trim();
    if (!next) return;
    if (out.indexOf(next) >= 0) return;
    out.push(next);
  }

  function buildSceneCandidates(sceneRef){
    const out = [];
    const raw = String(sceneRef || '').trim();
    if (!raw) return out;

    pushUniqueSceneCandidate(out, raw);

    const strippedQuery = raw.split('?')[0].split('#')[0];
    pushUniqueSceneCandidate(out, strippedQuery);

    const normalizedDb = strippedQuery
      .replace(/^db:\/\//i, '')
      .replace(/^db:\//i, '')
      .replace(/\.scene$/i, '');
    pushUniqueSceneCandidate(out, normalizedDb);

    const normalizedPath = normalizedDb.replace(/^assets\/scenes\//i, '');
    pushUniqueSceneCandidate(out, normalizedPath);

    const basename = normalizedPath.split('/').pop();
    pushUniqueSceneCandidate(out, basename);

    if (basename) {
      pushUniqueSceneCandidate(out, 'assets/scenes/' + basename);
      pushUniqueSceneCandidate(out, 'db://assets/scenes/' + basename + '.scene');
      pushUniqueSceneCandidate(out, 'db:/assets/scenes/' + basename);
    }

    return out;
  }

  function getBundleByName(cc, bundleName){
    if (!cc || !bundleName) return null;
    try {
      const assetManager = cc.assetManager;
      if (assetManager && typeof assetManager.getBundle === 'function') {
        const found = assetManager.getBundle(bundleName);
        if (found) return found;
      }
    } catch (e) {}
    try {
      const bundles = cc.assetManager && cc.assetManager.bundles;
      if (bundles && typeof bundles.find === 'function') {
        return bundles.find(function(bundle){
          return !!bundle && (bundle.name === bundleName || bundle._name === bundleName);
        }) || null;
      }
    } catch (e) {}
    return null;
  }

  function runForcedScene(cc, game, sceneAssetOrScene, candidate, mode){
    try {
      const director = cc && cc.director;
      if (!director || !sceneAssetOrScene) return false;

      let scene = sceneAssetOrScene;
      try {
        if (scene && scene.scene) {
          scene = scene.scene;
        }
      } catch (e) {}
      if (!scene) return false;

      if (typeof director.runSceneImmediate === 'function') {
        director.runSceneImmediate(scene);
      } else if (typeof director.runScene === 'function') {
        director.runScene(scene);
      } else {
        return false;
      }

      try {
        game._initTime = window.performance && typeof window.performance.now === 'function'
          ? window.performance.now()
          : Date.now();
      } catch (e) {}

      try {
        if (typeof director.startAnimation === 'function') {
          director.startAnimation();
        }
      } catch (e) {}

      game.__fbPlayableLaunchSceneForced__ = false;
      game.__fbPlayableLaunchSceneLoading__ = false;
      game.__fbPlayableLaunchSceneLoadToken__ = 0;
      game.__fbPlayableLaunchSceneLoadingStartedAt__ = 0;
      window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE__ = candidate;
      window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_MODE__ = mode || 'run-scene';
      window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_SUCCESS_AT__ = Date.now();

      forceViewRefresh(cc, 'force-launch-scene:' + (mode || ''));
      repairSceneBindings(cc);
      tryNotifyReady();

      try {
        if (typeof game.onStart === 'function') {
          game.onStart();
        }
      } catch (e) {}

      return true;
    } catch (e) {}
    return false;
  }

  function getSceneBundleLoadCandidates(cc, sceneRef){
    const out = [];
    const sceneCandidates = buildSceneCandidates(sceneRef);
    let bundle = getBundleByName(cc, 'main');
    if (bundle) {
      out.push(bundle);
    }

    try {
      const mainBundle = getBundleByName(cc, 'main');
      const config = mainBundle && (mainBundle._config || mainBundle.config || null);
      const scenes = config && config.scenes ? config.scenes : null;
      const paths = config && config.paths ? config.paths : null;
      if (scenes && paths) {
        for (const key in scenes) {
          if (!Object.prototype.hasOwnProperty.call(scenes, key)) continue;
          const sceneIndex = scenes[key];
          const pathEntry = paths && paths[String(sceneIndex)];
          const pathValue = Array.isArray(pathEntry) ? pathEntry[0] : null;
          if (pathValue) {
            sceneCandidates.forEach(function(candidate){
              if (String(key).indexOf(candidate) >= 0 || String(pathValue).indexOf(candidate) >= 0) {
                pushUniqueSceneCandidate(sceneCandidates, pathValue);
                pushUniqueSceneCandidate(sceneCandidates, String(pathValue).replace(/^db:\//i, ''));
                pushUniqueSceneCandidate(sceneCandidates, String(pathValue).replace(/^db:\//i, '').replace(/^assets\/scenes\//i, ''));
              }
            });
          }
        }
      }
    } catch (e) {}

    return {
      bundles: out,
      sceneCandidates: sceneCandidates,
    };
  }

  function forceLaunchScene(cc, game){
    try {
      if (!shouldUseAggressiveCompat('force-launch-scene')) return false;
      const director = cc && cc.director;
      if (!game || !director || typeof director.loadScene !== 'function') return false;
      const currentScene = typeof director.getScene === 'function' ? director.getScene() : null;
      if (currentScene) return false;
      const now = Date.now();
      if (game.__fbPlayableLaunchSceneLoading__) {
        const loadStartedAt = Number(game.__fbPlayableLaunchSceneLoadingStartedAt__ || game.__fbPlayableLaunchSceneForcedAt__ || 0);
        const elapsedLoading = loadStartedAt > 0 ? now - loadStartedAt : 0;
        const pendingCount = getPackPendingResourceCount();
        const lastResourceAt = getPackLastResourceActivityAt();
        const recentlyActive = lastResourceAt > 0 && (now - lastResourceAt) < 1800;
        const maxLoadingWaitMs = (pendingCount > 0 || recentlyActive) ? 12000 : 4500;
        if (!loadStartedAt || elapsedLoading < maxLoadingWaitMs) {
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = 'loading-wait';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = String(window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_TRY__ || '');
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = 'wait';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = 'pend=' + String(pendingCount) + '|elapsed=' + String(elapsedLoading);
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = now;
          return false;
        }
      }
      if (game.__fbPlayableLaunchSceneForced__
        && game.__fbPlayableLaunchSceneForcedAt__
        && now - game.__fbPlayableLaunchSceneForcedAt__ < 1500) {
        return false;
      }

      let sceneName = null;
      try {
        if (cc.settings && typeof cc.settings.querySettings === 'function') {
          sceneName = cc.settings.querySettings('launch', 'launchScene');
        }
      } catch (e) {}
      if (!sceneName) {
        try {
          sceneName = game && game.config && game.config.launchScene ? game.config.launchScene : sceneName;
        } catch (e) {}
      }
      if (!sceneName) {
        try {
          sceneName = game && game._config && game._config.launchScene ? game._config.launchScene : sceneName;
        } catch (e) {}
      }
      if (!sceneName) return false;

      const bundleLoadPlan = getSceneBundleLoadCandidates(cc, sceneName);
      const sceneCandidates = bundleLoadPlan.sceneCandidates || buildSceneCandidates(sceneName);
      const bundles = bundleLoadPlan.bundles || [];
      let candidateIndex = 0;
      const launchToken = (Number(game.__fbPlayableLaunchSceneLoadToken__ || 0) + 1);

      game.__fbPlayableLaunchSceneForced__ = true;
      game.__fbPlayableLaunchSceneLoading__ = true;
      game.__fbPlayableLaunchSceneLoadToken__ = launchToken;
      game.__fbPlayableLaunchSceneForcedAt__ = now;
      game.__fbPlayableLaunchSceneLoadingStartedAt__ = now;
      game._shouldLoadLaunchScene = false;
      window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE__ = sceneName;
      window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_AT__ = Date.now();
      window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_CANDIDATES__ = sceneCandidates.join('|');
      window.__PLAYABLE_FACEBOOK_LAST_FORCE_SHOULD_LOAD__ = game && typeof game._shouldLoadLaunchScene !== 'undefined'
        ? String(game._shouldLoadLaunchScene)
        : 'undefined';

      try {
        const splashScreen = cc.internal && cc.internal.SplashScreen;
        if (splashScreen && typeof splashScreen.releaseInstance === 'function') {
          splashScreen.releaseInstance();
        }
      } catch (e) {}

      function failSceneLaunch(error, candidate, mode){
        try {
          window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_ERROR__ = error && error.message ? error.message : String(error);
          window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_ERROR_AT__ = Date.now();
          window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_FAILED_CANDIDATE__ = candidate || '';
          window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_FAILED_MODE__ = mode || '';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = mode === 'timeout' ? 'scene-timeout' : 'scene-error';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate || '';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = mode || '';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = error && error.message ? error.message : String(error);
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
        } catch (e) {}
      }

      function nextAttempt(){
        if (Number(game.__fbPlayableLaunchSceneLoadToken__ || 0) !== launchToken) {
          return;
        }
        const latestScene = typeof director.getScene === 'function' ? director.getScene() : null;
        if (latestScene) {
          game.__fbPlayableLaunchSceneForced__ = false;
          game.__fbPlayableLaunchSceneLoading__ = false;
          game.__fbPlayableLaunchSceneLoadingStartedAt__ = 0;
          return;
        }
        if (candidateIndex >= sceneCandidates.length) {
          game._shouldLoadLaunchScene = true;
          game.__fbPlayableLaunchSceneForced__ = false;
          game.__fbPlayableLaunchSceneLoading__ = false;
          game.__fbPlayableLaunchSceneLoadingStartedAt__ = 0;
          failSceneLaunch(new Error('No scene candidate succeeded'), '', 'all');
          return;
        }

        const candidate = sceneCandidates[candidateIndex++];
        window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_TRY__ = candidate;
        window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_TRY_AT__ = Date.now();
        window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = 'attempt';
        window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
        window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = bundles[0] && typeof bundles[0].loadScene === 'function'
          ? 'bundle-load'
          : 'director-load';
        window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = '';
        window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
        game.__fbPlayableLaunchSceneLoadingStartedAt__ = Date.now();

        let settled = false;
        const attemptStartedAt = Date.now();
        let timeoutId = 0;

        function armSceneLoadTimeout(){
          timeoutId = setTimeout(function(){
            if (settled || Number(game.__fbPlayableLaunchSceneLoadToken__ || 0) !== launchToken) return;
            const elapsed = Date.now() - attemptStartedAt;
            const pendingCount = getPackPendingResourceCount();
            const lastResourceAt = getPackLastResourceActivityAt();
            const recentlyActive = lastResourceAt > 0 && (Date.now() - lastResourceAt) < 1800;
            const maxWaitMs = (pendingCount > 0 || recentlyActive) ? 12000 : 4500;

            if (elapsed < maxWaitMs) {
              window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = pendingCount > 0 ? 'scene-wait-resource' : 'scene-wait';
              window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
              window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = bundles[0] && typeof bundles[0].loadScene === 'function'
                ? 'bundle-load'
                : 'director-load';
              window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = 'pend=' + String(pendingCount) + '|elapsed=' + String(elapsed);
              window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
              armSceneLoadTimeout();
              return;
            }

            settled = true;
            failSceneLaunch(new Error('Scene load timeout'), candidate, 'timeout');
            nextAttempt();
          }, 1200);
        }

        armSceneLoadTimeout();

        function succeed(sceneAssetOrScene, mode){
          if (settled || Number(game.__fbPlayableLaunchSceneLoadToken__ || 0) !== launchToken) return;
          settled = true;
          clearTimeout(timeoutId);
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = 'scene-success';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = mode || '';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = describeFacebookDiagValue(sceneAssetOrScene);
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
          if (!runForcedScene(cc, game, sceneAssetOrScene, candidate, mode)) {
            failSceneLaunch(new Error('runScene failed'), candidate, mode);
            nextAttempt();
          }
        }

        function fail(error, mode){
          if (settled || Number(game.__fbPlayableLaunchSceneLoadToken__ || 0) !== launchToken) return;
          settled = true;
          clearTimeout(timeoutId);
          failSceneLaunch(error || new Error('Scene load failed'), candidate, mode);
          nextAttempt();
        }

        const bundle = bundles[0] || null;
        if (bundle && typeof bundle.loadScene === 'function') {
          try {
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = 'bundle-request';
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = 'bundle-load';
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = bundle.name || bundle._name || 'main';
            window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
            bundle.loadScene(candidate, function(error, sceneAssetOrScene){
              if (error) {
                fail(error, 'bundle-load');
                return;
              }
              succeed(sceneAssetOrScene, 'bundle-load');
            });
            return;
          } catch (error) {
            fail(error, 'bundle-load-throw');
            return;
          }
        }

        try {
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ = 'director-request';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ = candidate;
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_MODE__ = 'director-load';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_INFO__ = '';
          window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_AT__ = Date.now();
          director.loadScene(candidate, function(error){
            if (error) {
              fail(error, 'director-load');
              return;
            }
            const launchedScene = typeof director.getScene === 'function' ? director.getScene() : null;
            succeed(launchedScene, 'director-load');
          });
        } catch (error) {
          fail(error, 'director-load-throw');
        }
      }

      nextAttempt();
      return true;
    } catch (e) {}
    return false;
  }

  function patchCcGame(cc){
    try {
      const game = cc && cc.game;
      if (!game || game.__fbPlayableMetaCompatPatched__) return false;
      const aggressiveCompat = shouldUseAggressiveCompat('patch-cc-game');

      if (aggressiveCompat && typeof game.pauseByEngine === 'function') {
        const originalPauseByEngine = game.pauseByEngine;
        game.pauseByEngine = function(){
          window.__PLAYABLE_FACEBOOK_IGNORED_ENGINE_PAUSE__ = true;
          window.__PLAYABLE_FACEBOOK_LAST_IGNORED_ENGINE_PAUSE_AT__ = Date.now();
          return false;
        };
        game.__fbPlayableOriginalPauseByEngine__ = originalPauseByEngine;
      }

      if (aggressiveCompat && typeof game.resumeByEngine === 'function') {
        const originalResumeByEngine = game.resumeByEngine;
        game.resumeByEngine = function(){
          window.__PLAYABLE_FACEBOOK_LAST_RESUME_BY_ENGINE_AT__ = Date.now();
          return originalResumeByEngine.apply(this, arguments);
        };
      }

      if (typeof game.initPacer === 'function' && !game.__fbPlayableInitPacerWrapped__) {
        const originalInitPacer = game.initPacer;
        game.initPacer = function(){
          const result = originalInitPacer.apply(this, arguments);
          if (shouldUseAggressiveCompat('game-init-pacer')) {
            forceTimerPacer(this);
          }
          return result;
        };
        game.__fbPlayableOriginalInitPacer__ = originalInitPacer;
        game.__fbPlayableInitPacerWrapped__ = true;
      }

      if (typeof game.init === 'function' && !game.__fbPlayableInitWrapped__) {
        const originalInit = game.init;
        game.init = function(){
          const self = this;
          window.__PLAYABLE_FACEBOOK_GAME_INIT_CALLED_AT__ = Date.now();
          if (arguments.length > 0) {
            applyFacebookGameOverrides(arguments[0]);
          }
          return Promise.resolve(originalInit.apply(this, arguments)).then(function(result){
            window.__PLAYABLE_FACEBOOK_GAME_INIT_RESOLVED_AT__ = Date.now();
            if (shouldUseAggressiveCompat('game-init')) {
              forceTimerPacer(self);
            }
            forceViewRefresh(cc, 'game-init');
            return result;
          })["catch"](function(error){
            window.__PLAYABLE_FACEBOOK_GAME_INIT_ERROR__ = error && error.message ? error.message : String(error);
            window.__PLAYABLE_FACEBOOK_GAME_INIT_ERROR_AT__ = Date.now();
            throw error;
          });
        };
        game.__fbPlayableOriginalInit__ = originalInit;
        game.__fbPlayableInitWrapped__ = true;
      }

      if (typeof game.run === 'function' && !game.__fbPlayableRunWrapped__) {
        const originalRun = game.run;
        game.run = function(){
          const self = this;
          window.__PLAYABLE_FACEBOOK_GAME_RUN_CALLED_AT__ = Date.now();
          return Promise.resolve(originalRun.apply(this, arguments)).then(function(result){
            window.__PLAYABLE_FACEBOOK_GAME_RUN_RESOLVED_AT__ = Date.now();
            if (shouldUseAggressiveCompat('game-run')) {
              forceTimerPacer(self);
              scheduleForceLaunchSceneFallback(cc, self, 'game-run');
            }
            forceViewRefresh(cc, 'game-run');
            return result;
          })["catch"](function(error){
            window.__PLAYABLE_FACEBOOK_GAME_RUN_ERROR__ = error && error.message ? error.message : String(error);
            window.__PLAYABLE_FACEBOOK_GAME_RUN_ERROR_AT__ = Date.now();
            throw error;
          });
        };
        game.__fbPlayableOriginalRun__ = originalRun;
        game.__fbPlayableRunWrapped__ = true;
      }

      if (aggressiveCompat) {
        forceTimerPacer(game);
      }

      game.__fbPlayableMetaCompatPatched__ = true;
      return true;
    } catch (e) {}
    return false;
  }

  function patchCcObject(cc){
    if (!cc) return false;
    const aggressiveCompat = shouldUseAggressiveCompat('patch-cc-object');
    if (aggressiveCompat) {
      patchAnimationController(cc);
      patchCameraComponent(cc);
    }
    patchDirector(cc);
    patchAssetManagerDiagnostics(cc);
    patchCcGame(cc);
    if (aggressiveCompat) {
      repairSceneBindings(cc);
    }
    forceViewRefresh(cc, 'patch-cc-object');
    return true;
  }

  function tryPatchCurrentCc(){
    const cc = window.cc;
    if (!cc) return false;
    patchCcObject(cc);
    return true;
  }

  function resumePlayable(cc){
    const game = cc && cc.game;
    const director = cc && cc.director;
    let resumed = false;

    tryNotifyReady();

    try {
      if (game && game._pausedByEngine && typeof game.resumeByEngine === 'function') {
        game.resumeByEngine();
        resumed = true;
      } else if (game && typeof game.isPaused === 'function' && game.isPaused() && typeof game.resume === 'function') {
        game.resume();
        resumed = true;
      }
    } catch (e) {}

    try {
      if (resumed && director && typeof director.resume === 'function') {
        director.resume();
      }
    } catch (e) {}

    if (resumed) {
      window.__PLAYABLE_FACEBOOK_LAST_RESUME_ATTEMPT_AT__ = Date.now();
    }

    return resumed;
  }

  function getTotalDrawCount(){
    return Number(window.__PLAYABLE_FACEBOOK_DRAW_ARRAYS_COUNT__ || 0)
      + Number(window.__PLAYABLE_FACEBOOK_DRAW_ELEMENTS_COUNT__ || 0)
      + Number(window.__PLAYABLE_FACEBOOK_DRAW_ARRAYS_INSTANCED_COUNT__ || 0)
      + Number(window.__PLAYABLE_FACEBOOK_DRAW_ELEMENTS_INSTANCED_COUNT__ || 0)
      + Number(window.__PLAYABLE_FACEBOOK_DRAW_RANGE_ELEMENTS_COUNT__ || 0);
  }

  function recoverFacebookRender(reason){
    const cc = window.cc;
    const game = cc && cc.game;
    const director = cc && cc.director;
    const scene = director && typeof director.getScene === 'function'
      ? director.getScene()
      : null;
    const aggressiveCompat = shouldUseAggressiveCompat('recover-render');

    tryPatchCurrentCc();
    if (!aggressiveCompat) {
      window.__PLAYABLE_FACEBOOK_LAST_RENDER_RECOVERY_SKIPPED__ = reason || '';
      window.__PLAYABLE_FACEBOOK_LAST_RENDER_RECOVERY_SKIPPED_AT__ = Date.now();
      return getTotalDrawCount();
    }
    resumePlayable(cc);

    try {
      if (game) {
        forceTimerPacer(game);
      }
    } catch (e) {}

    try {
      const pacer = game && game._pacer;
      if (pacer && !pacer._isPlaying && typeof pacer.start === 'function') {
        pacer.start();
      }
    } catch (e) {}

    try {
      if (director && typeof director.resume === 'function') {
        director.resume();
      }
    } catch (e) {}

    try {
      if (director && typeof director.startAnimation === 'function') {
        director.startAnimation();
      }
    } catch (e) {}

    try {
      if (director && typeof director.tick === 'function') {
        director.tick(0);
      }
    } catch (e) {}

    try {
      if (!scene) {
        forceLaunchScene(cc, game);
      }
    } catch (e) {}

    forceViewRefresh(cc, 'recover-render:' + (reason || ''));
    repairSceneBindings(cc);
    tryNotifyReady();

    window.__PLAYABLE_FACEBOOK_LAST_RENDER_RECOVERY_REASON__ = reason || '';
    window.__PLAYABLE_FACEBOOK_LAST_RENDER_RECOVERY_AT__ = Date.now();
    window.__PLAYABLE_FACEBOOK_LAST_RENDER_RECOVERY_DRAWS__ = getTotalDrawCount();
    return window.__PLAYABLE_FACEBOOK_LAST_RENDER_RECOVERY_DRAWS__;
  }

  function maybeForceFacebookPlayableReady(reason){
    try {
      if (!shouldUseAggressiveCompat('force-ready-timeout')) return false;
      if (window.__PLAYABLE_FACEBOOK_FORCE_READY__ === true) return true;
      if (window.__PACK_START_IMPORT_FAILED__ || window.__PLAYABLE_FACEBOOK_GAME_INIT_ERROR__ || window.__PLAYABLE_FACEBOOK_GAME_RUN_ERROR__) {
        return false;
      }

      const cc = window.cc;
      const director = cc && cc.director;
      const scene = director && typeof director.getScene === 'function'
        ? director.getScene()
        : null;
      const drawCount = getTotalDrawCount();
      const pendingCount = getPackPendingResourceCount();
      const lastResourceAt = getPackLastResourceActivityAt();
      const idleMs = lastResourceAt > 0 ? Date.now() - lastResourceAt : 999999;

      if (!window.__PACK_START_IMPORT_DONE_AT__ && !window.__PLAYABLE_FACEBOOK_GAME_RUN_RESOLVED_AT__) {
        return false;
      }
      if (pendingCount > 0) return false;
      if (idleMs < 1200) return false;
      if (scene && drawCount > 0) return false;

      window.__PLAYABLE_FACEBOOK_FORCE_READY__ = true;
      window.__PLAYABLE_FACEBOOK_DELAY_READY__ = false;
      window.__PLAYABLE_FACEBOOK_READY_FORCE_REASON__ = reason || 'watchdog';
      window.__PLAYABLE_FACEBOOK_READY_FORCE_AT__ = Date.now();
      tryNotifyReady();
      return true;
    } catch (e) {}
    return false;
  }

  function scheduleForceLaunchSceneFallback(cc, game, reason){
    try {
      if (!shouldUseAggressiveCompat('schedule-force-launch-scene')) return false;
      if (!game) return false;
      const token = Number(game.__fbPlayableScheduledForceLaunchToken__ || 0) + 1;
      game.__fbPlayableScheduledForceLaunchToken__ = token;
      window.__PLAYABLE_FACEBOOK_LAST_SCHEDULED_SCENE_FORCE_REASON__ = reason || '';
      window.__PLAYABLE_FACEBOOK_LAST_SCHEDULED_SCENE_FORCE_AT__ = Date.now();
      setTimeout(function(){
        try {
          if (!game || Number(game.__fbPlayableScheduledForceLaunchToken__ || 0) !== token) return;
          const director = cc && cc.director;
          const scene = director && typeof director.getScene === 'function'
            ? director.getScene()
            : null;
          if (scene) return;
          forceLaunchScene(cc, game);
        } catch (e) {}
      }, 2200);
      return true;
    } catch (e) {}
    return false;
  }

  function installFirstFrameWatchdog(){
    if (!shouldUseAggressiveCompat('install-watchdog')) return false;
    if (window.__fbPlayableFirstFrameWatchdogInstalled__) return true;

    let attempts = 0;
    const timer = setInterval(function(){
      const cc = window.cc;
      const director = cc && cc.director;
      const scene = director && typeof director.getScene === 'function'
        ? director.getScene()
        : null;

      attempts += 1;
      if (getTotalDrawCount() > 0) {
        clearInterval(timer);
        return;
      }

      if (!scene && cc && cc.game && attempts >= 8 && attempts % 4 === 0) {
        recoverFacebookRender('scene-watchdog');
      }

      if (scene && attempts >= 8) {
        recoverFacebookRender('first-frame-watchdog');
      }

      if (attempts >= 20 && attempts % 4 === 0) {
        maybeForceFacebookPlayableReady(scene ? 'first-frame-watchdog' : 'scene-watchdog');
      }

      if (attempts >= 120) {
        clearInterval(timer);
      }
    }, 250);

    window.__fbPlayableFirstFrameWatchdogInstalled__ = true;
    return true;
  }

  function handleResumeSignal(){
    const aggressiveCompat = shouldUseAggressiveCompat('resume-signal');
    tryPatchCurrentCc();
    if (!aggressiveCompat) {
      forceViewRefresh(window.cc, 'resume-signal-passive');
      tryNotifyReady();
      return false;
    }
    resumePlayable(window.cc);
    forceViewRefresh(window.cc, 'resume-signal');
    tryNotifyReady();
    return true;
  }

  window.__PLAYABLE_FACEBOOK_PATCH_CC__ = patchCcObject;
  window.__PLAYABLE_FACEBOOK_RECOVER_RENDER__ = recoverFacebookRender;
  if (shouldUseAggressiveCompat('bootstrap-watchdog')) {
    installFirstFrameWatchdog();
  }

  let attempts = 0;
  const timer = setInterval(function(){
    attempts += 1;
    tryPatchCurrentCc();
    if (attempts >= 120) {
      clearInterval(timer);
    }
  }, 100);

  if (shouldUseAggressiveCompat('bootstrap-events')) {
    ['focus', 'pageshow', 'pointerdown', 'touchstart', 'mousedown', 'click', 'message'].forEach(function(eventName){
      window.addEventListener(eventName, function(){
        handleResumeSignal();
      }, true);
    });

    setTimeout(function(){
      handleResumeSignal();
    }, 0);
  }
})();`.trim();
}

function makeChannelRuntimeCompatScript(channel) {
  if (channel === 'facebook') {
    return makeFacebookMetaCompatScript();
  }
  return '';
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

function normalizeImportMapTarget(importMapRel, target) {
  const raw = String(target || '').trim();
  if (!raw) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/i.test(raw) || raw.startsWith('//')) {
    return raw;
  }
  const baseDir = path.posix.dirname(normalizePackRel(importMapRel));
  const joined = baseDir && baseDir !== '.'
    ? path.posix.join(baseDir, raw)
    : raw;
  return normalizePackRel(path.posix.normalize(joined)).replace(/^\.\//, '');
}

function buildCompatImportMap(importMapRel, source) {
  try {
    const parsed = JSON.parse(String(source || '{}'));
    const compat = {
      imports: {},
      scopes: {},
    };

    if (parsed && parsed.imports && typeof parsed.imports === 'object') {
      for (const [specifier, target] of Object.entries(parsed.imports)) {
        if (typeof target !== 'string') continue;
        const normalizedTarget = normalizeImportMapTarget(importMapRel, target);
        if (!normalizedTarget) continue;
        compat.imports[specifier] = normalizedTarget;
      }
    }

    if (parsed && parsed.scopes && typeof parsed.scopes === 'object') {
      for (const [scopeKey, scopeImports] of Object.entries(parsed.scopes)) {
        if (!scopeImports || typeof scopeImports !== 'object') continue;
        const normalizedScopeKey = normalizeImportMapTarget(importMapRel, scopeKey);
        const nextScopeImports = {};
        for (const [specifier, target] of Object.entries(scopeImports)) {
          if (typeof target !== 'string') continue;
          const normalizedTarget = normalizeImportMapTarget(importMapRel, target);
          if (!normalizedTarget) continue;
          nextScopeImports[specifier] = normalizedTarget;
        }
        if (normalizedScopeKey && Object.keys(nextScopeImports).length) {
          compat.scopes[normalizedScopeKey] = nextScopeImports;
        }
      }
    }

    return compat;
  } catch (error) {
    return {
      imports: {},
      scopes: {},
      __parseError: error && error.message ? error.message : String(error),
    };
  }
}

function makeImportMapCompatScript(importMapRel, source, channel = '') {
  const compatImportMap = buildCompatImportMap(importMapRel, source);
  const packBaseUrlExpr = makePackBaseUrlExpr(channel);
  const fallbackSourceStmt = channel === 'facebook'
    ? ''
    : `window.__PLAYABLE_IMPORTMAP_FALLBACK_SOURCE__ = ${JSON.stringify(normalizePackRel(importMapRel))};`;
  return `
(function(){
  var compatImportMap = ${JSON.stringify(compatImportMap)};
  var installAttempts = 0;

  function getBaseUrl(){
    var fallback = ${packBaseUrlExpr};
    try {
      if (document && typeof document.baseURI === 'string' && document.baseURI && !/^about:(blank|srcdoc)$/i.test(document.baseURI)) {
        return document.baseURI;
      }
    } catch (error) {}
    try {
      var loc = window.location || {};
      if (typeof loc.href === 'string' && loc.href) {
        return loc.href;
      }
    } catch (error) {}
    return fallback;
  }

  function toAbsoluteUrl(target){
    if (!target) return target;
    try {
      return new URL(String(target), getBaseUrl()).href;
    } catch (error) {
      return String(target);
    }
  }

  function resolveImportsTable(specifier, table){
    if (!specifier || !table) return '';
    if (Object.prototype.hasOwnProperty.call(table, specifier)) {
      return table[specifier];
    }
    var bestKey = '';
    for (var key in table) {
      if (!Object.prototype.hasOwnProperty.call(table, key)) continue;
      if (!key || key[key.length - 1] !== '/') continue;
      if (specifier.indexOf(key) !== 0) continue;
      if (!bestKey || key.length > bestKey.length) {
        bestKey = key;
      }
    }
    if (!bestKey) return '';
    return String(table[bestKey] || '') + String(specifier).slice(bestKey.length);
  }

  function resolveScopedTarget(specifier, parentUrl){
    var scopes = compatImportMap && compatImportMap.scopes;
    if (!scopes || !parentUrl) return '';
    var normalizedParent = String(parentUrl || '');
    var bestScopeLength = 0;
    var bestScopeImports = null;
    for (var key in scopes) {
      if (!Object.prototype.hasOwnProperty.call(scopes, key)) continue;
      if (!key) continue;
      var absoluteScopeKey = toAbsoluteUrl(key);
      if (normalizedParent.indexOf(absoluteScopeKey) !== 0) continue;
      if (absoluteScopeKey.length > bestScopeLength) {
        bestScopeLength = absoluteScopeKey.length;
        bestScopeImports = scopes[key];
      }
    }
    if (!bestScopeImports) return '';
    return resolveImportsTable(specifier, bestScopeImports);
  }

  function resolveTarget(specifier, parentUrl){
    var scoped = resolveScopedTarget(specifier, parentUrl);
    if (scoped) return scoped;
    return resolveImportsTable(specifier, compatImportMap && compatImportMap.imports);
  }

  function install(){
    installAttempts += 1;
    try {
      var system = window.System;
      var proto = system && system.constructor && system.constructor.prototype;
      if (!proto || typeof proto.resolve !== 'function') {
        return false;
      }
      if (proto.__playableImportMapCompatInstalled__) {
        return true;
      }

      var originalResolve = proto.resolve;
      proto.resolve = function(specifier, parentUrl){
        var aliasTarget = resolveTarget(String(specifier || ''), parentUrl);
        if (aliasTarget) {
          var resolvedAliasUrl = toAbsoluteUrl(aliasTarget);
          window.__PLAYABLE_IMPORTMAP_FALLBACK_LAST_SPECIFIER__ = String(specifier || '');
          window.__PLAYABLE_IMPORTMAP_FALLBACK_LAST_PARENT__ = parentUrl ? String(parentUrl) : '';
          window.__PLAYABLE_IMPORTMAP_FALLBACK_LAST_TARGET__ = aliasTarget;
          window.__PLAYABLE_IMPORTMAP_FALLBACK_LAST_URL__ = resolvedAliasUrl;
          window.__PLAYABLE_IMPORTMAP_FALLBACK_LAST_AT__ = Date.now();
          return resolvedAliasUrl;
        }
        return originalResolve.call(this, specifier, parentUrl);
      };
      proto.__playableImportMapCompatInstalled__ = true;
      window.__PLAYABLE_IMPORTMAP_FALLBACK_INSTALLED__ = true;
      window.__PLAYABLE_IMPORTMAP_FALLBACK_INSTALLED_AT__ = Date.now();
      return true;
    } catch (error) {
      window.__PLAYABLE_IMPORTMAP_FALLBACK_ERROR__ = error && error.message ? error.message : String(error);
      window.__PLAYABLE_IMPORTMAP_FALLBACK_ERROR_AT__ = Date.now();
      return false;
    }
  }

  ${fallbackSourceStmt}
  window.__PLAYABLE_IMPORTMAP_FALLBACK_IMPORTS__ = compatImportMap && compatImportMap.imports ? compatImportMap.imports : {};
  if (compatImportMap && compatImportMap.__parseError) {
    window.__PLAYABLE_IMPORTMAP_FALLBACK_ERROR__ = compatImportMap.__parseError;
  }

  if (install()) {
    return;
  }

  var retryTimer = setInterval(function(){
    if (install() || installAttempts >= 80) {
      clearInterval(retryTimer);
    }
  }, 50);
})();
`.trim();
}

function makeFacebookBootOverlayMarkup(channel) {
  if (channel !== 'facebook') return '';
  const showVisualOverlay = false;
  return `
<style>
#__PLAYABLE_BOOT_OVERLAY__ {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: ${showVisualOverlay ? 'flex' : 'none'};
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 50% 35%, rgba(217, 184, 67, 0.16), rgba(0, 0, 0, 0) 34%),
    linear-gradient(180deg, rgba(4, 10, 12, 0.94), rgba(3, 7, 8, 0.98));
  color: #f3e4a8;
  pointer-events: none;
  opacity: 1;
  transition: opacity 240ms ease;
}

#__PLAYABLE_BOOT_OVERLAY__.is-hidden {
  opacity: 0;
}

#__PLAYABLE_BOOT_OVERLAY__ .boot-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 18px 22px;
  border-radius: 18px;
  background: rgba(8, 16, 18, 0.58);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(6px);
}

#__PLAYABLE_BOOT_OVERLAY__ .boot-spinner {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 3px solid rgba(243, 228, 168, 0.22);
  border-top-color: #f3e4a8;
  animation: playable-boot-spin 900ms linear infinite;
}

#__PLAYABLE_BOOT_OVERLAY__ .boot-text {
  font: 700 14px/1.2 Helvetica, Arial, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

#__PLAYABLE_BOOT_OVERLAY__ .boot-debug {
  max-width: 320px;
  color: rgba(243, 228, 168, 0.78);
  font: 500 11px/1.4 Consolas, Monaco, monospace;
  letter-spacing: 0.01em;
  text-align: center;
  text-transform: none;
  word-break: break-word;
}

@keyframes playable-boot-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
<div id="__PLAYABLE_BOOT_OVERLAY__" aria-hidden="true">
  <div class="boot-card">
    <div class="boot-spinner"></div>
    <div class="boot-text">Preparing Playable...</div>
    <div class="boot-debug"></div>
  </div>
</div>
<script>(function(){
  var overlay = document.getElementById('__PLAYABLE_BOOT_OVERLAY__');
  if (!overlay) return;
  var textNode = overlay.querySelector('.boot-text');
  var debugNode = overlay.querySelector('.boot-debug');
  var startAt = Date.now();
  var lastRecoveryRequestAt = 0;
  var settled = false;

  function setText(value){
    if (!textNode || !value) return;
    if (textNode.textContent !== value) {
      textNode.textContent = value;
    }
  }

  function setDebug(value){
    if (!debugNode) return;
    debugNode.textContent = value || '';
  }

  function compactDebugValue(value, maxLength){
    var limit = Number(maxLength) > 0 ? Number(maxLength) : 56;
    var text = String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
    if (!text) return '';
    text = text.replace(/^https?:\\/\\/[^/]+\\//i, '');
    if (text.length > limit) {
      var head = Math.min(18, Math.max(8, Math.floor(limit * 0.35)));
      var tail = Math.max(8, limit - head - 3);
      text = text.slice(0, head) + '...' + text.slice(Math.max(0, text.length - tail));
    }
    return text;
  }

  function totalDrawCount(){
    return Number(window.__PLAYABLE_FACEBOOK_DRAW_ARRAYS_COUNT__ || 0)
      + Number(window.__PLAYABLE_FACEBOOK_DRAW_ELEMENTS_COUNT__ || 0)
      + Number(window.__PLAYABLE_FACEBOOK_DRAW_ARRAYS_INSTANCED_COUNT__ || 0)
      + Number(window.__PLAYABLE_FACEBOOK_DRAW_ELEMENTS_INSTANCED_COUNT__ || 0)
      + Number(window.__PLAYABLE_FACEBOOK_DRAW_RANGE_ELEMENTS_COUNT__ || 0);
  }

  function hasLiveScene(){
    try {
      var cc = window.cc;
      var director = cc && cc.director;
      return !!(director && typeof director.getScene === 'function' && director.getScene());
    } catch (error) {}
    return false;
  }

  function hideOverlay(){
    if (settled || !overlay) return;
    settled = true;
    overlay.classList.add('is-hidden');
    setTimeout(function(){
      try {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      } catch (error) {}
    }, 260);
  }

  function requestRenderRecovery(reason){
    var now = Date.now();
    if (now - lastRecoveryRequestAt < 900) return;
    lastRecoveryRequestAt = now;
    try {
      if (typeof window.__PLAYABLE_FACEBOOK_RECOVER_RENDER__ === 'function') {
        window.__PLAYABLE_FACEBOOK_RECOVER_RENDER__(reason || 'boot-overlay');
      }
    } catch (error) {}
  }

  function tick(){
    if (!overlay || settled) return;
    var elapsed = Date.now() - startAt;
    var readyState = String(window.__PLAYABLE_FACEBOOK_READY_STATE__ || '');
    var bootstrapFailed = window.__PACK_BOOTSTRAP_FAILED__ === true;
    var startFailed = window.__PACK_START_IMPORT_FAILED__ === true;
    var bootstrapReady = !!window.__PACK_BOOTSTRAP_DONE_AT__;
    var drawCount = totalDrawCount();
    var liveScene = hasLiveScene();
    var debugParts = [];

    debugParts.push('boot=' + (bootstrapReady ? '1' : '0'));
    debugParts.push('scene=' + (liveScene ? '1' : '0'));
    debugParts.push('draw=' + String(drawCount));
    debugParts.push('cc=' + (window.cc ? '1' : '0'));
    if (typeof window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT__ !== 'undefined') {
      debugParts.push('agg=' + (window.__PLAYABLE_FACEBOOK_AGGRESSIVE_COMPAT__ ? '1' : '0'));
    }
    if (window.__PACK_START_IMPORT_DONE_AT__) {
      debugParts.push('start=ok');
    } else if (window.__PACK_START_IMPORT_FAILED__) {
      debugParts.push('start=fail');
    } else if (window.__PACK_START_IMPORT_AT__) {
      debugParts.push('start=run');
    } else {
      debugParts.push('start=wait');
    }
    if (readyState) debugParts.push('ready=' + readyState);
    if (window.__PLAYABLE_IMPORTMAP_FALLBACK_LAST_SPECIFIER__) {
      debugParts.push('map=' + String(window.__PLAYABLE_IMPORTMAP_FALLBACK_LAST_SPECIFIER__));
    } else if (window.__PLAYABLE_IMPORTMAP_FALLBACK_INSTALLED__) {
      debugParts.push('map=ready');
    }
    if (window.__PLAYABLE_PACK_INSTANTIATE_LAST_REL__) {
      debugParts.push('mod=' + String(window.__PLAYABLE_PACK_INSTANTIATE_LAST_REL__).split('/').slice(-1)[0]);
    }
    if (window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_TRY__) {
      debugParts.push('fscene=' + String(window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_TRY__).split('/').slice(-1)[0].replace(/\\.scene$/i, ''));
    }
    if (window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_MODE__) {
      debugParts.push('fmode=' + String(window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_MODE__));
    }
    if (window.__PLAYABLE_FACEBOOK_GAME_INIT_RESOLVED_AT__) {
      debugParts.push('ginit=ok');
    } else if (window.__PLAYABLE_FACEBOOK_GAME_INIT_ERROR__) {
      debugParts.push('ginit=fail');
    } else if (window.__PLAYABLE_FACEBOOK_GAME_INIT_CALLED_AT__ || window.__PLAYABLE_FACEBOOK_APP_START_AT__) {
      debugParts.push('ginit=run');
    }
    if (window.__PLAYABLE_FACEBOOK_GAME_RUN_RESOLVED_AT__) {
      debugParts.push('grun=ok');
    } else if (window.__PLAYABLE_FACEBOOK_GAME_RUN_ERROR__) {
      debugParts.push('grun=fail');
    } else if (window.__PLAYABLE_FACEBOOK_GAME_RUN_CALLED_AT__ || window.__PLAYABLE_FACEBOOK_GAME_RUN_REQUEST_AT__) {
      debugParts.push('grun=run');
    }
    if (typeof window.__PLAYABLE_FACEBOOK_PENDING_RESOURCE_COUNT__ !== 'undefined') {
      debugParts.push('pend=' + String(window.__PLAYABLE_FACEBOOK_PENDING_RESOURCE_COUNT__ || 0));
    }
    if (window.__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT__ || window.__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT__) {
      let imageSummary = String(window.__PLAYABLE_FACEBOOK_LAST_IMAGE_TRANSPORT__ || '');
      if (window.__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT__) {
        imageSummary += (imageSummary ? '/' : '') + String(window.__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT__ || '');
      }
      if (window.__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT_INFO__) {
        imageSummary += ':' + String(window.__PLAYABLE_FACEBOOK_LAST_IMAGE_EVENT_INFO__ || '');
      }
      debugParts.push('img=' + compactDebugValue(imageSummary, 56));
    }
    if (window.__PLAYABLE_FACEBOOK_LAST_RESOURCE_REQUEST__) {
      debugParts.push('req=' + compactDebugValue(window.__PLAYABLE_FACEBOOK_LAST_RESOURCE_REQUEST__, 48));
    }
    if (window.__PLAYABLE_FACEBOOK_LAST_ASSET_STAGE__ || window.__PLAYABLE_FACEBOOK_LAST_ASSET_SUBJECT__) {
      debugParts.push(
        'asset=' + compactDebugValue(
          String(window.__PLAYABLE_FACEBOOK_LAST_ASSET_STAGE__ || '')
          + ':'
          + String(window.__PLAYABLE_FACEBOOK_LAST_ASSET_SUBJECT__ || ''),
          64
        )
      );
    }
    if (window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__) {
      debugParts.push(
        'scn=' + compactDebugValue(
          String(window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_STAGE__ || '')
          + ':'
          + String(window.__PLAYABLE_FACEBOOK_LAST_SCENE_LOAD_NAME__ || ''),
          64
        )
      );
    }
    if (window.__PACK_BOOTSTRAP_ERROR__) {
      debugParts.push('pack=' + String(window.__PACK_BOOTSTRAP_ERROR__).slice(0, 72));
    }
    if (window.__PACK_START_IMPORT_ERROR__) {
      debugParts.push('start=' + String(window.__PACK_START_IMPORT_ERROR__).slice(0, 72));
    }
    if (window.__PLAYABLE_PACK_INSTANTIATE_ERROR__) {
      debugParts.push('inst=' + String(window.__PLAYABLE_PACK_INSTANTIATE_ERROR__).slice(0, 72));
    }
    if (window.__PLAYABLE_FACEBOOK_GAME_INIT_ERROR__) {
      debugParts.push('ginit=' + String(window.__PLAYABLE_FACEBOOK_GAME_INIT_ERROR__).slice(0, 72));
    }
    if (window.__PLAYABLE_FACEBOOK_GAME_RUN_ERROR__) {
      debugParts.push('grun=' + String(window.__PLAYABLE_FACEBOOK_GAME_RUN_ERROR__).slice(0, 72));
    }
    if (window.__PLAYABLE_FACEBOOK_LAST_RESOURCE_ERROR__) {
      debugParts.push('rerr=' + compactDebugValue(window.__PLAYABLE_FACEBOOK_LAST_RESOURCE_ERROR__, 64));
    }
    if (window.__PLAYABLE_FACEBOOK_LAST_ASSET_ERROR__) {
      debugParts.push('aerr=' + compactDebugValue(window.__PLAYABLE_FACEBOOK_LAST_ASSET_ERROR__, 64));
    }
    if (window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_ERROR__) {
      debugParts.push('serr=' + String(window.__PLAYABLE_FACEBOOK_LAST_FORCED_SCENE_ERROR__).slice(0, 72));
    }
    if (window.__PLAYABLE_IMPORTMAP_FALLBACK_ERROR__) {
      debugParts.push('imap=' + String(window.__PLAYABLE_IMPORTMAP_FALLBACK_ERROR__).slice(0, 72));
    }
    setDebug(debugParts.join(' | '));

    if (bootstrapFailed || startFailed) {
      setText('Playable Start Failed');
      return;
    }

    if (drawCount > 0) {
      hideOverlay();
      return;
    }

    if (!bootstrapReady) {
      setText('Loading Assets...');
    } else if (elapsed > 3500 && !liveScene && window.cc) {
      setText('Starting Scene...');
      requestRenderRecovery('overlay-scene');
    } else if (elapsed > 4500 && liveScene) {
      setText('Recovering Render...');
      requestRenderRecovery('overlay-recover');
    } else if (readyState.indexOf('scene') === 0 || readyState.indexOf('waiting-first-draw') === 0 || liveScene) {
      setText('Starting Scene...');
    } else {
      setText('Preparing Playable...');
    }
  }

  tick();
  setInterval(tick, 120);
})();</script>
`;
}

function addFaviconIfMissing(html) {
  if (/<link[^>]+rel=["']icon["']/i.test(html)) return html;
  return html.replace(/<head>/i, '<head>\n  <link rel="icon" href="data:,">');
}

function addPackBaseHrefIfNeeded(html, channel) {
  if (channel !== 'facebook') return html;
  if (/__PLAYABLE_PACK_BASE_COMPAT__/i.test(html)) return html;
  const compatScript = `<script id="__PLAYABLE_PACK_BASE_COMPAT__">(function(){try{var loc=window.location||{};var protocol=String(loc.protocol||'').toLowerCase();if(protocol==='http:'||protocol==='https:'||protocol==='file:'||protocol==='blob:')return;if(document.querySelector('base[href]'))return;var head=document.head||document.getElementsByTagName('head')[0];if(!head)return;var base=document.createElement('base');base.href=${makePackBaseUrlExpr(channel)};head.insertBefore(base,head.firstChild);}catch(e){}})();</script>`;
  return html.replace(/<\/head>/i, `  ${compatScript}\n</head>`);
}

function inlineStyleIfPresent(html) {
  if (!fs.existsSync(path.join(BUILD_DIR, 'style.css'))) return html;
  const css = readText('style.css');
  return html.replace(/<link[^>]+href="style\.css"[^>]*>/i, `<style>\n${escapeInlineStyle(css)}\n</style>`);
}

function inlineScriptSrcAsset(html, relPath, channel) {
  const escaped = relPath
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\//g, '\\/');
  const re = new RegExp(`<script[^>]*src="${escaped}"[^>]*>\\s*<\\/script>`, 'i');
  const source = transformScriptSourceForChannel(channel, relPath, readText(relPath));
  return html.replace(re, inlineScriptTag(source));
}

function inlineImportMapAsset(html, relPath, channel) {
  const escaped = relPath
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\//g, '\\/');
  const re = new RegExp(`<script[^>]*src="${escaped}"[^>]*type="systemjs-importmap"[^>]*>\\s*<\\/script>`, 'i');
  const source = readText(relPath);
  const compatTag = inlineScriptTag(makeImportMapCompatScript(relPath, source, channel));
  if (channel === 'facebook') {
    return html.replace(re, compatTag);
  }
  return html.replace(re, `${inlineImportMapTag(source)}\n${compatTag}`);
}

function makePackBootstrapScript(useBase64, blobCompression, manifestEncoding) {
  return `<script>(function(){
  const PACK_ENCODING = ${JSON.stringify(useBase64 ? 'base64' : 'base91')};
  const PACK_BLOB_COMPRESSION = ${JSON.stringify(blobCompression)};
  const PACK_MANIFEST_ENCODING = ${JSON.stringify(manifestEncoding)};
  const B91_ALPHABET = ${JSON.stringify(B91_ALPHABET)};
  const nodes = document.querySelectorAll('.__PACK_BIN_CHUNK__');
  const manifestNode = document.getElementById('__PACK_MANIFEST__');
  const inlineManifestText = typeof window.__PACK_INLINE_MANIFEST__ === 'string' ? window.__PACK_INLINE_MANIFEST__ : '';
  const inlinePayloadText = typeof window.__PACK_INLINE_PAYLOAD__ === 'string' ? window.__PACK_INLINE_PAYLOAD__ : '';
  function readPackNodeText(node){
    if (!node) return '';
    if (node.content && typeof node.content.textContent === 'string') {
      return node.content.textContent;
    }
    if (typeof node.value === 'string') return node.value;
    return node.textContent || '';
  }
  let payload = inlinePayloadText || '';
  if (!payload) {
    for (let i = 0; i < nodes.length; i++) {
      payload += readPackNodeText(nodes[i]);
    }
  }
  payload = payload.replace(/\\s+/g, '');
  const rawManifestText = inlineManifestText || (manifestNode ? (readPackNodeText(manifestNode) || '') : '');
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

  function bytesToUtf8(bytes){
    if (!bytes || !bytes.length) return '';
    if (typeof TextDecoder === 'function') {
      try {
        return new TextDecoder('utf-8').decode(bytes);
      } catch (e) {}
    }
    let encoded = '';
    for (let i = 0; i < bytes.length; i++) {
      const hex = bytes[i].toString(16);
      encoded += '%' + (hex.length < 2 ? '0' + hex : hex);
    }
    try {
      return decodeURIComponent(encoded);
    } catch (e) {}
    let fallback = '';
    for (let i = 0; i < bytes.length; i++) {
      fallback += String.fromCharCode(bytes[i]);
    }
    return fallback;
  }

  function decodePayload(raw){
    if (PACK_ENCODING === 'base91') return b91ToBytes(raw);
    return b64ToBytes(raw);
  }

  function decodeManifestText(raw){
    if (PACK_MANIFEST_ENCODING === 'json') {
      return raw || '{}';
    }
    const clean = String(raw || '').replace(/\\s+/g, '');
    if (!clean) return '{}';
    if (PACK_MANIFEST_ENCODING === 'utf8-base91') {
      return bytesToUtf8(b91ToBytes(clean));
    }
    if (PACK_MANIFEST_ENCODING === 'utf8-base64') {
      return bytesToUtf8(b64ToBytes(clean));
    }
    throw new Error('Unsupported manifest encoding: ' + PACK_MANIFEST_ENCODING);
  }

  async function maybeDecompress(bytes){
    if (PACK_BLOB_COMPRESSION === 'none') return bytes;

    async function readStreamBytes(stream){
      if (!stream || typeof stream.getReader !== 'function') {
        throw new Error('ReadableStream reader is not available for blob decompression.');
      }
      const reader = stream.getReader();
      const parts = [];
      let total = 0;
      while (true) {
        const step = await reader.read();
        if (!step || step.done) break;
        const value = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value || 0);
        parts.push(value);
        total += value.length;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (let i = 0; i < parts.length; i++) {
        out.set(parts[i], offset);
        offset += parts[i].length;
      }
      return out;
    }

    if (PACK_BLOB_COMPRESSION === 'gzip') {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('DecompressionStream is not available for gzip blob layer.');
      }
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return readStreamBytes(stream);
    }

    throw new Error('Unsupported blob compression: ' + PACK_BLOB_COMPRESSION);
  }

  window.__PACK_BOOTSTRAP_READY__ = (async function(){
    try {
      window.__PACK_BOOTSTRAP_FAILED__ = false;
      window.__PACK_BOOTSTRAP_STARTED_AT__ = Date.now();
      window.__PACK_MANIFEST__ = JSON.parse(decodeManifestText(rawManifestText) || '{}');
      const decoded = decodePayload(payload);
      window.__PACK_BLOB__ = await maybeDecompress(decoded);
      window.__PACK_BOOTSTRAP_DONE_AT__ = Date.now();
      window.__PACK_BOOTSTRAP_BYTES__ = window.__PACK_BLOB__ && window.__PACK_BLOB__.length ? window.__PACK_BLOB__.length : 0;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
      }
      if (manifestNode && manifestNode.parentNode) manifestNode.parentNode.removeChild(manifestNode);
      try {
        delete window.__PACK_INLINE_MANIFEST__;
        delete window.__PACK_INLINE_PAYLOAD__;
      } catch (e) {
        window.__PACK_INLINE_MANIFEST__ = '';
        window.__PACK_INLINE_PAYLOAD__ = '';
      }
    } catch (e) {
      console.error('[pack-single-html] binary pack parse failed:', e && e.message ? e.message : e);
      window.__PACK_BOOTSTRAP_FAILED__ = true;
      window.__PACK_BOOTSTRAP_ERROR__ = e && e.message ? e.message : String(e);
      window.__PACK_BOOTSTRAP_FAILED_AT__ = Date.now();
      window.__PACK_MANIFEST__ = {};
      window.__PACK_BLOB__ = new Uint8Array(0);
    }
  })();
})();</script>`;
}

function makeSystemImportStartScript(channel = '') {
  const entryModuleExpr = channel === 'facebook'
    ? `('.' + '/' + 'index' + '.js')`
    : `'./index.js'`;
  return `<script>(function(){
  function toPromise(value){
    if (value && typeof value.then === 'function') return value;
    return Promise.resolve(value);
  }
  function waitForCanvasReady(){
    function hasCanvas(){
      try {
        const canvas = document.getElementById('GameCanvas');
        return !!(canvas && canvas.parentElement);
      } catch (err) {
        return false;
      }
    }
    function cleanup(observer, onChange, timer){
      if (observer && typeof observer.disconnect === 'function') observer.disconnect();
      if (typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('DOMContentLoaded', onChange, true);
      }
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('load', onChange, true);
      }
      if (timer) clearTimeout(timer);
    }
    if (hasCanvas()) return Promise.resolve();
    return new Promise(function(resolve){
      let done = false;
      let observer = null;
      let timer = null;
      function finish(){
        if (done) return;
        done = true;
        cleanup(observer, onChange, timer);
        resolve();
      }
      function onChange(){
        if (hasCanvas()) finish();
      }
      try {
        if (typeof MutationObserver === 'function' && document && document.documentElement) {
          observer = new MutationObserver(onChange);
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }
      } catch (err) {}
      try {
        if (document && document.addEventListener) {
          document.addEventListener('DOMContentLoaded', onChange, true);
        }
      } catch (err) {}
      try {
        if (window && window.addEventListener) {
          window.addEventListener('load', onChange, true);
        }
      } catch (err) {}
      timer = setTimeout(finish, 4000);
      onChange();
    });
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
    window.__PACK_START_IMPORT_AT__ = Date.now();
    var entryModule = ${entryModuleExpr};
    System.import(entryModule).then(function(){
      window.__PACK_START_IMPORT_DONE_AT__ = Date.now();
      window.__PACK_START_IMPORT_FAILED__ = false;
      window.__PACK_START_IMPORT_ERROR__ = '';
    }).catch(function(err) {
      console.error(err);
      window.__PACK_START_IMPORT_FAILED__ = true;
      window.__PACK_START_IMPORT_ERROR__ = err && err.message ? err.message : String(err);
      window.__PACK_START_IMPORT_FAILED_AT__ = Date.now();
    });
  }
  Promise.all([waitForBootstrap(), waitForPlayableStartGate(), waitForCanvasReady()]).then(function(){
    start();
  }).catch(function(err){
    console.error('[pack-single-html] startup wait failed:', err && err.message ? err.message : err);
    start();
  });
})();</script>`;
}

function createPackPayloadData(channel, manifest, blob, useBase64) {
  const manifestJson = JSON.stringify(manifest);
  const packStorageConfig = resolvePackStorageConfig(channel, useBase64);
  const manifestPayload = encodePackManifest(manifestJson, packStorageConfig.manifestEncoding);
  const blobPayload = useBase64 ? blob.toString('base64') : encodeBase91(blob);
  const PACK_CHUNK_SIZE = 256 * 1024;
  const blobChunks = chunkString(blobPayload, PACK_CHUNK_SIZE);
  return {
    packStorageConfig,
    manifestPayload,
    blobChunks,
  };
}

function buildPlayableHtml(channel, packDataMarkup, useBase64, blobCompression, manifestEncoding, buildScreenConfig, projectOrientation, titleSeed) {
  let html = fs.readFileSync(path.join(BUILD_DIR, 'index.html'), 'utf8');
  const packedBootstrap = makePackBootstrapScript(useBase64, blobCompression, manifestEncoding);
  const startScript = makeSystemImportStartScript(channel);
  const runtimeCompatScript = makeChannelRuntimeCompatScript(channel);
  const runtimeCompatTag = runtimeCompatScript
    ? `<script>${escapeInlineScript(runtimeCompatScript)}</script>`
    : '';
  const bootOverlayMarkup = makeFacebookBootOverlayMarkup(channel);
  const channelSDK = channelSDKs[channel] || '';

  html = addFaviconIfMissing(html);
  html = addPackBaseHrefIfNeeded(html, channel);
  html = inlineStyleIfPresent(html);
  html = inlineScriptSrcAsset(html, 'src/polyfills.bundle.js', channel);
  html = inlineScriptSrcAsset(html, 'src/system.bundle.js', channel);
  html = inlineImportMapAsset(html, 'src/import-map.json', channel);
  if (bootOverlayMarkup) {
    html = html.replace(/<body>/i, `<body>\n${bootOverlayMarkup}`);
  }

  const injected =
`<script>window.__CHANNEL__=${JSON.stringify(channel)};window.__PLAYABLE_DESIGN_SIZE__=${JSON.stringify({ width: buildScreenConfig.width, height: buildScreenConfig.height })};window.__PLAYABLE_PROJECT_ORIENTATION__=${JSON.stringify(projectOrientation)};</script>
${channelSDK}
${runtimeCompatTag}
${packDataMarkup}
${packedBootstrap}
<script>${escapeInlineScript(makeVfsPatchScript(channel))}</script>
<script>${escapeInlineScript(BRIDGE_JS)}</script>
`;

  html = html.replace(
    /<script[^>]*>\s*System\.import\((['"])\.\/index\.js\1\)[\s\S]*?<\/script>/i,
    () => `${injected}\n${startScript}`
  );

  html = html.replace(/<title>.*?<\/title>/i, `<title>Playable-${channel}-${sha1(String(titleSeed || channel))}</title>`);

  return html;
}

function inlineHtml(channel, manifest, blob, useBase64, blobCompression, buildScreenConfig, projectOrientation) {
  const { packStorageConfig, manifestPayload, blobChunks } = createPackPayloadData(channel, manifest, blob, useBase64);
  const packDataMarkup = packStorageConfig.storageMode === 'inline-script'
    ? buildPackInlineDataScript(manifestPayload, blobChunks)
    : `${buildPackManifestTag(manifestPayload, packStorageConfig.nodeTagName)}\n${buildPackChunkTags(blobChunks, packStorageConfig.nodeTagName)}`;
  return buildPlayableHtml(
    channel,
    packDataMarkup,
    useBase64,
    blobCompression,
    packStorageConfig.manifestEncoding,
    buildScreenConfig,
    projectOrientation,
    `${channel}:${Object.keys(manifest).length}:inline`
  );
}

function writeExternalPackUploadBundle(bundleDir, channel, manifest, blob, useBase64, blobCompression, buildScreenConfig, projectOrientation) {
  const { packStorageConfig, manifestPayload, blobChunks } = createPackPayloadData(channel, manifest, blob, useBase64);
  const packDataMarkup = writeExternalPackDataScripts(bundleDir, manifestPayload, blobChunks);
  const html = buildPlayableHtml(
    channel,
    packDataMarkup,
    useBase64,
    blobCompression,
    packStorageConfig.manifestEncoding,
    buildScreenConfig,
    projectOrientation,
    `${channel}:${Object.keys(manifest).length}:bundle`
  );
  writeBundleFile(bundleDir, 'index.html', html);
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
  const facebookImageQuality = 60;
  const facebookImageFormat = IMAGE_FORMAT_SMART;
  const facebookImageMaxDimension = 1024;
  fs.mkdirSync(outDir, { recursive: true });

  const { manifest, blob, stats } = await buildBinaryPack(
    compressImages,
    imageQuality,
    imageFormat,
    imageMaxDimension
  );
  const facebookPack = CHANNELS.includes('facebook')
    ? await buildBinaryPack(
      compressImages,
      facebookImageQuality,
      facebookImageFormat,
      facebookImageMaxDimension,
      'facebook'
    )
    : null;
  const projectOrientation = inferProjectOrientation();
  const buildScreenConfig = readBuildScreenConfig();
  const blobPack = compressBlobForPayload(blob, requestedBlobCompression);
  const facebookBlobPack = facebookPack
    ? compressBlobForPayload(facebookPack.blob, requestedBlobCompression)
    : null;
  const writtenFiles = [];
  const writtenUploadBundles = [];
  const writtenUploadHtmlFiles = [];
  for (const ch of CHANNELS) {
    const packManifest = ch === 'facebook' && facebookPack ? facebookPack.manifest : manifest;
    const packBlob = ch === 'facebook' && facebookBlobPack ? facebookBlobPack.blob : blobPack.blob;
    const packBlobCompression = ch === 'facebook' && facebookBlobPack ? facebookBlobPack.compression : blobPack.compression;
    const out = inlineHtml(ch, packManifest, packBlob, useBase64, packBlobCompression, buildScreenConfig, projectOrientation);
    const outPath = path.join(outDir, `${ch}.html`);
    fs.writeFileSync(outPath, out, 'utf8');
    console.log('written:', outPath);
    writtenFiles.push(outPath);
    writtenUploadBundles.push(
      writeUploadBundle(outDir, ch, {
        html: out,
        orientation: projectOrientation,
        buildScreenConfig,
        projectOrientation,
        manifest: packManifest,
        blob: packBlob,
        useBase64,
        blobCompression: packBlobCompression,
      })
    );
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

  if (facebookPack) {
    console.log(
      `[pack-single-html] facebook image format=${facebookImageFormat} q=${facebookImageQuality} maxDim=${facebookImageMaxDimension} for opaque-origin compatibility`
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
