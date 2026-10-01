// Local, deterministic UI smoke harness. No external API requests or Gmail writes.
const memory = {};
const thread = {threadId:'preview',ostatniaWiadomoscId:'m1',tytul:'Zapytanie',ostrzezenia:[],wiadomosci:[{id:'m1',nadawca:'Klient',tekst:'Dwie osoby, każda Basic, 26 października 2027. Wizyta 30 minut.'}]};
globalThis.chrome={
  storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in memory).map(k=>[k,memory[k]])),set:async value=>Object.assign(memory,value)},onChanged:{addListener(){}}},
  tabs:{query:async()=>[{id:1,url:'https://mail.google.com/mail/u/0/#inbox/preview'}],sendMessage:async(_id,m)=>m.typ==='ODCZYTAJ_WATEK'?{ok:true,dane:thread}:{ok:true}},
  runtime:{openOptionsPage:()=>{location.href='options.html';},sendMessage:async m=>{
    try {
      if(m.typ==='JEV_ANALYZE'||m.typ==='JEV_RECALCULATE'){
        const {analyzeThread,calculateCase}=await import('../core/orchestrator.js');
        const {zUstawieniami}=await import('../config.js');
        const settings=zUstawieniami({apiKey:'preview-only'});
        const decideImpl=async({questions})=>({metrics:{ms:5,calls:1,costUsd:0},answers:Object.fromEntries(Object.entries(questions).map(([id,q])=>{
          const values={quote:'yes',availability:'yes',review:'no',language:'pl',people:'2',billingPeople:'2',day:'26',month:'10',year:'2027',time:'missing',duration:'30',unsupported:'no',p1_complete:'yes',p2_complete:'yes',p1_basic:'1',p2_basic:'1'};
          const choice=id.startsWith('product_')?(id==='product_basic'?'yes':'no'):values[id];
          return[id,{type:'choice',choice,confidence:0.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0]))}];
        }))});
        const c=m.typ==='JEV_ANALYZE'?await analyzeThread({thread:m.thread,settings,decideImpl}):m.case;
        return{ok:true,result:await calculateCase(c,settings,async()=>({proponowane:['12:00','13:30'],zrodlo:{wiekMin:0}}))};
      }
      return{ok:true,log:[],watkowWDedup:0};
    }catch(e){return{ok:false,blad:e.message};}
  }}
};
