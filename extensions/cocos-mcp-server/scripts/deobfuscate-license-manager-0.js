#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const parser = require('@babel/parser');

const OBF_NAME_RE = /^_0x[0-9a-f]+$/i;

function parseScript(code) {
  return parser.parse(code, {
    sourceType: 'script',
    ranges: true,
    errorRecovery: false,
  });
}

function walk(node, visitor, parent = null) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visitor, parent);
    }
    return;
  }

  visitor(node, parent);

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') {
      continue;
    }
    walk(node[key], visitor, node);
  }
}

function applyReplacements(source, replacements) {
  if (replacements.length === 0) {
    return source;
  }

  const selected = [];
  const sorted = replacements
    .slice()
    .sort((a, b) => (a.start === b.start ? b.end - a.end : a.start - b.start));

  let coveredUntil = -1;
  for (const item of sorted) {
    if (item.start < coveredUntil) {
      continue;
    }
    selected.push(item);
    coveredUntil = item.end;
  }

  selected.sort((a, b) => b.start - a.start);
  let output = source;
  for (const item of selected) {
    output = output.slice(0, item.start) + item.replacement + output.slice(item.end);
  }

  return output;
}

function createRuntimeContext(inputFile, code) {
  const absoluteInput = path.resolve(inputFile);
  const localRequire = createRequire(absoluteInput);

  const sandbox = {
    exports: {},
    module: { exports: {} },
    require(specifier) {
      try {
        return localRequire(specifier);
      } catch (_error) {
        return {};
      }
    },
    __filename: absoluteInput,
    __dirname: path.dirname(absoluteInput),
    console: { log() { }, warn() { }, error() { } },
    Buffer,
    process,
    setInterval() {
      return 0;
    },
    clearInterval() { },
    setTimeout,
    clearTimeout,
    Editor: undefined,
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 4000, filename: absoluteInput });
  return sandbox;
}

function collectWrapperFunctions(ast) {
  const wrappers = new Map();

  walk(ast, (node) => {
    if (
      node.type !== 'FunctionDeclaration' ||
      !node.id ||
      node.id.type !== 'Identifier' ||
      !OBF_NAME_RE.test(node.id.name)
    ) {
      return;
    }

    const body = node.body && node.body.body ? node.body.body : [];
    if (
      body.length !== 1 ||
      body[0].type !== 'ReturnStatement' ||
      !body[0].argument ||
      body[0].argument.type !== 'CallExpression' ||
      body[0].argument.callee.type !== 'Identifier'
    ) {
      return;
    }

    const params = [];
    for (const param of node.params) {
      if (param.type !== 'Identifier') {
        return;
      }
      params.push(param.name);
    }

    wrappers.set(node.id.name, {
      params,
      expression: body[0].argument,
    });
  });

  return wrappers;
}

