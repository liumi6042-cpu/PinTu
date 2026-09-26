import test from 'node:test';
import assert from 'node:assert/strict';
import {countryLanguage,browserLanguage,localeResponse,detectLanguage,languagePreference,LANGUAGE_KEY} from '../lib/language-detection.ts';
import {getLanguage,getLanguagePreference,getLanguageRevision,setLanguage,setLanguagePreference,restoreLanguagePreference,applyDetectedLanguage} from '../lib/i18n.ts';

test('IP regions choose supported languages and unavailable regions use the browser fallback',()=>{
  for(const code of ['CN','HK','MO','TW',' cn '])assert.equal(countryLanguage(code),'zh');
  for(const code of ['US','CA','GB','DE','FR','SG','JP'])assert.equal(countryLanguage(code),'en');
  for(const code of [null,'','XX','ZZ','T1','CN,US','CNA'])assert.equal(countryLanguage(code),null);
  assert.equal(browserLanguage(['fr-FR','zh-TW','en']),'zh');
  assert.equal(browserLanguage(['en-US','zh-CN']),'en');
  assert.equal(browserLanguage(['fr-FR']),'en');
  assert.equal(browserLanguage([]),'en');
  assert.equal(languagePreference('zh'),'zh');assert.equal(languagePreference('en'),'en');
  for(const value of [null,'','auto','fr'])assert.equal(languagePreference(value),'auto');
});

test('locale response trusts only sanitized ingress and is never publicly cached',async()=>{
  const raw=new Request('https://jigsawnook.online/api/locale?country=CN',{headers:{'CF-IPCountry':'CN','X-Forwarded-For':'1.2.3.4'}});
  assert.deepEqual(await localeResponse(raw,false).json(),{language:null,source:'browser'});
  for(const country of ['CN','US','XX']){
    const request=new Request('https://jigsawnook.online/api/locale',{headers:{'X-Puzzle-Country':country}});
    const response=localeResponse(request,false);
    assert.deepEqual(await response.json(),{language:countryLanguage(country),source:country==='XX'?'browser':'ip'});
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    assert.equal(response.headers.get('CDN-Cache-Control'),'no-store');
    assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'),'no-store');
    assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
    assert.equal(response.headers.get('set-cookie'),null);
    assert.deepEqual(await localeResponse(request,true).json(),{language:null,source:'browser'});
  }
});

test('detection uses one same-origin request; network errors and unknown data retain fallback',async()=>{
  const signal=new AbortController().signal;let calls=0;
  const fetcher=async(url,options)=>{calls++;assert.equal(url,'/api/locale');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');assert.equal(options.signal,signal);return Response.json({language:'en',source:'ip'});};
  assert.equal(await detectLanguage('zh',signal,fetcher),'zh');assert.equal(calls,1);
  assert.equal(await detectLanguage('en',signal,fetcher),'en');
  assert.equal(await detectLanguage('en',signal,async()=>Response.json({language:'zh',source:'ip'})),'zh');
  for(const fetcher of [async()=>{throw new Error('offline');},async()=>new Response('busy',{status:503}),async()=>new Response('bad json'),async()=>Response.json({language:null,source:'browser'}),async()=>Response.json({language:'fr',source:'ip'})]){
    assert.equal(await detectLanguage('zh',signal,fetcher),'zh');
  }
});

test('manual preferences survive detection races, automatic results are not persisted, and old preferences restore',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const values=new Map();let writes=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes++;values.set(key,value);}}});
  try{
    setLanguage('zh');values.set(LANGUAGE_KEY,'en');restoreLanguagePreference();
    assert.equal(getLanguage(),'en');assert.equal(getLanguagePreference(),'en');
    setLanguagePreference('auto');const beforeWrites=writes,revision=getLanguageRevision();
    applyDetectedLanguage('zh',revision);assert.equal(getLanguage(),'zh');
    assert.equal(writes,beforeWrites);assert.equal(values.get(LANGUAGE_KEY),'auto');
    let resolve;
    const result=detectLanguage('zh',new AbortController().signal,()=>new Promise(done=>{resolve=done;}));
    setLanguage('en');resolve(Response.json({language:'zh',source:'ip'}));
    applyDetectedLanguage(await result,revision);
    assert.equal(getLanguage(),'en');assert.equal(getLanguagePreference(),'en');assert.equal(values.get(LANGUAGE_KEY),'en');
    setLanguagePreference('auto');applyDetectedLanguage('zh',revision);
    assert.equal(getLanguage(),'en','stale detection cannot overwrite a newer automatic run');
    applyDetectedLanguage('zh',getLanguageRevision());assert.equal(getLanguage(),'zh');
    const autoRevision=getLanguageRevision();restoreLanguagePreference();
    assert.equal(getLanguageRevision(),autoRevision,'same auto storage event does not invalidate an in-flight request');
    values.delete(LANGUAGE_KEY);restoreLanguagePreference();assert.equal(getLanguagePreference(),'auto');
  }finally{
    if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;
    setLanguage('zh');
  }
});
