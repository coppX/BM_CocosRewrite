#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const parser = require('@babel/parser');

const OBF_NAME_RE = /^_0x[0-9a-f]+$/i;
const IDENTIFIER_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function literalToSource(value) {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'NaN';
    }
    if (value === Infinity) {
      return 'Infinity';
    }
    if (value === -Infinity) {
      return '-Infinity';
    }
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  return null;
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
    console: { log() {}, warn() {}, error() {} },
    Buffer,
    process,
    setInterval() {
      return 0;
    },
    clearInterval() {},
    setTimeout,
    clearTimeout,
    Editor: undefined,
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 4000, filename: absoluteInput });
  return sandbox;
}

function getFunctionBodyExpression(fnNode) {
  if (!fnNode) {
    return null;
  }

  if (fnNode.type === 'ArrowFunctionExpression' && fnNode.body.type !== 'BlockStatement') {
    return fnNode.body;
  }

  const bodyNode = fnNode.body;
  if (!bodyNode || bodyNode.type !== 'BlockStatement') {
    return null;
  }
  if (bodyNode.body.length !== 1) {
    return null;
  }

  const only = bodyNode.body[0];
  if (only.type !== 'ReturnStatement' || !only.argument) {
    return null;
  }
  return only.argument;
}

function readWrapperFromFunctionLike(fnNode) {
  const expression = getFunctionBodyExpression(fnNode);
  if (!expression || expression.type !== 'CallExpression' || expression.callee.type !== 'Identifier') {
    return null;
  }

  const params = [];
  for (const param of fnNode.params || []) {
    if (!param || param.type !== 'Identifier') {
      return null;
    }
    params.push(param.name);
  }

  return { params, expression };
}

function collectWrapperFunctions(ast) {
  const wrappers = new Map();

  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id && node.id.type === 'Identifier') {
      if (!OBF_NAME_RE.test(node.id.name)) {
        return;
      }
      const wrapper = readWrapperFromFunctionLike(node);
      if (wrapper) {
        wrappers.set(node.id.name, wrapper);
      }
      return;
    }

    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
      if (!OBF_NAME_RE.test(node.id.name)) {
        return;
      }
      if (node.init.type === 'FunctionExpression' || node.init.type === 'ArrowFunctionExpression') {
        const wrapper = readWrapperFromFunctionLike(node.init);
        if (wrapper) {
          wrappers.set(node.id.name, wrapper);
        }
      }
      return;
    }

    if (
      node.type === 'AssignmentExpression' &&
      node.left.type === 'Identifier' &&
      OBF_NAME_RE.test(node.left.name) &&
      (node.right.type === 'FunctionExpression' || node.right.type === 'ArrowFunctionExpression')
    ) {
      const wrapper = readWrapperFromFunctionLike(node.right);
      if (wrapper) {
        wrappers.set(node.left.name, wrapper);
      }
    }
  });

  return wrappers;
}