function evaluateNode(node, env, wrappers, runtime, depth = 0) {
  if (depth > 40) {
    throw new Error('Evaluation depth limit reached');
  }

  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'NullLiteral':
      return null;
    case 'Identifier':
      if (Object.prototype.hasOwnProperty.call(env, node.name)) {
        return env[node.name];
      }
      throw new Error(`Unbound identifier: ${node.name}`);
    case 'ParenthesizedExpression':
      return evaluateNode(node.expression, env, wrappers, runtime, depth + 1);
    case 'UnaryExpression': {
      const value = evaluateNode(node.argument, env, wrappers, runtime, depth + 1);
      switch (node.operator) {
        case '+':
          return +value;
        case '-':
          return -value;
        case '!':
          return !value;
        case '~':
          return ~value;
        case 'void':
          return void value;
        default:
          throw new Error(`Unsupported unary operator: ${node.operator}`);
      }
    }
    case 'BinaryExpression': {
      const left = evaluateNode(node.left, env, wrappers, runtime, depth + 1);
      const right = evaluateNode(node.right, env, wrappers, runtime, depth + 1);
      switch (node.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '%':
          return left % right;
        case '**':
          return left ** right;
        case '<<':
          return left << right;
        case '>>':
          return left >> right;
        case '>>>':
          return left >>> right;
        case '&':
          return left & right;
        case '|':
          return left | right;
        case '^':
          return left ^ right;
        default:
          throw new Error(`Unsupported binary operator: ${node.operator}`);
      }
    }
    case 'LogicalExpression': {
      const left = evaluateNode(node.left, env, wrappers, runtime, depth + 1);
      if (node.operator === '&&') {
        return left && evaluateNode(node.right, env, wrappers, runtime, depth + 1);
      }
      if (node.operator === '||') {
        return left || evaluateNode(node.right, env, wrappers, runtime, depth + 1);
      }
      if (node.operator === '??') {
        return left ?? evaluateNode(node.right, env, wrappers, runtime, depth + 1);
      }
      throw new Error(`Unsupported logical operator: ${node.operator}`);
    }
    case 'ConditionalExpression':
      return evaluateNode(node.test, env, wrappers, runtime, depth + 1)
        ? evaluateNode(node.consequent, env, wrappers, runtime, depth + 1)
        : evaluateNode(node.alternate, env, wrappers, runtime, depth + 1);
    case 'CallExpression': {
      if (node.callee.type !== 'Identifier') {
        throw new Error('Only identifier callees are supported');
      }

      const calleeName = node.callee.name;
      if (!OBF_NAME_RE.test(calleeName)) {
        throw new Error(`Not an obfuscation helper: ${calleeName}`);
      }

      const args = node.arguments.map((arg) =>
        evaluateNode(arg, env, wrappers, runtime, depth + 1)
      );

      if (wrappers.has(calleeName)) {
        const wrapper = wrappers.get(calleeName);
        const subEnv = Object.create(null);
        for (let i = 0; i < wrapper.params.length; i += 1) {
          subEnv[wrapper.params[i]] = args[i];
        }
        return evaluateNode(wrapper.expression, subEnv, wrappers, runtime, depth + 1);
      }

      const runtimeFn = runtime[calleeName];
      if (typeof runtimeFn === 'function') {
        return runtimeFn(...args);
      }

      throw new Error(`No runtime helper found: ${calleeName}`);
    }
    default:
      throw new Error(`Unsupported node type: ${node.type}`);
  }
}

function foldObfuscationCalls(code, wrappers, runtime) {
  const ast = parseScript(code);
  const replacements = [];

  walk(ast, (node) => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') {
      return;
    }

    try {
      const value = evaluateNode(node, Object.create(null), wrappers, runtime);
      if (typeof value === 'string') {
        replacements.push({
          start: node.start,
          end: node.end,
          replacement: JSON.stringify(value),
        });
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        replacements.push({
          start: node.start,
          end: node.end,
          replacement: String(value),
        });
      } else if (typeof value === 'boolean') {
        replacements.push({
          start: node.start,
          end: node.end,
          replacement: value ? 'true' : 'false',
        });
      } else if (value === null) {
        replacements.push({
          start: node.start,
          end: node.end,
          replacement: 'null',
        });
      }
    } catch (_error) {
      // Skip expressions that are not statically evaluable.
    }
  });

  return { code: applyReplacements(code, replacements), count: replacements.length };
}

function normalizeStringLiterals(code) {
  const ast = parseScript(code);
  const replacements = [];

  walk(ast, (node) => {
    if (node.type !== 'StringLiteral') {
      return;
    }

    const replacement = JSON.stringify(node.value);
    const original = code.slice(node.start, node.end);
    if (replacement !== original) {
      replacements.push({
        start: node.start,
        end: node.end,
        replacement,
      });
    }
  });

  return { code: applyReplacements(code, replacements), count: replacements.length };
}

