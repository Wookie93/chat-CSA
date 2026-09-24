// Explicit opt-in evaluation. Sends only the selected input file's messages to OpenRouter.
import { readFile, writeFile } from 'node:fs/promises';
import { analyzeThread } from '../core/orchestrator.js';
import { priceOrder } from '../tools/pricing.js';
import { zUstawieniami } from '../config.js';
import { isDeepStrictEqual } from 'node:util';
const [input,output]=process.argv.slice(2);
if(!input||!output||!process.env.OPENROUTER_API_KEY){
  console.error('Usage: OPENROUTER_API_KEY=<key> node scripts/evaluate.mjs input.json report.json\nThe explicitly selected messages will be sent to OpenRouter. Reports omit message text.');process.exit(1);
}
const cases=JSON.parse(await readFile(input,'utf8'));
if(!Array.isArray(cases)||cases.length>200||cases.some(c=>typeof c.id!=='string'||typeof c.text!=='string'||!c.expected))throw new Error('Expected an array of at most 200 {id,text,expected} entries.');
const settings=zUstawieniami({apiKey:process.env.OPENROUTER_API_KEY});
const rows=[];
for(const entry of cases){
  const started=Date.now();
  try{
    const c=await analyzeThread({thread:{wiadomosci:[{tekst:entry.text}],ostrzezenia:[]},settings});
    const quote=priceOrder(c.order,settings.jev.catalog);
    const actual={people:c.order.people,billingPeople:c.order.billingPeople,date:c.order.date,participants:c.order.participants,
      totalGrosz:quote.totalGrosz,quoteStatus:quote.status,quote:c.intents.quote,availability:c.intents.availability};
    const fields=Object.fromEntries(Object.entries(entry.expected).map(([key,value])=>[key,{pass:isDeepStrictEqual(actual[key],value),expected:value,actual:actual[key]}]));
    rows.push({id:entry.id,pass:Object.values(fields).every(f=>f.pass),ms:Date.now()-started,fields,issues:c.issues,metrics:c.metrics});
  }catch(e){rows.push({id:entry.id,pass:false,ms:Date.now()-started,error:e.message});}
  console.log(`${rows.length}/${cases.length}: ${entry.id} ${rows.at(-1).pass?'PASS':'FAIL'}`);
}
const sorted=rows.map(r=>r.ms).sort((a,b)=>a-b);
const report={at:new Date().toISOString(),model:settings.jev.model,catalogVersion:settings.jev.catalog.version,
  samples:rows.length,passed:rows.filter(r=>r.pass).length,
  p50Ms:sorted[Math.max(0,Math.ceil(sorted.length*.5)-1)]??null,p95Ms:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??null,
  includesCalendar:false,rows};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
