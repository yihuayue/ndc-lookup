export const EXAMPLES=['Repaglinide','Pioglitazone','Bupropion'];
export const INPUT_TYPES={ingredient:'Ingredient name',generic:'Generic name',brand:'Brand name',mixed:'Any drug name'};
export const EXAMPLES_BY_TYPE={ingredient:EXAMPLES,generic:EXAMPLES,brand:['Lipitor','Keppra','Zoloft'],mixed:['Repaglinide','Lipitor','Bupropion']};
export const FDA='https://api.fda.gov/drug/ndc.json';
export const normalizeName=s=>String(s??'').replace(/_/g,' ').trim().toLowerCase().replace(/\s+/g,' ');
export function parseNames(text){const seen=new Set();return String(text).split(/[\r\n]+/).map(x=>x.trim()).filter(Boolean).filter(line=>{const key=normalizeName(line);if(!key||seen.has(key))return false;seen.add(key);return true;}).map(input=>({input}));}
export function normalizeNdc(value){const raw=String(value??'').trim();if(/^\d{11}$/.test(raw))return raw;const p=raw.split('-');if(p.length!==3||p.some(x=>!/^\d+$/.test(x)))return '';const shape=p.map(x=>x.length).join('-');if(!['4-4-2','5-3-2','5-4-1','5-4-2'].includes(shape))return '';return p.map((x,i)=>x.padStart([5,4,2][i],'0')).join('');}
export function searchFields(inputType='mixed'){return inputType==='mixed'?['active_ingredients.name','generic_name','brand_name']:[inputType==='brand'?'brand_name':inputType==='generic'?'generic_name':'active_ingredients.name'];}
export function fdaSearch(name,inputType='mixed'){return '('+searchFields(inputType).map(f=>f+':'+luceneQuote(name)).join(' OR ')+') AND finished:true AND (product_type:"HUMAN PRESCRIPTION DRUG" OR product_type:"HUMAN OTC DRUG")';}
export function luceneQuote(s){return '"'+String(s).replace(/([+\-!(){}\[\]^"~*?:\\/|&])/g,'\\$1')+'"';}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function createClient({signal,fetcher=fetch,delay=350}={}){const cache=new Map();let next=0;return async function get(url){if(!url.startsWith(FDA+'?'))throw new Error('Only the openFDA NDC endpoint is supported.');if(signal?.aborted)throw new DOMException('Stopped','AbortError');if(cache.has(url))return cache.get(url);const work=(async()=>{const now=Date.now(),slot=Math.max(now,next);next=slot+Math.max(delay,350);await pause(slot-now);for(let attempt=0;attempt<3;attempt++){if(signal?.aborted)throw new DOMException('Stopped','AbortError');const abort=new AbortController(),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});const timer=setTimeout(()=>abort.abort(),35000);try{const res=await fetcher(url,{signal:abort.signal});if(res.status===404){const empty=await res.json();if(empty.error?.code==='NOT_FOUND')return {results:[],meta:{results:{total:0}}};throw new Error('FDA request failed (404)');}if(!res.ok){if((res.status===429||res.status>=500)&&attempt<2){await pause(1500*2**attempt);continue;}throw new Error(`HTTP ${res.status}${res.status===429?' — API quota reached; retry later':''}`);}return await res.json();}catch(e){if(signal?.aborted)throw new DOMException('Stopped','AbortError');if(attempt<2&&(e.name==='AbortError'||e instanceof TypeError)){await pause(1000*2**attempt);continue;}throw e;}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}}})();cache.set(url,work);try{return await work;}catch(e){cache.delete(url);throw e;}};}
function error(result,route,e){result.errors.push(`${route}: ${e.message||e}`);}
export function makeResult(drug){return {inputType:'mixed',...drug,started:new Date().toISOString(),finished:'',fda:[],fdaProducts:[],notes:[],errors:[],fdaState:'Pending',fdaUpdated:'',fdaFetched:0};}
export async function lookupFda(result,{get,signal,progress=()=>{},pageSize=1000}){
 result.fdaState='Running';const seen=new Set();
 try{let skip=0,total=Infinity;const search=fdaSearch(normalizeName(result.input),result.inputType);
  while(skip<total){
   if(signal?.aborted)throw new DOMException('Stopped','AbortError');
   if(skip>25000)throw new Error('FDA pagination limit reached; results are incomplete. Use a more specific drug name.');
   const url=FDA+'?'+new URLSearchParams({search,limit:String(pageSize),skip:String(skip)}),d=await get(url);
   if(!d.meta?.results||!Array.isArray(d.results)||!Number.isInteger(d.meta.results.total)||d.meta.results.total<0)throw new Error('Unexpected FDA response; results cannot be treated as complete.');
   total=d.meta.results.total;result.fdaUpdated=d.meta.last_updated||result.fdaUpdated;result.fdaFetched+=d.results.length;
   progress(`${result.input}: openFDA records ${Math.min(skip+d.results.length,total)}/${total}`);
   for(const p of d.results){
    const key=p.product_id||p.product_ndc+'|'+p.spl_id;if(seen.has(key))continue;seen.add(key);
    const ingredients=(p.active_ingredients??[]).map(x=>[x.name,x.strength].filter(Boolean).join(' ')).join(' | ');
    const base={input:result.input,inputType:result.inputType,productId:key,productNdc:p.product_ndc||'',product:p.generic_name||'',brand:p.brand_name||'',labeler:p.labeler_name||'',ingredients,dosageForm:p.dosage_form||'',route:(p.route??[]).join(' | '),source:url,productSource:FDA+'?'+new URLSearchParams({search:'product_id:'+luceneQuote(key),limit:'1'})};
    result.fdaProducts.push({...base,packages:p.packaging?.length??0});
    for(const pack of p.packaging??[])result.fda.push({...base,ndc:normalizeNdc(pack.package_ndc),raw:pack.package_ndc||'',description:pack.description||'',first:pack.marketing_start_date||p.marketing_start_date||'',last:pack.marketing_end_date||p.marketing_end_date||'',sample:pack.sample===true?'Yes':'No'});
   }
   if(d.results.length===0&&skip<total)throw new Error('FDA returned an empty page before all records were retrieved.');
   skip+=d.results.length;if(total===0)break;
  }
 const packages=result.fda.filter(x=>x.raw);
 if(!result.fdaProducts.length)result.notes.push('openFDA returned no products for this name in the current finished human-drug directory.');
 else if(!packages.length)result.notes.push('openFDA returned products without package NDCs.');
 if(packages.some(x=>!x.ndc))result.notes.push('Original FDA package NDCs are included. NDC11 is blank for formats that cannot be converted unambiguously.');
 result.fdaState=packages.length?'Complete':'Zero NDCs';
 }catch(e){error(result,'openFDA',e);result.fdaState=signal?.aborted?'Stopped':'Partial';}
}
export function consolidate(results){
 const map=new Map();for(const r of results)for(const row of r.fda){if(!row.raw)continue;const key=row.ndc||row.raw;
  let d=map.get(key);if(!d){d={ndc:row.ndc,inputs:new Set(),raw:new Set(),products:new Set(),brands:new Set()};map.set(key,d);}
  d.inputs.add(r.input);d.raw.add(row.raw);if(row.product)d.products.add(row.product);if(row.brand)d.brands.add(row.brand);
 }
 return [...map.values()].map(d=>({...d,inputs:[...d.inputs],raw:[...d.raw],products:[...d.products],brands:[...d.brands]})).sort((a,b)=>(a.ndc||a.raw[0]).localeCompare(b.ndc||b.raw[0]));
}
export function summarize(r){return {input:r.input,inputType:INPUT_TYPES[r.inputType]||r.inputType,products:r.fdaProducts.length,ndc:consolidate([r]).length,ndc11:new Set(r.fda.map(x=>x.ndc).filter(Boolean)).size,searchFields:searchFields(r.inputType).join(' | '),state:r.fdaState,notes:[...r.notes,...r.errors].join(' | ')};}
export async function runBatch(drugs,options={},onUpdate=()=>{}){if(options.inputType&&!Object.hasOwn(INPUT_TYPES,options.inputType))throw new Error('Choose a supported input type.');const results=drugs.map(d=>({...makeResult({...d,inputType:options.inputType||'mixed'}),started:''})),get=options.get||createClient(options);for(let i=0;i<results.length;i++){if(options.signal?.aborted)break;const r=results[i];r.started=new Date().toISOString();onUpdate(results,i,`Looking up ${i+1} of ${results.length}: ${r.input}`);await lookupFda(r,{...options,get,progress:s=>onUpdate(results,i,s)});if(options.signal?.aborted){r.errors.push('Batch stopped; this drug may have incomplete results.');r.fdaState='Stopped';}r.finished=new Date().toISOString();onUpdate(results,i+1,`Finished ${r.input}`);}for(const r of results)if(!r.finished){r.notes.push('Not completed: batch stopped.');r.fdaState='Not processed';}return results;}