function formatCode(source) {
  const indentUnit = '  ';
  let output = '';
  let indent = 0;
  let parenDepth = 0;

  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  function trimRightBuffer() {
    let i = output.length - 1;
    while (i >= 0 && (output[i] === ' ' || output[i] === '\t')) {
      i -= 1;
    }
    output = output.slice(0, i + 1);
  }

  function newIndentedLine() {
    trimRightBuffer();
    if (!output.endsWith('\n')) {
      output += '\n';
    }
    output += indentUnit.repeat(indent);
  }

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      output += ch;
      if (ch === '\n') {
        inLineComment = false;
        output += indentUnit.repeat(indent);
      }
      continue;
    }

    if (inBlockComment) {
      output += ch;
      if (ch === '*' && next === '/') {
        output += '/';
        i += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingle || inDouble || inTemplate) {
      output += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (inSingle && ch === '\'') {
        inSingle = false;
      } else if (inDouble && ch === '"') {
        inDouble = false;
      } else if (inTemplate && ch === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      output += '//';
      i += 1;
      inLineComment = true;
      continue;
    }

    if (ch === '/' && next === '*') {
      output += '/*';
      i += 1;
      inBlockComment = true;
      continue;
    }

    if (ch === '\'') {
      inSingle = true;
      output += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      output += ch;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      output += ch;
      continue;
    }

    if (ch === '(') {
      parenDepth += 1;
      output += ch;
      continue;
    }

    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      output += ch;
      continue;
    }

    if (ch === '{') {
      output += '{';
      indent += 1;
      newIndentedLine();
      continue;
    }

    if (ch === '}') {
      indent = Math.max(0, indent - 1);
      trimRightBuffer();
      if (!output.endsWith('\n')) {
        output += '\n';
      }
      output += indentUnit.repeat(indent) + '}';
      if (
        next &&
        next !== ';' &&
        next !== ',' &&
        next !== ')' &&
        next !== ']' &&
        next !== '}' &&
        next !== ':'
      ) {
        newIndentedLine();
      }
      continue;
    }

    if (ch === ';' && parenDepth === 0) {
      output += ';';
      newIndentedLine();
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      continue;
    }

    output += ch;
  }

  return output.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function buildOutputPath(inputFile, explicitOutput) {
  if (explicitOutput) {
    return explicitOutput;
  }
  const parsed = path.parse(inputFile);
  return path.join(parsed.dir, `${parsed.name}.deobf${parsed.ext || '.js'}`);
}

function main() {
  const args = process.argv.slice(2);
  const noFormat = args.includes('--no-format');
  const positional = args.filter((arg) => arg !== '--no-format');

  const inputFile = positional[0] || path.join('dist', 'auth', 'license-manager.js');
  const outputFile = buildOutputPath(inputFile, positional[1]);

  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  const source = fs.readFileSync(inputFile, 'utf8');
  const ast = parseScript(source);
  const wrappers = collectWrapperFunctions(ast);
  const runtime = createRuntimeContext(inputFile, source);

  const folded = foldObfuscationCalls(source, wrappers, runtime);
  const normalized = normalizeStringLiterals(folded.code);
  const finalCode = noFormat ? normalized.code : formatCode(normalized.code);

  // Parse once more to ensure generated output is valid JavaScript.
  parseScript(finalCode);

  fs.writeFileSync(outputFile, finalCode, 'utf8');

  console.log(`[deobfuscate] input: ${inputFile}`);
  console.log(`[deobfuscate] output: ${outputFile}`);
  console.log(`[deobfuscate] wrapper functions: ${wrappers.size}`);
  console.log(`[deobfuscate] folded calls: ${folded.count}`);
  console.log(`[deobfuscate] normalized strings: ${normalized.count}`);
  console.log(`[deobfuscate] formatted: ${noFormat ? 'no' : 'yes'}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[deobfuscate] failed: ${error.message}`);
    process.exit(1);
  }
}
