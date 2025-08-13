import fs from 'fs/promises';
import path from 'path';

// -------- config --------
const OUT = path.join(process.cwd(), 'public/data/news_snapshots.json');
const TODAY = new Date().toISOString().slice(0,10); // YYYY-MM-DD

// ---- helper: retry with backoff + jitter ----
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
      console.log(`retry #${i+1} in ${delay}ms (reason: ${e?.status||e?.code||'error'})`);
      await new Promise(r=>setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ---- fake fetcher to replace with real Gemini call ----
async function generateNews() {
  // 여기에 실제 Gemini 호출 로직을 사용하세요.
  // 예: await client.models.generateContent({model:'gemini-2.0-flash', contents:[...]} )
  return [
    { title: "AI News Snapshot", url: "https://example.com", summary: "Daily snapshot", ts: new Date().toISOString() }
  ];
}

// ---- main ----
async function main(){
  // 1) load cache (if exists)
  let db = {};
  try {
    const raw = await fs.readFile(OUT, 'utf8');
    db = JSON.parse(raw);
  } catch (_) { db = {}; }

  // 2) if already have today, skip work (exit 0)
  if (db[TODAY]) {
    console.log(`cache exists for ${TODAY} -> skip`);
    return;
  }

  // 3) run with retry
  const result = await withRetry(() => generateNews());

  // 4) save
  db[TODAY] = result;
  const pretty = JSON.stringify(db, null, 2);
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, pretty);
  console.log(`wrote ${OUT} for ${TODAY} (${Array.isArray(result)?result.length:1} items)`);
}

main().catch((e)=>{ console.error(e); process.exit(1); });
