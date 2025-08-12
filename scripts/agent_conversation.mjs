import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenerativeAI } from "@google/generative-ai";

const OUT = path.join(process.cwd(), 'public', 'data', 'agent_dialogue.json');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const USE_GEMINI = Boolean(GEMINI_API_KEY);
const genAI = USE_GEMINI ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const sysCoordinator = `You are the Coordinator Agent. Goal: build an AI dashboard by aligning agents.
Ask NewsAgent specific questions (sources, tags, confidence). Keep turns short. Output Korean.`;
const sysNews = `You are the News Expert Agent. You fetch RSS (already handled by scripts), summarize, tag, score.
When Coordinator asks, answer concisely in Korean. If data is missing, propose concrete next steps.`;

const seedContext = `현재 시스템:
- UI(M7) 정적 JSON을 렌더
- News Agent(M8): RSS→요약/태깅/스코어→snapshots.json 저장(Gemini 사용, Actions에서 키 제공)
- GitHub Agent: 준비중
- 목표: 오늘 기사 3건의 핵심 태그/중요도/근거링크 확인하고, UI에 표시할 '오늘의 한줄' 제안`;

function asMsg(role, content){ return { role, content, ts: new Date().toISOString() }; }

async function ask(modelName, prompt){
  if(!USE_GEMINI) return "(로컬/무료모드) 대화 비활성화: GEMINI_API_KEY 없음";
  const model = genAI.getGenerativeModel({ model: modelName });
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "text/plain" }
  });
  return res.response.text();
}

async function runDialogue(turns=4){
  const log = [];
  // 시스템 메시지(프롬프트 인코딩)
  log.push(asMsg("system", sysCoordinator));
  log.push(asMsg("system", sysNews));
  log.push(asMsg("system", seedContext));

  let lastFrom = "Coordinator", lastText = "뉴스 에이전트, 오늘 상위 3개 기사 요약/태그/근거링크/점수 간단히.";
  log.push(asMsg("coordinator", lastText));

  for(let i=0;i<turns;i++){
    // NewsAgent 응답
    const newsPrompt = `${sysNews}\n\n[Coordinator]: ${lastText}`;
    const newsReply = await ask("gemini-2.5-flash", newsPrompt);
    log.push(asMsg("news", newsReply));

    // Coordinator 피드백/요청
    const coordPrompt = `${sysCoordinator}\n\n[NewsAgent]: ${newsReply}\n\n요청: 누락/모호점 지적 및 다음 액션 2개 제안. 한글.`;
    const coordReply = await ask("gemini-2.5-flash", coordPrompt);
    log.push(asMsg("coordinator", coordReply));
    lastText = coordReply;
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify({ generated_at: new Date().toISOString(), dialog: log }, null, 2), 'utf8');
  console.log(`✔ agent_dialogue.json saved (${log.length} messages)`);
}

runDialogue(3).catch(e=>{ console.error(e); process.exit(1); });
