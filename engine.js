import {RX,parallel} from './core.js';

export const PRODUCT_TYPES=['SCD','SBD','GPCK','BPCK'];
export const EXPAND_TYPES=['IN','PIN','MIN','BN'];
export const coverageLabel=mode=>mode==='history'?'Current + historical':'Current only';
export const coverageFormula=mode=>mode==='history'?'RxNorm current + historical':'RxNorm current';
export const namePath=(name,search=0)=>'/rxcui.json?name='+encodeURIComponent(name)+'&allsrc=0&search='+search;
export const propertiesPath=id=>'/rxcui/'+encodeURIComponent(id)+'/properties.json';
export const productsPath=id=>'/rxcui/'+encodeURIComponent(id)+'/related.json?tty=SCD+SBD+GPCK+BPCK';
export const ingredientsPath=id=>'/rxcui/'+encodeURIComponent(id)+'/related.json?tty=IN';
export const combinationLabel=include=>include===false?'Exclude combinations for single-ingredient searches':'Include combination products';
export const combinationApplies=row=>row.includeCombinations===false&&['IN','PIN'].includes(row.selected?.tty);
export const currentPath=id=>'/rxcui/'+encodeURIComponent(id)+'/ndcs.json';
export const historicalPath=id=>'/rxcui/'+encodeURIComponent(id)+'/allhistoricalndcs.json?history=2';
export const ndcStatus=n=>n.current?'Current association':n.currentComplete?'History API only':'Current check incomplete';
const validMonth=value=>/^\d{4}(0[1-9]|1[0-2])$/.test(value);
export function associationPeriod(evidence){
  const dated=evidence.filter(e=>validMonth(e.startDate)&&validMonth(e.endDate)&&e.startDate<=e.endDate);
  return {first:dated.map(e=>e.startDate).sort()[0]||'',last:dated.map(e=>e.endDate).sort().at(-1)||''};
}
export function parseNames(text){
  const seen=new Set(),names=[];
  for(const line of String(text??'').split(/\r?\n/)){
    const name=line.trim().replace(/_/g,' ').replace(/\s+/g,' ');
    if(name&&!seen.has(name.toLowerCase())){seen.add(name.toLowerCase());names.push(name);}
  }
  if(!names.length)throw new Error('Enter at least one drug name.');
  if(names.length>100)throw new Error('Use up to 100 names per batch.');
  if(names.some(n=>n.length>300))throw new Error('Keep each drug name under 300 characters. Use one name per line.');
  return names;
}
export function makeDrug(input){
  return {input,searchName:input,concepts:[],selected:null,match:'',products:[],productCandidates:[],includeCombinations:true,ndcs:[],requests:[],errors:[],notes:[],stage:'Waiting',done:false,productsDone:0,currentComplete:false,coverage:'history',started:'',finished:''};
}
export async function requestStep(row,api,step,path){
  const request={step,url:RX+path,status:'pending',error:''};row.requests.push(request);
  try{
    const data=await api.rx(path);
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Unexpected API response');
    request.status='completed';return data;
  }catch(e){request.status=e.name==='AbortError'?'stopped':'failed';request.error=e.message;throw e;}
}
export async function resolveDrug(row,api,update=()=>{}){
  row.stage='Matching name';row.started=new Date().toISOString();update();
  let ids=[];
  for(const search of [0,1]){
    const data=await requestStep(row,api,search===0?'Exact name':'Normalized name',namePath(row.searchName,search));
    ids=[...new Set((data.idGroup?.rxnormId||[]).map(String))];
    if(ids.length){row.match=search===0?'Exact RxNorm name / synonym':'Normalized RxNorm name';break;}
  }
  if(!ids.length){row.stage='No name match';row.notes.push('No active RxNorm name match. Try a synonym or a specific generic / brand name. No fuzzy matching was used.');row.done=true;return;}
  for(const id of ids){
    const data=await requestStep(row,api,'Concept properties',propertiesPath(id)),p=data.properties;
    const accepted=!!p?.name&&String(p.rxcui)===id&&p.suppress!=='Y'&&[...EXPAND_TYPES,...PRODUCT_TYPES].includes(p.tty);
    row.concepts.push({rxcui:id,name:p?.name||'',tty:p?.tty||'',accepted,source:RX+propertiesPath(id)});
  }
  const accepted=row.concepts.filter(c=>c.accepted);
  if(ids.length>1){row.stage='Choose a match';row.notes.push('Multiple RxCUIs were returned. Select the intended concept before retrieving NDCs.');row.done=true;return;}
  if(!accepted.length){row.stage='Unsupported concept';row.notes.push('The name did not resolve to an active ingredient, brand, drug product or pack. Try another name.');row.done=true;return;}
  row.selected=accepted[0];
  if(row.match.startsWith('Normalized'))row.notes.push('RxNorm normalized this name; check the displayed concept, especially salt forms.');
  update();
}
export async function expandProducts(row,api,update=()=>{}){
  const concept=row.selected;
  if(!concept)throw new Error('Select a drug concept first.');
  row.stage='Finding drug products';update();
  if(PRODUCT_TYPES.includes(concept.tty)){
    row.products=[{rxcui:concept.rxcui,name:concept.name,tty:concept.tty,source:concept.source}];
    row.notes.push('A specific product / pack was matched. This lookup covers that product only. Use its ingredient name for broader coverage.');
  }else{
    const path=productsPath(concept.rxcui),data=await requestStep(row,api,'Related products',path),products=new Map();
    for(const group of data.relatedGroup?.conceptGroup||[])for(const p of group.conceptProperties||[]){
      const tty=p.tty||group.tty;
      if(p.rxcui&&PRODUCT_TYPES.includes(tty))products.set(String(p.rxcui),{rxcui:String(p.rxcui),name:p.name||'',tty,source:RX+path});
    }
    row.products=[...products.values()].sort((a,b)=>a.rxcui.localeCompare(b.rxcui));
  }
  if(!row.products.length){row.stage='No related products';row.notes.push('No active SCD, SBD, GPCK or BPCK products returned. Older disconnected products may still exist.');row.done=true;}
  update();
}
export async function filterProducts(row,api,update=()=>{}){
  row.productCandidates=row.products;
  if(!combinationApplies(row)){
    for(const p of row.products)p.selection='Included — combination filter not applied';
    if(row.includeCombinations===false)row.notes.push('The combination filter applies only to single-ingredient (IN / PIN) searches. This explicitly matched brand, combination or product keeps its original scope.');
    return;
  }
  row.stage='Checking product ingredients';
  // Preserve every candidate for export, but query NDCs only after its ingredients are confirmed.
  row.products=[];
  for(const p of row.productCandidates)p.selection='Not checked';
  update();
  await parallel(row.productCandidates,3,async product=>{
    product.ingredientSource=RX+ingredientsPath(product.rxcui);
    try{
      const data=await requestStep(row,api,'Product ingredients',ingredientsPath(product.rxcui)),ingredients=new Map();
      for(const group of data.relatedGroup?.conceptGroup||[])for(const p of group.conceptProperties||[]){
        if((p.tty||group.tty)==='IN'&&p.rxcui&&p.suppress!=='Y')ingredients.set(String(p.rxcui),{rxcui:String(p.rxcui),name:p.name||''});
      }
      product.ingredients=[...ingredients.values()].sort((a,b)=>a.rxcui.localeCompare(b.rxcui));
      if(!product.ingredients.length)throw new Error('No base ingredients returned; single-ingredient status could not be confirmed.');
      product.selection=product.ingredients.length===1?'Included — single ingredient':'Excluded — multiple ingredients';
    }catch(e){
      product.selection=e.name==='AbortError'?'Not checked — stopped':'Not included — ingredients unconfirmed';
      if(e.name==='AbortError')throw e;
      row.errors.push('Product ingredients · '+product.rxcui+': '+e.message);
    }finally{update();}
  });
  row.products=row.productCandidates.filter(p=>p.selection==='Included — single ingredient');
  const excluded=row.productCandidates.filter(p=>p.selection==='Excluded — multiple ingredients').length;
  row.notes.push('Combination filter: '+row.products.length+' single-ingredient products / packs retained; '+excluded+' with multiple ingredients excluded. Distinct base ingredients are counted across each whole pack.');
  if(!row.products.length){row.stage=row.errors.length?'Partial':'No single-ingredient products';row.done=true;}
  update();
}
export async function collectNDCs(row,api,update=()=>{}){
  row.stage='Retrieving NDCs';row.currentComplete=false;let currentFailed=false;
  update();
  await parallel(row.products,3,async product=>{
    const values=new Map();
    const record=value=>{
      const ndc=String(value);
      if(!values.has(ndc)){
        if(!/^\d{11}$/.test(ndc))row.errors.push('Unexpected NDC format for product '+product.rxcui+'; raw value retained.');
        const item={ndc,input:row.input,productRxcui:product.rxcui,productName:product.name,tty:product.tty,current:false,currentSource:'',historySource:'',evidence:[]};
        values.set(ndc,item);row.ndcs.push(item);
      }
      return values.get(ndc);
    };
    try{
      try{
        const data=await requestStep(row,api,'Current NDCs',currentPath(product.rxcui));
        for(const value of data.ndcGroup?.ndcList?.ndc||[]){const item=record(value);item.current=true;item.currentSource=RX+currentPath(product.rxcui);}
      }catch(e){if(e.name==='AbortError')throw e;currentFailed=true;row.errors.push('Current NDCs · '+product.rxcui+': '+e.message);}
      if(row.coverage==='history'){
        try{
          const source=RX+historicalPath(product.rxcui),data=await requestStep(row,api,'Historical NDCs',historicalPath(product.rxcui));
          for(const group of data.historicalNdcConcept?.historicalNdcTime||[])for(const time of group.ndcTime||[])for(const value of time.ndc||[]){
            const item=record(value),e={productRxcui:product.rxcui,associatedRxcui:String(group.rxcui||''),route:group.status||'',startDate:time.startDate||'',endDate:time.endDate||'',source};
            item.historySource=source;
            if(!item.evidence.some(v=>JSON.stringify(v)===JSON.stringify(e)))item.evidence.push(e);
            if(!validMonth(e.startDate)||!validMonth(e.endDate)||e.startDate>e.endDate)row.errors.push('Missing or invalid history dates · '+product.rxcui+'; raw values retained.');
          }
        }catch(e){if(e.name==='AbortError')throw e;row.errors.push('Historical NDCs · '+product.rxcui+': '+e.message);}
      }
    }finally{row.productsDone++;update();}
  });
  row.currentComplete=!currentFailed;row.done=true;
  row.stage=row.errors.length?'Partial':row.ndcs.length?'Mapped':'No NDCs returned';
  if(!row.ndcs.length&&!row.errors.length)row.notes.push('The selected NDC APIs returned no codes for the retrieved products.');
  update();
}
export async function lookupDrug(row,api,update=()=>{},selectedId=''){
  row.finished='';
  try{
    if(selectedId){
      const candidate=row.concepts.find(c=>c.rxcui===selectedId&&c.accepted);
      if(!candidate)throw new Error('Choose an available RxNorm concept.');
      row.selected=candidate;row.done=false;row.finished='';row.match+=' · user selected';
      row.notes=row.notes.filter(n=>!n.startsWith('Multiple RxCUIs'));
    }else await resolveDrug(row,api,update);
    if(!row.done)await expandProducts(row,api,update);
    if(!row.done)await filterProducts(row,api,update);
    if(!row.done)await collectNDCs(row,api,update);
  }catch(e){
    row.stage=e.name==='AbortError'?'Stopped':'Failed';row.errors.push(e.message);row.done=false;
    if(e.name==='AbortError')throw e;
  }finally{row.finished=new Date().toISOString();update();}
}
export function consolidate(rows){
  const records=new Map();
  const get=(row,ndc)=>{
    const key=JSON.stringify([row.input,ndc]);
    if(!records.has(key))records.set(key,{input:row.input,ndc,concept:row.selected,products:[],productRxcuis:[],productNames:[],termTypes:[],currentSources:[],historySources:[],evidence:[],current:false,currentComplete:row.currentComplete});
    return records.get(key);
  };
  for(const row of rows){
   for(const n of row.ndcs){
    const out=get(row,n.ndc);out.current||=n.current;
    if(!out.products.some(p=>p.rxcui===n.productRxcui))out.products.push({rxcui:n.productRxcui,name:n.productName});
    for(const [field,value] of [['productRxcuis',n.productRxcui],['productNames',n.productName],['termTypes',n.tty],['currentSources',n.currentSource],['historySources',n.historySource]])if(value&&!out[field].includes(value))out[field].push(value);
    for(const e of n.evidence)if(!out.evidence.some(v=>JSON.stringify(v)===JSON.stringify(e)))out.evidence.push(e);
   }
  }
  return [...records.values()].sort((a,b)=>a.input.localeCompare(b.input)||a.ndc.localeCompare(b.ndc));
}
export const rowStatus=row=>row.errors.length?(row.stage==='Stopped'?'Stopped':'Partial'):row.stage;
export function runStatus(rows,meta={}){
  if(meta.busy)return 'In progress';
  if(meta.stopped||meta.errors?.length||rows.some(r=>!r.done||r.errors.length))return 'Partial';
  if(rows.some(r=>!r.selected||r.stage==='No related products'))return 'Needs review';
  return 'Completed';
}
