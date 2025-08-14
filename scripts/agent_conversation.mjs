import fs from 'fs/promises';
import path from 'path';
import { GoogleGenerativeAI } from "@google/generative-ai";

const OUT_SNAP = path.join(process.cwd(), 'public/data/news_snapshots.json');
const OUT_CURR = path.join(process.cwd(), 'public/data/news_current.json');
const TODAY = new Date().toISOString().slice(0,10);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function withRetry(fn, tries=5, baseMs=1000) {
  let lastErr;
  for (let i=0;i<tries;i++){
    try { return await fn(); }
    catch (e){
      lastErr = e;
      const retriable = (e?.status===429) || (e?.code==='RESOURCE_EXHAUSTED') || (e?.response?.status===429);
      if (!retriable || i===tries-1) throw e;
      const jitter = Math.floor(Math.random()*250);
      const delay = Math.min(30000, baseMs * (2**i)) + jitter;
      console.log(`retry #${i+1} in ${delay}ms`);
      await new Promise(r=>setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function generateNews() {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const prompt = `
오늘 날짜 기준 AI 관련 주요 뉴스 6개를
JSON 배열로만 출력.
각 항목은 {"title":"","url":"","summary":"","source":""} 형식.
마크다운/코드펜스/설명 금지.
`;
  const res = await model.generateContent(prompt);
  const txt = res.response.text().trim();
  const clean = txt.startsWith('```') ? txt.replace(/```(\w+)?/g,'').trim() : txt;
  const arr = JSON.parse(clean);
  return arr.map(x => ({
    title: String(x.title||'').slice(0,300),
    url: String(x.url||''),
    summary: String(x.summary||'').slice(0,1000),
    source: String(x.source||new URL(x.url||'').hostname||''),
    ts: new Date().toISOString()
  }));
}

async function main(){
  let snap = {};
  try { snap = JSON.parse(await fs.readFile(OUT_SNAP,'utf8')); } catch { snap = {}; }

  if (snap[TODAY]) {
    console.log(`cache exists for ${TODAY} -> skip`);
    await fs.writeFile(OUT_CURR, JSON.stringify(snap[TODAY], null, 2));
    return;
  }

  const todayArr = await withRetry(() => generateNews());

  snap[TODAY] = todayArr;
  await fs.mkdir(path.dirname(OUT_SNAP), { recursive: true });
  await fs.writeFile(OUT_SNAP, JSON.stringify(snap, null, 2));
  await fs.writeFile(OUT_CURR, JSON.stringify(todayArr, null, 2));

  console.log(`wrote ${OUT_SNAP} & ${OUT_CURR} for ${TODAY} (${todayArr.length} items)`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
