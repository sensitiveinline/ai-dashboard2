/**
 * 실제 데이터 생성 자리(샘플 로직). 외부 API 붙일 땐 이 파일만 수정하면 됩니다.
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

// ---- 여기에 실제 수집/계산 로직을 넣으세요 ----
function nowScore(seed){ return 80 + (seed % 20); }

const platformsNow = [
  { id:'openai',    name:'OpenAI',    score: nowScore(1) },
  { id:'deepseek',  name:'DeepSeek',  score: nowScore(2) },
  { id:'anthropic', name:'Anthropic', score: nowScore(3) },
  { id:'google',    name:'Google',    score: nowScore(4) },
  { id:'meta',      name:'Meta',      score: nowScore(5) }
];

const platformsPrev = platformsNow.map(x => ({
  ...x,
  score: x.score + (Math.random() < 0.5 ? -1 : 1)
}));

const news  = [];   // TODO: 실제 뉴스 수집 결과 배열
const repos = [];   // TODO: 실제 깃허브 리포 배열
const note  = {};   // TODO: 오늘의 노트 객체 또는 배열

// ---- 저장 ----
fs.writeFileSync(path.join(DATA, 'platform_rankings.json'),      JSON.stringify(platformsNow,  null, 2));
fs.writeFileSync(path.join(DATA, 'platform_rankings.prev.json'), JSON.stringify(platformsPrev, null, 2));
fs.writeFileSync(path.join(DATA, 'news_snapshots.json'),         JSON.stringify(news,  null, 2));
fs.writeFileSync(path.join(DATA, 'gh_repos.json'),               JSON.stringify(repos, null, 2));
fs.writeFileSync(path.join(DATA, 'ai_note.json'),                JSON.stringify(note,  null, 2));

console.log('[generate_data] wrote data/*.json');
