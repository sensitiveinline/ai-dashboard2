import fs from 'fs/promises';
import path from 'path';

function get(obj, p, dflt=undefined){
  if (!p) return dflt;
  const segs = p.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (const s of segs){
    if (s==='') continue;
    if (cur && Object.prototype.hasOwnProperty.call(cur, s)) cur = cur[s];
    else return dflt;
  }
  return cur;
}
function hostname(u){ try { return new URL(u).hostname; } catch { return ''; } }
function isoDate(d){ try { return new Date(d||Date.now()).toISOString(); } catch { return new Date().toISOString(); } }
function ymd(d){ try { return new Date(d||Date.now()).toISOString().slice(0,10); } catch { return new Date().toISOString().slice(0,10); } }

function adoptItem(item, map, type){
  if (type==='news'){
    const title = String(get(item, map.title)||'').slice(0,300);
    const url = String(get(item, map.url)||'');
    const summary = String(get(item, map.summary)||'');
    const source = map.source ? String(get(item, map.source)||'') : hostname(url);
    const ts = map.ts ? String(get(item, map.ts)||isoDate()) : isoDate();
    return { title, url, summary, source, ts };
  }
  if (type==='note'){
    const title = String(get(item, map.title)||'').slice(0,300);
    const content = String(get(item, map.content)||'');
    const date = map.date ? String(get(item, map.date)||ymd()) : ymd();
    return { title, content, date };
  }
  throw new Error(`Unknown type: ${type}`);
}

async function main(){
  const args = Object.fromEntries(process.argv.slice(2).map(s=>{
    const [k,...rest]=s.split('='); return [k.replace(/^--/,''), rest.join('=')];
  }));
  const { in:inFile, map:mapFile, out:outFile, type } = args;
  if(!inFile || !mapFile || !outFile || !type){
    console.error('Usage: node scripts/mappers/adopt_json.mjs --in=src.json --map=mapping.json --out=public/data/news_current.json --type=news|note');
    process.exit(2);
  }
  const raw = JSON.parse(await fs.readFile(inFile,'utf8'));
  const mapping = JSON.parse(await fs.readFile(mapFile,'utf8'));
  const arr = Array.isArray(raw) ? raw
           : Array.isArray(raw.items) ? raw.items
           : Array.isArray(raw.data) ? raw.data
           : Object.values(raw);

  const out = arr.map(x=>adoptItem(x, mapping, type))
                 .filter(x=>x.title && x.url !== undefined);

  await fs.mkdir(path.dirname(outFile), {recursive:true});
  await fs.writeFile(outFile, JSON.stringify(out, null, 2));
  console.log(`Wrote ${out.length} items -> ${outFile}`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