function evaluateObfNode(node, env, wrappers, runtime, depth = 0) {
  if (depth > 48) {
    throw new Error('depth');
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
      throw new Error('unbound');
    case 'ParenthesizedExpression':
      return evaluateObfNode(node.expression, env, wrappers, runtime, depth + 1);
    case 'UnaryExpression': {
      const value = evaluateObfNode(node.argument, env, wrappers, runtime, depth + 1);
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
          throw new Error('unary');
      }
    }
    case 'BinaryExpression': {
      const left = evaluateObfNode(node.left, env, wrappers, runtime, depth + 1);
      const right = evaluateObfNode(node.right, env, wrappers, runtime, depth + 1);
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
        case '==':
          return left == right;
        case '!=':
          return left != right;
        case '===':
          return left === right;
        case '!==':
          return left !== right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case '>':
          return left > right;
        case '>=':
          return left >= right;
        default:
          throw new Error('binary');
      }
    }
    case 'LogicalExpression': {
      const left = evaluateObfNode(node.left, env, wrappers, runtime, depth + 1);
      if (node.operator === '&&') {
        return left && evaluateObfNode(node.right, env, wrappers, runtime, depth + 1);
      }
      if (node.operator === '||') {
        return left || evaluateObfNode(node.right, env, wrappers, runtime, depth + 1);
      }
      if (node.operator === '??') {
        return left ?? evaluateObfNode(node.right, env, wrappers, runtime, depth + 1);
      }
      throw new Error('logical');
    }
    case 'ConditionalExpression':
      return evaluateObfNode(node.test, env, wrappers, runtime, depth + 1)
        ? evaluateObfNode(node.consequent, env, wrappers, runtime, depth + 1)
        : evaluateObfNode(node.alternate, env, wrappers, runtime, depth + 1);
    case 'SequenceExpression': {
      let last;
      for (const expression of node.expressions) {
        last = evaluateObfNode(expression, env, wrappers, runtime, depth + 1);
      }
      return last;
    }
    case 'CallExpression': {
      if (node.callee.type !== 'Identifier') {
        throw new Error('callee');
      }
      const calleeName = node.callee.name;
      if (!OBF_NAME_RE.test(calleeName)) {
        throw new Error('not-obf');
      }

      const args = node.arguments.map((arg) =>
        evaluateObfNode(arg, env, wrappers, runtime, depth + 1)
      );

      if (wrappers.has(calleeName)) {
        const wrapper = wrappers.get(calleeName);
        const subEnv = Object.create(null);
        for (let i = 0; i < wrapper.params.length; i += 1) {
          subEnv[wrapper.params[i]] = args[i];
        }
        return evaluateObfNode(wrapper.expression, subEnv, wrappers, runtime, depth + 1);
      }

      const runtimeFn = runtime[calleeName];
      if (typeof runtimeFn === 'function') {
        return runtimeFn(...args);
      }
      throw new Error('runtime-missing');
    }
    default:
      throw new Error('node-type');
  }
}

function foldObfuscationCallsRound(code, wrappers, runtime) {
  const ast = parseScript(code);
  const replacements = [];

  walk(ast, (node) => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') {
      return;
    }
    if (!OBF_NAME_RE.test(node.callee.name)) {
      return;
    }

    try {
      const value = evaluateObfNode(node, Object.create(null), wrappers, runtime);
      const replacement = literalToSource(value);
      if (replacement !== null) {
        replacements.push({ start: node.start, end: node.end, replacement });
      }
    } catch (_error) {
      // skip
    }
  });

  return { code: applyReplacements(code, replacements), count: replacements.length };
}

function foldObfuscationCallsIterative(code, wrappers, runtime, maxRounds = 8) {
  let output = code;
  let total = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const result = foldObfuscationCallsRound(output, wrappers, runtime);
    total += result.count;
    output = result.code;
    if (result.count === 0) {
      break;
    }
  }
  return { code: output, count: total };
}

