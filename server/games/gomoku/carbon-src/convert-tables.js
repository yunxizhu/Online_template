'use strict';

/**
 * Convert Carbon-Gomoku C++ table files (STATUS1/PRIOR3/CONFIG/COUNT5)
 * into JSON consumed by the JS port.
 *
 * Source: https://github.com/gomoku/Carbon-Gomoku
 */

const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const OUT = path.join(__dirname, '..', 'carbon-js', 'tables');

function extractArray(filePath, name) {
  const text = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp(
    `(?:const\\s+)?(?:char|signed\\s+char)\\s+${name}\\s*\\[[^\\]]*\\](?:\\[[^\\]]*\\])*\\s*=\\s*\\{([\\s\\S]*)\\}\\s*;`,
    'm'
  );
  const m = text.match(re);
  if (!m) throw new Error('array not found: ' + name + ' in ' + filePath);
  // Turn C initializer into JSON-ish by wrapping braces as arrays
  let body = m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  // Replace outermost commas between rows already braced
  body = body.trim();
  // Ensure every `{...}` becomes `[...]`
  let jsonish = '[' + body + ']';
  jsonish = jsonish.replace(/\{/g, '[').replace(/\}/g, ']');
  // Remove trailing commas
  jsonish = jsonish.replace(/,\s*]/g, ']');
  let data;
  try {
    data = JSON.parse(jsonish);
  } catch (e) {
    throw new Error('parse failed for ' + name + ': ' + e.message);
  }
  return data;
}

fs.mkdirSync(OUT, { recursive: true });

const tables = {
  STATUS1: extractArray(path.join(SRC, 'STATUS1.CPP'), 'STATUS1'),
  PRIOR: extractArray(path.join(SRC, 'PRIOR3.CPP'), '_PRIOR'),
  CONFIG: extractArray(path.join(SRC, 'CONFIG.CPP'), 'CONFIG'),
  COUNT5: extractArray(path.join(SRC, 'COUNT5.CPP'), 'COUNT5'),
};

for (const [k, v] of Object.entries(tables)) {
  const out = path.join(OUT, k + '.json');
  fs.writeFileSync(out, JSON.stringify(v));
  console.log('wrote', out, Array.isArray(v) ? v.length : typeof v);
}

console.log('OK');
