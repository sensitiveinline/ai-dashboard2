const fs = require('fs');
const F = 'app.js';
let s = fs.readFileSync(F, 'utf8');

// 1) 전역 헬퍼 주입 (없으면)
if (!/function toArray\(/.test(s)) {
  const helper =
`// ---- safety helpers ----
function toArray(v){
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.items)) return v.items;
  if (v && typeof v === 'object') return Object.values(v);
  return [];
}
const normalizeItems = toArray; // 호환
`;
  s = helper + s;
}

// 2) DATA 경로를 /data/ 로 고정
s = s.replace(/const\s+DATA\s*=\s*`[^`]*`;/, 'const DATA = `${BASE}data/`;');

// 3) renderPlatforms 시작부 가드 삽입(선언 2종 커버, 중복 방지)
s = s.replace(
  /(function\s+renderPlatforms\s*\(\s*prev\s*,\s*now\s*\)\s*\{\s*)(?![\s\S]*?toArray\(prev\))/,
  `$1  prev = toArray(prev);\n  now  = toArray(now);\n`
);
s = s.replace(
  /(renderPlatforms\s*=\s*\(\s*prev\s*,\s*now\s*\)\s*=>\s*\{\s*)(?![\s\S]*?toArray\(prev\))/,
  `$1  prev = toArray(prev);\n  now  = toArray(now);\n`
);

// 4) 직접 .map 호출 보호(이미 toArray(...)면 건너뜀)
s = s.replace(/\bplatformsPrev\.map/g, 'toArray(platformsPrev).map');
s = s.replace(/\bplatformsNow\.map/g,  'toArray(platformsNow).map');

// 5) 혹시 남아있는 normalizeItems(...) 호출은 toArray(...)로 통일
s = s.replace(/normalizeItems\(/g, 'toArray(');

fs.writeFileSync(F, s);
console.log('[ok] app.js patched');