function evaluatePureExpression(node, depth = 0) {
  if (!node || depth > 40) {
    return { ok: false };
  }

  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return { ok: true, value: node.value };
    case 'NullLiteral':
      return { ok: true, value: null };
    case 'Identifier':
      if (node.name === 'undefined') {
        return { ok: true, value: undefined };
      }
      if (node.name === 'NaN') {
        return { ok: true, value: NaN };
      }
      if (node.name === 'Infinity') {
        return { ok: true, value: Infinity };
      }
      return { ok: false };
    case 'ParenthesizedExpression':
      return evaluatePureExpression(node.expression, depth + 1);
    case 'UnaryExpression': {
      const arg = evaluatePureExpression(node.argument, depth + 1);
      if (!arg.ok) {
        return { ok: false };
      }
      switch (node.operator) {
        case '+':
          return { ok: true, value: +arg.value };
        case '-':
          return { ok: true, value: -arg.value };
        case '!':
          return { ok: true, value: !arg.value };
        case '~':
          return { ok: true, value: ~arg.value };
        case 'void':
          return { ok: true, value: void arg.value };
        default:
          return { ok: false };
      }
    }
    case 'BinaryExpression': {
      const left = evaluatePureExpression(node.left, depth + 1);
      const right = evaluatePureExpression(node.right, depth + 1);
      if (!left.ok || !right.ok) {
        return { ok: false };
      }

      switch (node.operator) {
        case '+':
          return { ok: true, value: left.value + right.value };
        case '-':
          return { ok: true, value: left.value - right.value };
        case '*':
          return { ok: true, value: left.value * right.value };
        case '/':
          return { ok: true, value: left.value / right.value };
        case '%':
          return { ok: true, value: left.value % right.value };
        case '**':
          return { ok: true, value: left.value ** right.value };
        case '<<':
          return { ok: true, value: left.value << right.value };
        case '>>':
          return { ok: true, value: left.value >> right.value };
        case '>>>':
          return { ok: true, value: left.value >>> right.value };
        case '&':
          return { ok: true, value: left.value & right.value };
        case '|':
          return { ok: true, value: left.value | right.value };
        case '^':
          return { ok: true, value: left.value ^ right.value };
        case '==':
          return { ok: true, value: left.value == right.value };
        case '!=':
          return { ok: true, value: left.value != right.value };
        case '===':
          return { ok: true, value: left.value === right.value };
        case '!==':
          return { ok: true, value: left.value !== right.value };
        case '<':
          return { ok: true, value: left.value < right.value };
        case '<=':
          return { ok: true, value: left.value <= right.value };
        case '>':
          return { ok: true, value: left.value > right.value };
        case '>=':
          return { ok: true, value: left.value >= right.value };
        default:
          return { ok: false };
      }
    }
    case 'LogicalExpression': {
      const left = evaluatePureExpression(node.left, depth + 1);
      if (!left.ok) {
        return { ok: false };
      }

      if (node.operator === '&&') {
        if (!left.value) {
          return { ok: true, value: left.value };
        }
        return evaluatePureExpression(node.right, depth + 1);
      }
      if (node.operator === '||') {
        if (left.value) {
          return { ok: true, value: left.value };
        }
        return evaluatePureExpression(node.right, depth + 1);
      }
      if (node.operator === '??') {
        if (left.value !== null && left.value !== undefined) {
          return { ok: true, value: left.value };
        }
        return evaluatePureExpression(node.right, depth + 1);
      }
      return { ok: false };
    }
    case 'ConditionalExpression': {
      const test = evaluatePureExpression(node.test, depth + 1);
      if (!test.ok) {
        return { ok: false };
      }
      return test.value
        ? evaluatePureExpression(node.consequent, depth + 1)
        : evaluatePureExpression(node.alternate, depth + 1);
    }
    case 'SequenceExpression': {
      if (node.expressions.length === 0) {
        return { ok: false };
      }
      let last;
      for (const expression of node.expressions) {
        const result = evaluatePureExpression(expression, depth + 1);
        if (!result.ok) {
          return { ok: false };
        }
        last = result.value;
      }
      return { ok: true, value: last };
    }
    case 'TemplateLiteral': {
      let text = '';
      for (let i = 0; i < node.quasis.length; i += 1) {
        text += node.quasis[i].value.cooked;
        if (i < node.expressions.length) {
          const expression = evaluatePureExpression(node.expressions[i], depth + 1);
          if (!expression.ok) {
            return { ok: false };
          }
          text += String(expression.value);
        }
      }
      return { ok: true, value: text };
    }
    default:
      return { ok: false };
  }
}

