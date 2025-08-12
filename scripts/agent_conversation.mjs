import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenerativeAI } from "@google/generative-ai";

const OUT = path.join(process.cwd(), 'public', 'data', 'agent_dialogue.json');
const SNAP = path.join(process.cwd(), 'public', 'data', 'snapshots.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const USE_GEMINI = Boolean(GEMINI_API_KEY);
const genAI = USE_GEMINI ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// 최신 뉴스 3개를 프롬프트 컨텍스트로 넣기
async function top3News(){
  try{
    const j = JSON.parse(await fs.readFile(SNAP,'utf8'));
    const news = (j.results||[]).find(x=>x.from==='news')?.items||[];
    return news.slice(0,3).map(n=>`- ${n.title} (${n.source}) ${n.url}`).join('\n');
  }catch{ return ''; }
}

function m(role, content){ return { role, content, ts: new Date().toISOString() }; }

async function ask(text){
  if(!USE_GEMINI) return "(로컬 모드) GEMINI_API_KEY 없음 → 대화 생략";
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { responseMimeType: "text/plain" }
  });
  return res.response.text();
}

async function run(turns=3){
  const dialog = [];
  const news3 = await top3News();
  const sys = `역할: 코디네이터↔뉴스 에이전트 간 짧은 대화.
목표: 오늘의 핵심 1줄 요약(한국어), 관련 태그(<=5), 다음 액션 2가지.
컨텍스트(상위3개):
${news3 || '(뉴스 없음)'}
형식 제안: 
- 오늘의 한줄:
- 태그: #a #b #c
- 다음액션: 1) ... 2) ...`;

  dialog.push(m('system', 'Agents Talk v1'));
  dialog.push(m('coordinator', '뉴스 에이전트, 위 컨텍스트 기반으로 제안해줘.'));
  for(let i=0;i<turns;i++){
    const newsReply = await ask(`${sys}\n\n[Coordinator]: 요청에 답변해줘.`);
    dialog.push(m('news', newsReply));
    const coordReply = await ask(`다음은 뉴스 에이전트의 답변이야:\n${newsReply}\n\n누락·모호점 지적과 보완 제안 2가지를 짧게.`);
    dialog.push(m('coordinator', coordReply));
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify({ generated_at: new Date().toISOString(), dialog }, null, 2), 'utf8');
  console.log(`✔ agent_dialogue.json saved (${dialog.length} messages)`);
}

run().catch(e=>{ console.error(e); process.exit(1); });
