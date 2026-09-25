export const RX='https://rxnav.nlm.nih.gov/REST';
const easternFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'short'});
export function easternTime(value,seconds=false){
 if(!value)return '';
 const date=new Date(value);if(Number.isNaN(date.getTime()))return '';
 const p=Object.fromEntries(easternFormatter.formatToParts(date).map(part=>[part.type,part.value]));
 return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute+(seconds?':'+p.second:'')+' '+p.timeZoneName;
}
const delay=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new DOMException('Stopped','AbortError'));const done=()=>{signal?.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,ms);function abort(){clearTimeout(timer);reject(new DOMException('Stopped','AbortError'));}signal?.addEventListener('abort',abort,{once:true});});

export class API {
 constructor(signal,fetcher=(url,options)=>fetch(url,options)){this.signal=signal;this.fetcher=fetcher;this.cache=new Map();this.slot=Promise.resolve();}
 async request(url){if(this.cache.has(url))return this.cache.get(url);const promise=this.fetchJSON(url);this.cache.set(url,promise);try{return await promise;}catch(e){this.cache.delete(url);throw e;}}
 async fetchJSON(url){for(let attempt=0;attempt<3;attempt++){
  this.signal?.throwIfAborted();const before=this.slot;this.slot=before.catch(()=>{}).then(()=>delay(220,this.signal)).catch(()=>{});await before;this.signal?.throwIfAborted();
  const timeout=new AbortController(),abort=()=>timeout.abort();this.signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,25000);
  try{const response=await this.fetcher(url,{signal:timeout.signal,headers:{Accept:'application/json'}});if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();if(data.error)throw new Error(typeof data.error==='string'?data.error:'API error');return data;}
  catch(e){if(this.signal?.aborted)throw new DOMException('Stopped','AbortError');if(attempt===2)throw new Error('RxNorm request failed: '+(e.name==='AbortError'?'request timed out':e.message));await delay(1000*(attempt+1),this.signal);}
  finally{clearTimeout(timer);this.signal?.removeEventListener('abort',abort);}
 }}
 rx(path){return this.request(RX+path);}
}

export async function parallel(items,limit,fn){let index=0,failed=false;const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(index<items.length&&!failed){const i=index++;try{await fn(items[i],i);}catch(e){failed=true;throw e;}}});const result=await Promise.allSettled(workers),error=result.find(r=>r.status==='rejected');if(error)throw error.reason;}