function foldPureExpressionsRound(code) {
  const ast = parseScript(code);
  const replacements = [];

  walk(ast, (node) => {
    if (!node || !node.type || !node.type.endsWith('Expression')) {
      return;
    }

    if (
      node.type === 'Identifier' ||
      node.type === 'StringLiteral' ||
      node.type === 'NumericLiteral' ||
      node.type === 'BooleanLiteral' ||
      node.type === 'NullLiteral'
    ) {
      return;
    }

    const result = evaluatePureExpression(node);
    if (!result.ok) {
      return;
    }

    const replacement = literalToSource(result.value);
    if (!replacement) {
      return;
    }

    const original = code.slice(node.start, node.end);
    if (original === replacement) {
      return;
    }

    replacements.push({ start: node.start, end: node.end, replacement });
  });

  return { code: applyReplacements(code, replacements), count: replacements.length };
}

function foldPureExpressionsIterative(code, maxRounds = 6) {
  let output = code;
  let total = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    const result = foldPureExpressionsRound(output);
    total += result.count;
    output = result.code;
    if (result.count === 0) {
      break;
    }
  }

  return { code: output, count: total };
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
      replacements.push({ start: node.start, end: node.end, replacement });
    }
  });

  return { code: applyReplacements(code, replacements), count: replacements.length };
}

function objectNeedsParensForDot(type) {
  return !(
    type === 'Identifier' ||
    type === 'ThisExpression' ||
    type === 'Super' ||
    type === 'MetaProperty' ||
    type === 'MemberExpression' ||
    type === 'CallExpression' ||
    type === 'OptionalMemberExpression' ||
    type === 'OptionalCallExpression' ||
    type === 'NewExpression'
  );
}

function simplifyMemberAccessRound(code) {
  const ast = parseScript(code);
  const replacements = [];

  walk(ast, (node) => {
    if (node.type !== 'MemberExpression' || !node.computed || !node.property) {
      return;
    }
    if (node.property.type !== 'StringLiteral') {
      return;
    }

    const propertyName = node.property.value;
    if (!IDENTIFIER_NAME_RE.test(propertyName)) {
      return;
    }

    const objectTextRaw = code.slice(node.object.start, node.object.end);
    const objectText = objectNeedsParensForDot(node.object.type)
      ? `(${objectTextRaw})`
      : objectTextRaw;

    const operator = node.optional ? '?.' : '.';
    const replacement = `${objectText}${operator}${propertyName}`;
    replacements.push({ start: node.start, end: node.end, replacement });
  });

  return { code: applyReplacements(code, replacements), count: replacements.length };
}

function simplifyMemberAccessIterative(code, maxRounds = 4) {
  let output = code;
  let total = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const result = simplifyMemberAccessRound(output);
    total += result.count;
    output = result.code;
    if (result.count === 0) {
      break;
    }
  }
  return { code: output, count: total };
}

