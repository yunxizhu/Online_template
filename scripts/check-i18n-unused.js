const fs = require('fs');
const path = require('path');

function flatten(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (/\.(js|html|ts|tsx|vue|css|md)$/.test(ent.name)) files.push(p);
  }
  return files;
}

function readFileSafe(f) {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
}

function deleteKey(obj, dotted) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return false;
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (!cur || !Object.prototype.hasOwnProperty.call(cur, last)) return false;
  delete cur[last];
  let node = obj;
  const stack = [];
  for (let i = 0; i < parts.length - 1; i++) {
    stack.push([node, parts[i]]);
    node = node[parts[i]];
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, name] = stack[i];
    const child = parent[name];
    if (
      child &&
      typeof child === 'object' &&
      !Array.isArray(child) &&
      Object.keys(child).length === 0
    ) {
      delete parent[name];
    }
  }
  return true;
}

const DYNAMIC_PREFIXES = ['lasidao.phase.', 'lasidao.func.', 'games.', 'games.modes.'];

function extractAttrKeys(content) {
  const keys = new Set();
  const re = /data-i18n-attr=(?:"([^"]+)"|'([^']+)')/g;
  let m;
  while ((m = re.exec(content))) {
    const raw = m[1] || m[2] || '';
    for (const part of raw.split(',')) {
      const idx = part.indexOf(':');
      if (idx > 0) keys.add(part.slice(idx + 1).trim());
    }
  }
  return keys;
}

function keyReferenced(key, blob, attrKeys) {
  if (attrKeys.has(key)) return true;
  if (
    blob.includes("'" + key + "'") ||
    blob.includes('"' + key + '"') ||
    blob.includes('data-i18n="' + key + '"') ||
    blob.includes("data-i18n='" + key + "'") ||
    blob.includes('data-i18n-html="' + key + '"') ||
    blob.includes("data-i18n-html='" + key + "'")
  ) {
    return true;
  }
  for (const prefix of DYNAMIC_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

const root = process.cwd();
const zhPath = path.join(root, 'public/i18n/zh.json');
const enPath = path.join(root, 'public/i18n/en.json');
const mobileZhPath = path.join(root, 'mobile/www/i18n/zh.json');
const mobileEnPath = path.join(root, 'mobile/www/i18n/en.json');

const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
const keys = flatten(zh).sort();

const searchFiles = walk(root).filter(
  (f) =>
    !f.includes(path.sep + 'i18n' + path.sep) &&
    !f.endsWith('check-i18n-unused.js')
);

let blob = '';
const attrKeys = new Set();
for (const f of searchFiles) {
  const c = readFileSafe(f);
  blob += '\n' + c;
  for (const k of extractAttrKeys(c)) attrKeys.add(k);
}

const unused = keys.filter((key) => !keyReferenced(key, blob, attrKeys));

console.log('Total keys:', keys.length);
console.log('Unused:', unused.length);
unused.forEach((k) => console.log(k));

if (process.argv.includes('--delete')) {
  const targets = [zhPath, enPath, mobileZhPath, mobileEnPath];
  for (const file of targets) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    let removed = 0;
    for (const key of unused) {
      if (deleteKey(data, key)) removed++;
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('Updated', path.relative(root, file), 'removed', removed);
  }
}
