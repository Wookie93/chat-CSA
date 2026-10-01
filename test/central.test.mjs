import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfiguration, activeConfiguration, configurationUrl, configurationStamp, MAX_BYTES } from '../extensions/JevCSAssistant/central/schema.mjs';
import { fetchConfiguration } from '../extensions/JevCSAssistant/central/sync.js';
import { zUstawieniami } from '../extensions/JevCSAssistant/config.js';
const url='https://example.com/api/configuration';
const connection={enabled:true,url,token:'x'.repeat(40)};
const fixture=()=>({schemaVersion:1,revision:1,publishedAt:'2026-09-24T12:00:00.000Z',catalog:{version:'test',currency:'PLN',approved:false,items:[]},templates:{pl:'{{wycena}} {{dostepnosc}} {{pytania}}',en:'{{wycena}} {{dostepnosc}} {{pytania}}'},availabilityPolicy:{staffing:'unconfirmed',proposals:'unconfirmed',allowFinishAfterClosing:false},replyTemplates:[]});
test('Reject secrets, unknown fields, broken templates and malformed data',()=>{
  for(const mutate of [v=>v.apiKey='secret',v=>v.catalog.secret='secret',v=>v.templates.pl='{{wycena}}',v=>v.availabilityPolicy.staffing='guess',v=>v.revision=0,v=>v.replyTemplates=[{id:'x'}]]){
    const v=fixture();mutate(v);assert.throws(()=>validateConfiguration(v));
  }
  assert.equal(validateConfiguration(fixture()).revision,1);
});
test('Central overlay preserves secrets and local fallback without mutating stored settings',()=>{
  const local={apiKey:'local-secret',icalUrl:'local-calendar',jev:{catalog:{version:'local'},shadow:true},centralConnection:connection,centralCache:{source:url,document:fixture()}};
  const snapshot=structuredClone(local);
  const result=zUstawieniami(local);
  assert.equal(result.jev.catalog.version,'test');assert.equal(result.apiKey,'local-secret');assert.equal(result.icalUrl,'local-calendar');assert.equal(result.jev.shadow,true);assert.deepEqual(local,snapshot);
  assert.equal(zUstawieniami({...local,centralConnection:{...connection,enabled:false}}).jev.catalog.version,'local');
  assert.equal(activeConfiguration({...local,centralConnection:{...connection,url:'https://other.example/api/configuration'}}),null);
  assert.equal(configurationStamp(result),url+'#1');
});
test('Fetch sends only read token, rejects redirects and binds cache to its source',async()=>{
  const result=await fetchConfiguration(connection,null,async(target,options)=>{
    assert.equal(target,url);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.body,undefined);assert.deepEqual(options.headers,{Authorization:'Bearer '+connection.token});
    return Response.json(fixture());
  });assert.equal(result.source,url);assert.equal(result.document.revision,1);
});
test('Accept JSONB key ordering, reject changed or older publications; preserve last good cache',async()=>{
  const previous={source:url,document:fixture()};const before=structuredClone(previous);
  const reordered=Object.fromEntries(Object.entries(fixture()).reverse());
  await fetchConfiguration(connection,previous,async()=>Response.json(reordered));
  const changed=fixture();changed.catalog.approved=true;
  await assert.rejects(fetchConfiguration(connection,previous,async()=>Response.json(changed)),/Treść/);
  await assert.rejects(fetchConfiguration(connection,{source:url,document:{...fixture(),revision:2}},async()=>Response.json(fixture())),/starszą/);
  await assert.rejects(fetchConfiguration(connection,previous,async()=>new Response('unauthorized',{status:401})),/401/);
  await assert.rejects(fetchConfiguration(connection,previous,async()=>new Response('{')),SyntaxError);
  assert.deepEqual(previous,before);
});
test('Enforce HTTPS, fixed path, no embedded credentials or query secrets',()=>{
  for(const value of ['http://example.com/api/configuration','https://user:pass@example.com/api/configuration',url+'?key=x',url+'#x','https://example.com/other'])assert.throws(()=>configurationUrl(value));
  assert.equal(configurationUrl('http://localhost:3000/api/configuration'),'http://localhost:3000/api/configuration');
});
test('Reject oversized response before parsing and cancel stream',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_BYTES+1));},cancel(){cancelled=true;}});
  await assert.rejects(fetchConfiguration(connection,null,async()=>new Response(stream)),/512/);assert.equal(cancelled,true);
});
