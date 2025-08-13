import fs from 'fs/promises';
import path from 'path';
import { GoogleGenerativeAI } from "@google/generative-ai";

const OUT = path.join(process.cwd(), 'public/data/news_talk.json');
const TODAY = new Date().toISOString().slice(0,10);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function withRetry(fn, tries=5, baseMs=1000){
  let last; for(let i=0;i<tries;i++){ try{ return await fn(); }
    catch(e){ last=e; const r=(e?.status===429)||(e?.response?.status===429);
      if(!r||i===tries-1) throw e;
      const t=Math.min(30000, baseMs*(2**i)) + Math.floor(Math.random()*250);
      await new Promise(r=>setTimeout(r,t)); } } throw last;
}

async function main(){
  let db={}; try{ db=JSON.parse(await fs.readFile(OUT,'utf8')); }catch{}
  if (db[TODAY]) { console.log('talk cache exists -> skip'); return; }

  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const prompt = `
news_current.json을 읽었다고 가정하고,
하루 요약 3줄과 해시태그 5개만 JSON으로 출력:
{"summary":["...","...","..."],"tags":["#a","#b","#c","#d","#e"]}
문자만 출력, 코드펜스 금지.
`;
  const res = await withRetry(()=>model.generateContent(prompt));
  const txt = res.response.text().trim().replace(/```(\w+)?/g,'').trim();
  let out; try{ out=JSON.parse(txt); }catch{ out={summary:[],tags:[]}; }
  db[TODAY]=out;
  await fs.mkdir(path.dirname(OUT), {recursive:true});
  await fs.writeFile(OUT, JSON.stringify(db,null,2));
  console.log(`wrote ${OUT} for ${TODAY}`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
