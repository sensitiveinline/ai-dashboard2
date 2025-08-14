const fs = require('fs');
const path = require('path');

const TS = Date.now().toString();
const IGNORE = new Set(['node_modules','.git','.next','dist','build']);

function walk(dir, out=[]) {
  for (const name of fs.readdirSync(dir)) {
    if (IGNORE.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function ensureFile(p, content) {
  if (!fs.existsSync(p)) fs.writeFileSync(p, content);
}

function patchAppJS(file) {
  let s = fs.readFileSync(file, 'utf8');
  let changed = false;

  // helper 주입
  if (!/function toArray\(/.test(s)) {
    s =
`// ---- safety helpers ----
function toArray(v){ if(Array.isArray(v))return v; if(v&&Array.isArray(v.items))return v.items; if(v&&typeof v==="object") return Object.values(v); return []; }
const normalizeItems = toArray;
` + s;
    changed = true;
  }

  // public/data -> data
  const before = s;
  s = s.replace(/public\/data\//g, 'data/');
  if (s !== before) changed = true;

  // DATA 상수 교정 (없으면 BASE 바로 아래 주입)
  if (!/const\s+DATA\s*=/.test(s)) {
    s = s.replace(/(const\s+BASE\s*=\s*[^;]+;)/, `$1\nconst DATA = \`\${BASE}data/\`;\n`);
    changed = true;
  } else {
    const s2 = s.replace(/const\s+DATA\s*=\s*`[^`]*`;/g, 'const DATA = `${BASE}data/`;');
    if (s2 !== s) { s = s2; changed = true; }
  }

  // renderPlatforms 진입 가드(2가지 선언 형태)
  s = s.replace(
    /(function\s+renderPlatforms\s*\(\s*prev\s*,\s*now\s*\)\s*\{\s*)(?![\s\S]*?toArray\(prev\))/,
    `$1  prev = toArray(prev);\n  now  = toArray(now);\n`
  );
  s = s.replace(
    /(renderPlatforms\s*=\s*\(\s*prev\s*,\s*now\s*\)\s*=>\s*\{\s*)(?![\s\S]*?toArray\(prev\))/,
    `$1  prev = toArray(prev);\n  now  = toArray(now);\n`
  );

  // 직접 .map 보호 + normalizeItems 통일
  ['platformsPrev','platformsNow'].forEach(k=>{
    const re = new RegExp(`\\b${k}\\.map`, 'g');
    s = s.replace(re, `toArray(${k}).map`);
  });
  s = s.replace(/\bnormalizeItems\(/g, 'toArray(');

  if (changed || s !== before) {
    fs.writeFileSync(file, s);
    return true;
  }
  return false;
}

function cacheBustIndex(file) {
  let s = fs.readFileSync(file, 'utf8');
  const s2 = s.replace(/src="app\.js[^"]*"/g, `src="app.js?v=${TS}"`);
  if (s2 !== s) { fs.writeFileSync(file, s2); return true; }
  return false;
}

function ensureData(dir) {
  const d = path.join(dir, 'data');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  ensureFile(path.join(d,'platform_rankings.json'),      '[{"id":"openai","score":97}]\n');
  ensureFile(path.join(d,'platform_rankings.prev.json'), '[{"id":"openai","score":98}]\n');
  ensureFile(path.join(d,'news_snapshots.json'), '[]\n');
  ensureFile(path.join(d,'gh_repos.json'),       '[]\n');
  ensureFile(path.join(d,'ai_note.json'),        '[]\n');
}

const root = process.cwd();
const files = walk(root);

const appCandidates = files.filter(p=>/(^|\/)app\.js$/.test(p));
const indexCandidates = files.filter(p=>/(^|\/)index\.html$/.test(p));

let touched = [];
for (const f of appCandidates) if (patchAppJS(f)) touched.push(f);

let busted = [];
for (const f of indexCandidates) if (cacheBustIndex(f)) busted.push(f);

// 루트와 /docs 모두에 data 보장
ensureData(root);
if (fs.existsSync(path.join(root,'docs'))) ensureData(path.join(root,'docs'));

console.log('[auto-fix] patched:', touched);
console.log('[auto-fix] cache-busted:', busted);
console.log('[auto-fix] TS:', TS);
