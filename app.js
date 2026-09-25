import {API,RX,parallel,easternTime} from './core.js';
import {parseNames,makeDrug,lookupDrug,consolidate,coverageLabel,ndcStatus,rowStatus,runStatus,propertiesPath,combinationApplies} from './engine.js';
import {buildSheets} from './export.js';
import {xlsxBytes} from './xlsx.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,label)=>'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>';
const state={rows:[],coverage:'history',includeCombinations:true,version:'',retrieved:'',errors:[],busy:false,stopped:false,tab:'drugs',page:0};
let controller,api,renderTimer;
const queueRender=()=>{if(!renderTimer)renderTimer=setTimeout(()=>{renderTimer=null;render();},250);};
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';$('message').hidden=!text;}
function busy(value){
 state.busy=value;
 for(const id of ['names','coverage','include-combinations','lookup'])$(id).disabled=value;
 $('lookup').textContent=value?'Finding NDCs…':'Find NDCs ↗';$('cancel').hidden=!value;$('progress-box').hidden=!value;
}
const codeCoverage=n=>n.current?'Current':n.currentComplete?'Historical':'Current coverage unconfirmed';
const conceptType=tty=>({IN:'Ingredient',PIN:'Ingredient form',MIN:'Combination ingredient',BN:'Brand',SCD:'Generic product',SBD:'Branded product',GPCK:'Generic pack',BPCK:'Branded pack'}[tty]||'Drug');
const displayStatus=row=>({'Unsupported concept':'Name needs review'}[rowStatus(row)]||rowStatus(row));
function render(){
 const ns=consolidate(state.rows),term=$('filter').value.trim().toLowerCase();
 $('drug-count').textContent=state.rows.length.toLocaleString();
 $('current-count').textContent=new Set(ns.filter(n=>n.current).map(n=>n.ndc)).size.toLocaleString();
 $('ndc-count').textContent=new Set(ns.map(n=>n.ndc)).size.toLocaleString();
 $('empty').hidden=!!state.rows.length;$('results').hidden=!state.rows.length;
 $('export-excel').disabled=state.busy||!state.rows.length;
 $('run-status').textContent=runStatus(state.rows,state);
 $('result-title').textContent=state.rows.length===1?state.rows[0].input:state.rows.length+' drug names';
 $('result-meta').textContent=coverageLabel(state.coverage)+(state.includeCombinations?'':' · Single-ingredient filter on')+(state.retrieved?' · Retrieved '+easternTime(state.retrieved):'');
 for(const name of ['drugs','ndcs']){$(name+'-panel').hidden=state.tab!==name;$('tab-'+name).setAttribute('aria-selected',String(state.tab===name));$('tab-'+name).tabIndex=state.tab===name?0:-1;}
 $('drugs-body').innerHTML=state.rows.map((r,index)=>({r,index})).filter(({r})=>[r.input,r.selected?.name,r.selected?.rxcui,rowStatus(r),...r.notes,...r.errors].join(' ').toLowerCase().includes(term)).map(({r,index})=>{
  const codes=consolidate([r]);
  const filterNote=combinationApplies(r)?r.productCandidates.filter(p=>p.selection==='Excluded — multiple ingredients').length+' combination products excluded.':r.includeCombinations===false&&r.selected?'Combination filter does not apply to this matched name.':'';
  const selection=(r.stage==='Choose a match')?'<label class="subtle" for="choice-'+index+'">Choose the intended drug</label><select id="choice-'+index+'" '+(state.busy?'disabled':'')+'><option value="">Select a match…</option>'+r.concepts.filter(c=>c.accepted).map(c=>'<option value="'+esc(c.rxcui)+'">'+esc(c.name+' · '+conceptType(c.tty))+'</option>').join('')+'</select><button type="button" class="row-button" data-resolve="'+index+'" '+(state.busy?'disabled':'')+'>Use selected match</button>':'';
  return '<tr><td><strong>'+esc(r.input)+'</strong></td><td>'+(r.selected?'<strong>'+esc(r.selected.name)+'</strong><small>'+esc(conceptType(r.selected.tty))+'</small>':selection||'<span class="subtle">'+(r.finished?'No standardized match':'Pending')+'</span>')+'</td><td><button type="button" class="row-button" data-drug="'+index+'" '+(!codes.length?'disabled':'')+'>'+codes.length.toLocaleString()+' NDCs</button><small>'+codes.filter(n=>n.current).length.toLocaleString()+' current</small>'+(state.coverage==='history'?'<small>'+codes.filter(n=>codeCoverage(n)==='Historical').length.toLocaleString()+' historical</small>':'')+'</td><td><span class="tag'+(r.errors.length||(r.done&&r.stage!=='Mapped')?' warn':'')+'">'+esc(displayStatus(r))+'</span>'+(filterNote?'<small>'+esc(filterNote)+'</small>':'')+(r.errors.length?'<p class="subtle">Some results are incomplete. Export the workbook for request details.</p>':'')+'</td></tr>';
 }).join('')||'<tr><td colspan="4" class="nodata">No matching drug names.</td></tr>';
 const filtered=ns.filter(n=>[n.input,n.ndc,n.concept?.name,...n.productRxcuis,...n.productNames,ndcStatus(n),codeCoverage(n)].join(' ').toLowerCase().includes(term));
 const pages=Math.max(1,Math.ceil(filtered.length/50));state.page=Math.min(state.page,pages-1);
 $('ndcs-body').innerHTML=filtered.slice(state.page*50,state.page*50+50).map(n=>{
  const descriptions=n.products.map(p=>({name:p.name,url:RX+propertiesPath(p.rxcui)}));
  const products=[...new Map(descriptions.filter(p=>p.name).map(p=>[p.name.toLowerCase(),p])).values()].map(p=>'<div>'+link(p.url,p.name)+'</div>');
  return '<tr><td><strong class="code">'+esc(n.ndc)+'</strong></td><td>'+esc(n.input)+'</td><td>'+products.slice(0,2).join('')+(products.length>2?'<details class="product-details"><summary>'+(products.length-2)+' more products</summary>'+products.slice(2).join('')+'</details>':'')+'</td><td><span class="tag'+(codeCoverage(n)==='Current'?'':' warn')+'">'+esc(codeCoverage(n))+'</span></td></tr>';
 }).join('')||'<tr><td colspan="4" class="nodata">'+(state.busy?'NDCs will appear as product requests finish.':'No NDC rows match this view. Check the drug summary for lookup outcomes.')+'</td></tr>';
 $('page-label').textContent=filtered.length.toLocaleString()+' drug–NDC rows · Page '+(state.page+1)+' of '+pages;$('prev').disabled=!state.page;$('next').disabled=state.page===pages-1;
 const finished=state.rows.filter(r=>r.finished).length,products=state.rows.reduce((a,r)=>a+r.products.length,0),done=state.rows.reduce((a,r)=>a+r.productsDone,0);
 $('progress-text').textContent=finished+' / '+state.rows.length+' drug lookups finished';$('progress-count').textContent=done+' / '+products+' products checked';$('progress').value=state.rows.length?(finished/state.rows.length)*100:0;
}
async function lookup(){
 if(state.busy)return;
 const input=$('names'),useExamples=!input.value.trim();
 let names;try{names=parseNames(useExamples?input.placeholder:input.value);}catch(e){message(e.message,true);return;}
 if(useExamples)input.value=names.join('\n');
 Object.assign(state,{rows:names.map(makeDrug),coverage:$('coverage').value,includeCombinations:$('include-combinations').checked,version:'',retrieved:new Date().toISOString(),errors:[],stopped:false,tab:'drugs',page:0});
 for(const r of state.rows){r.coverage=state.coverage;r.includeCombinations=state.includeCombinations;}
 $('filter').value='';controller=new AbortController();api=new API(controller.signal);busy(true);render();message('Finding drug products and NDCs…');
 try{
  try{state.version=(await api.rx('/version.json')).version||'';if(!state.version)throw new Error('No release value returned');}
  catch(e){if(e.name==='AbortError')throw e;state.errors.push('RxNorm release unavailable: '+e.message);}
  await parallel(state.rows,2,row=>lookupDrug(row,api,queueRender));
 }catch(e){state.stopped=e.name==='AbortError';if(!state.stopped)state.errors.push(e.message);}
 finally{
  if(state.stopped)for(const r of state.rows)if(!r.done){r.stage='Stopped';if(!r.errors.includes('Lookup stopped before completion'))r.errors.push('Lookup stopped before completion');}
  busy(false);render();finishMessage();
 }
}
function finishMessage(){
 const status=runStatus(state.rows,state),count=new Set(consolidate(state.rows).map(n=>n.ndc)).size;
 message(status==='Partial'?'Partial lookup: '+count.toLocaleString()+' NDCs retrieved. Check request outcomes; available results can be exported.':'Finished: '+count.toLocaleString()+' unique NDCs. Ready to export.',status==='Partial');
}
async function resolveSelection(index,id){
 if(state.busy)return;
 if(!id){message('Choose a concept from the match list first.',true);return;}
 if(controller.signal.aborted){controller=new AbortController();api=new API(controller.signal);}
 // Continue the original batch and its release snapshot; controls are disabled during retrieval.
 busy(true);render();message('Retrieving NDCs for the selected match…');
 try{await lookupDrug(state.rows[index],api,queueRender,id);}catch(e){if(e.name==='AbortError')state.stopped=true;else state.errors.push(e.message);}
 finally{busy(false);render();finishMessage();}
}
function setTab(name){state.tab=name;state.page=0;render();}
function download(){
 try{
  const content=xlsxBytes(buildSheets(state.rows,state));
  const status=runStatus(state.rows,state),suffix=status==='Completed'?'':status==='Partial'?'_PARTIAL':'_REVIEW';
  const filename='Drug_NDC_'+state.coverage+'_'+easternTime(state.retrieved).slice(0,10)+suffix+'.xlsx';
  const blob=new Blob([content],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob);
  const dialog=document.createElement('dialog');dialog.className='export-dialog';dialog.setAttribute('aria-label','Download results');
  dialog.innerHTML='<h2>Your workbook is ready</h2><p class="export-name">'+esc(filename)+'</p><p>One workbook with three sheets: Drug summary, NDC mapping (including API links), and Methods. NDCs are stored as text.</p><div class="export-actions"><a class="secondary export-file" href="'+esc(url)+'" download="'+esc(filename)+'">Download Excel workbook ↗</a></div><button type="button" class="export-close">Close</button>';
  dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{URL.revokeObjectURL(url);dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();
 }catch(e){message('Export failed: '+e.message,true);}
}
$('lookup-form').addEventListener('submit',e=>{e.preventDefault();lookup();});
$('cancel').addEventListener('click',()=>controller?.abort());
for(const name of ['drugs','ndcs']){
 $('tab-'+name).addEventListener('click',()=>setTab(name));
 $('tab-'+name).addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const next=name==='drugs'?'ndcs':'drugs';setTab(next);$('tab-'+next).focus();}});
}
$('filter').addEventListener('input',()=>{state.page=0;render();});$('prev').addEventListener('click',()=>{state.page--;render();});$('next').addEventListener('click',()=>{state.page++;render();});
$('drugs-body').addEventListener('click',e=>{
 const drug=e.target.closest('[data-drug]'),choice=e.target.closest('[data-resolve]');
 if(drug){$('filter').value=state.rows[Number(drug.dataset.drug)].input;setTab('ndcs');}
 if(choice)resolveSelection(Number(choice.dataset.resolve),$('choice-'+choice.dataset.resolve).value);
});
$('export-excel').addEventListener('click',download);
render();