function simplifyComputedMethodNames(code) {
  let output = code;
  output = output.replace(/\bget\["([A-Za-z_$][A-Za-z0-9_$]*)"\]\s*\(/g, 'get $1(');
  output = output.replace(/\bset\["([A-Za-z_$][A-Za-z0-9_$]*)"\]\s*\(/g, 'set $1(');
  output = output.replace(/\basync\["([A-Za-z_$][A-Za-z0-9_$]*)"\]\s*\(/g, 'async $1(');
  output = output.replace(/(^|\s)\["([A-Za-z_$][A-Za-z0-9_$]*)"\]\s*\(/gm, '$1$2(');
  output = output.replace(
    /(?<![A-Za-z0-9_$\.])\["([A-Za-z_$][A-Za-z0-9_$]*)"\]\s*\(/g,
    '$1('
  );
  return output;
}

function extractRequiredModule(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }

  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    node.arguments.length > 0 &&
    node.arguments[0].type === 'StringLiteral'
  ) {
    return node.arguments[0].value;
  }

  if (node.type === 'CallExpression') {
    for (const arg of node.arguments) {
      const found = extractRequiredModule(arg);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function buildIdentifierRenameMap(code) {
  const ast = parseScript(code);
  const allObfNames = new Set();
  const declarationKind = new Map();
  const usedNames = new Set();
  const map = new Map();

  walk(ast, (node, parent) => {
    if (node.type === 'Identifier') {
      const isNonBindingPropertyName =
        (parent &&
          parent.type === 'MemberExpression' &&
          parent.property === node &&
          !parent.computed) ||
        (parent &&
          (parent.type === 'ObjectProperty' ||
            parent.type === 'ObjectMethod' ||
            parent.type === 'ClassMethod' ||
            parent.type === 'ClassProperty') &&
          parent.key === node &&
          !parent.computed);

      if (!isNonBindingPropertyName) {
        usedNames.add(node.name);
      }

      if (OBF_NAME_RE.test(node.name)) {
        allObfNames.add(node.name);
      }
    }

    if (node.type === 'FunctionDeclaration' && node.id && OBF_NAME_RE.test(node.id.name)) {
      declarationKind.set(node.id.name, 'function');
      const snippet = code.slice(node.start, node.end);
      if (snippet.includes('.cocos-mcp') && snippet.includes('cocos-mcp-license.json')) {
        map.set(node.id.name, 'getLicenseFilePath');
      }
      return;
    }

    if (node.type === 'ClassDeclaration' && node.id && OBF_NAME_RE.test(node.id.name)) {
      declarationKind.set(node.id.name, 'class');
      return;
    }

    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      if (OBF_NAME_RE.test(node.id.name)) {
        declarationKind.set(node.id.name, 'variable');
        const moduleName = extractRequiredModule(node.init);
        if (moduleName) {
          if (moduleName === 'crypto') {
            map.set(node.id.name, 'crypto');
          } else if (moduleName === 'path') {
            map.set(node.id.name, 'pathUtil');
          } else if (moduleName === 'fs') {
            map.set(node.id.name, 'fsUtil');
          } else if (moduleName === './server-config') {
            map.set(node.id.name, 'serverConfig');
          } else if (moduleName === './device-identity') {
            map.set(node.id.name, 'deviceIdentity');
          }
        }
      }
      return;
    }

    if (node.type === 'CatchClause' && node.param && node.param.type === 'Identifier') {
      if (OBF_NAME_RE.test(node.param.name)) {
        declarationKind.set(node.param.name, 'catch');
      }
      return;
    }

    if ((node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && node.params) {
      for (const param of node.params) {
        if (param && param.type === 'Identifier' && OBF_NAME_RE.test(param.name)) {
          if (!declarationKind.has(param.name)) {
            declarationKind.set(param.name, 'param');
          }
        }
      }
    }

    if (
      node.type === 'AssignmentExpression' &&
      node.left.type === 'MemberExpression' &&
      node.right.type === 'Identifier' &&
      OBF_NAME_RE.test(node.right.name)
    ) {
      if (
        node.left.object.type === 'Identifier' &&
        node.left.object.name === 'exports' &&
        ((node.left.computed &&
          node.left.property.type === 'StringLiteral' &&
          node.left.property.value === 'LicenseManager') ||
          (!node.left.computed &&
            node.left.property.type === 'Identifier' &&
            node.left.property.name === 'LicenseManager'))
      ) {
        map.set(node.right.name, 'LicenseManager');
      }
    }

    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.object.type === 'Identifier' &&
      node.callee.object.name === 'Object' &&
      node.arguments.length >= 2 &&
      node.arguments[0].type === 'Identifier' &&
      node.arguments[0].name === 'exports' &&
      node.arguments[1].type === 'StringLiteral' &&
      node.arguments[1].value === '__esModule'
    ) {
      if (
        parent &&
        parent.type === 'ExpressionStatement' &&
        parent.expression.type === 'SequenceExpression'
      ) {
        for (const seqExpr of parent.expression.expressions) {
          if (
            seqExpr.type === 'AssignmentExpression' &&
            seqExpr.left.type === 'MemberExpression' &&
            seqExpr.right.type === 'Identifier' &&
            OBF_NAME_RE.test(seqExpr.right.name)
          ) {
            if (
              seqExpr.left.object.type === 'Identifier' &&
              seqExpr.left.object.name === 'exports'
            ) {
              const exportName =
                seqExpr.left.computed && seqExpr.left.property.type === 'StringLiteral'
                  ? seqExpr.left.property.value
                  : !seqExpr.left.computed && seqExpr.left.property.type === 'Identifier'
                    ? seqExpr.left.property.name
                    : '';
              if (exportName === 'LicenseManager') {
                map.set(seqExpr.right.name, 'LicenseManager');
              }
            }
          }
        }
      }
    }
  });

  function makeUnique(base) {
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    let index = 2;
    while (usedNames.has(`${base}${index}`)) {
      index += 1;
    }
    const resolved = `${base}${index}`;
    usedNames.add(resolved);
    return resolved;
  }

  const counters = {
    function: 0,
    class: 0,
    variable: 0,
    param: 0,
    catch: 0,
    symbol: 0,
  };

  const names = Array.from(allObfNames).sort();
  for (const name of names) {
    if (map.has(name)) {
      const preferred = map.get(name);
      const unique = preferred === 'LicenseManager' ? preferred : makeUnique(preferred);
      usedNames.add(unique);
      map.set(name, unique);
      continue;
    }

    const kind = declarationKind.get(name) || 'symbol';
    counters[kind] = (counters[kind] || 0) + 1;

    let base;
    if (kind === 'function') {
      base = `fn${counters[kind]}`;
    } else if (kind === 'class') {
      base = `Class${counters[kind]}`;
    } else if (kind === 'variable') {
      base = `var${counters[kind]}`;
    } else if (kind === 'param') {
      base = `arg${counters[kind]}`;
    } else if (kind === 'catch') {
      base = `error${counters[kind]}`;
    } else {
      base = `sym${counters.symbol}`;
    }

    map.set(name, makeUnique(base));
  }

  return map;
}

function applyIdentifierRenameMap(code, renameMap) {
  let output = code;
  const entries = Array.from(renameMap.entries()).sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    if (from === to) {
      continue;
    }
    const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g');
    output = output.replace(re, to);
  }
  return output;
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
  const initialAst = parseScript(source);
  const wrappers = collectWrapperFunctions(initialAst);
  const runtime = createRuntimeContext(inputFile, source);

  let current = source;

  const foldedObf = foldObfuscationCallsIterative(current, wrappers, runtime);
  current = foldedObf.code;

  const foldedPure = foldPureExpressionsIterative(current);
  current = foldedPure.code;

  const simplifiedMembers = simplifyMemberAccessIterative(current);
  current = simplifiedMembers.code;

  const normalizedOnce = normalizeStringLiterals(current);
  current = normalizedOnce.code;

  const renameMap = buildIdentifierRenameMap(current);
  current = applyIdentifierRenameMap(current, renameMap);

  const foldedPureAgain = foldPureExpressionsIterative(current);
  current = foldedPureAgain.code;

  const simplifiedMembersAgain = simplifyMemberAccessIterative(current);
  current = simplifiedMembersAgain.code;

  const normalizedTwice = normalizeStringLiterals(current);
  current = normalizedTwice.code;

  current = simplifyComputedMethodNames(current);

  const finalCode = noFormat ? current : formatCode(current);

  parseScript(finalCode);

  fs.writeFileSync(outputFile, finalCode, 'utf8');

  console.log(`[deobfuscate] input: ${inputFile}`);
  console.log(`[deobfuscate] output: ${outputFile}`);
  console.log(`[deobfuscate] wrappers: ${wrappers.size}`);
  console.log(`[deobfuscate] obf folds: ${foldedObf.count}`);
  console.log(`[deobfuscate] pure folds: ${foldedPure.count + foldedPureAgain.count}`);
  console.log(
    `[deobfuscate] member simplifications: ${simplifiedMembers.count + simplifiedMembersAgain.count}`
  );
  console.log(`[deobfuscate] normalized strings: ${normalizedOnce.count + normalizedTwice.count}`);
  console.log(`[deobfuscate] renamed obf identifiers: ${renameMap.size}`);
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
