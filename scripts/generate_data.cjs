/**
 * 여기에 "실제 데이터 생성" 코드를 넣으세요.
 * - 외부 API 쓰면 환경변수로 키를 받으세요 (예: process.env.X_API_KEY)
 * - 실패해도 기존 파일 보존하도록 안전하게 작성
 */
const fs = require('fs'); const path = require('path');
const DATA = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

// TODO: ↓↓↓ 이 부분을 실제 로직으로 교체하세요 ↓↓↓
function nowScore(seed){ const base = 80 + (seed % 20); return base; }
const platformsNow = [
  { id:'openai',     name:'OpenAI',     score: nowScore(1) },
  { id:'deepseek',   name:'DeepSeek',   score: nowScore(2) },
  { id:'anthropic',  name:'Anthropic',  score: nowScore(3) },
  { id:'google',     name:'Google',     score: nowScore(4) },
  { id:'meta',       name:'Meta',       score: nowScore(5) },
];
const platformsPrev = platformsNow.map(x => ({...x, score: x.score + (Math.random()<.5?-1:1)}));
const news = [];      // 실제 뉴스 수집 로직 넣으세요
const repos = [];     // 실제 리포 수집 로직 넣으세요
const note  = {};     // 오늘의 노트 생성 로직 넣으세요
// ↑↑↑ 이 부분만 바꾸면 됩니다 ↑↑↑

fs.writeFileSync(path.join(DATA, 'platform_rankings.json'),      JSON.stringify(platformsNow,  null, 2));
fs.writeFileSync(path.join(DATA, 'platform_rankings.prev.json'), JSON.stringify(platformsPrev, null, 2));
fs.writeFileSync(path.join(DATA, 'news_snapshots.json'),         JSON.stringify(news,  null, 2));
fs.writeFileSync(path.join(DATA, 'gh_repos.json'),               JSON.stringify(repos, null, 2));
fs.writeFileSync(path.join(DATA, 'ai_note.json'),                JSON.stringify(note,  null, 2));

console.log('[generate_data] wrote data/*.json');
