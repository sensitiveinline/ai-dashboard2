import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenerativeAI } from "@google/generative-ai";

const ROOT = process.cwd();
const SNAP = path.join(ROOT, 'public', 'data', 'snapshots.json');
const RANK = path.join(ROOT, 'public', 'data', 'platform_rankings.json');
const OUT  = path.join(ROOT, 'public', 'data', 'ai_note.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const USE = Boolean(GEMINI_API_KEY);
const genAI = USE ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

async function run(){
  const snap = JSON.parse(await fs.readFile(SNAP,'utf8'));
  const rank = JSON.parse(await fs.readFile(RANK,'utf8'));

  const news = (snap.results||[]).find(x=>x.from==='news')?.items?.slice(0,8) || [];
  const gh   = (snap.results||[]).find(x=>x.from==='github')?.items?.slice(0,8) || [];
  const topRank = (rank.items||[]).slice(0,5);

  const context = {
    topRank,
    gh: gh.map(x=>({id:x.id, prs:x.prs_merged, rel:x.releases, tags:x.tags})),
    news: news.map(n=>({title:n.title, summary:n.summary, tags:n.tags, source:n.source}))
  };

  let note = {
    generated_at: new Date().toISOString(),
    one_liner: "",
    bullets: [],
    risks: [],
    actions: []
  };

  if(!USE){
    note.one_liner = "무료 모드: 데이터 스냅샷 기반 자동 요약 (AI 없음)";
    note.bullets = [
      `Top Platform: ${(topRank[0]?.platform)||'—'} (score ${topRank[0]?.score||0})`,
      `활동 레포 수: ${gh.length}, 뉴스 수: ${news.length}`,
      `다음 단계: GitHub 델타 도입, 키워드 튜닝`
    ];
  }else{
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `아래 JSON을 읽고, 한국어로 '오늘의 노트'를 만들어라.
- one_liner(한 문장, 120자 이내)
- bullets(3~5개 핵심 요약)
- risks(2개)
- actions(2~3개, 실행지향)

JSON:
${JSON.stringify(context)}`;
    const res = await model.generateContent({
      contents: [{role:"user", parts:[{text:prompt}]}],
      generationConfig: { responseMimeType: "application/json" }
    });
    try{
      const j = JSON.parse(res.response.text());
      note = { generated_at: new Date().toISOString(), ...note, ...j };
    }catch(e){}
  }

  await fs.writeFile(OUT, JSON.stringify(note,null,2),'utf8');
  console.log(`✔ ai_note.json updated`);
}

run().catch(e=>{ console.error(e); process.exit(1); });
