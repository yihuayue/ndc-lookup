import {consolidate,associationPeriod,ndcStatus,rowStatus,runStatus,coverageLabel,coverageFormula,combinationLabel,combinationApplies} from './engine.js';
import {easternTime} from './core.js';

export const METHOD_ROWS=[
 ['Purpose','Resolve generic names, brand names or ingredients through RxNorm and retrieve associated NDCs. Results are deduplicated by input name and NDC.'],
 ['Source selection','RxNorm provides one terminology and NDC source for the drug-name and ATC tools, with consistent product relationships and historical-association definitions. This defined scope does not claim exhaustive NDC coverage.'],
 ['Coverage modes','Current + historical = RxNorm current and historical NDC associations. Current only = RxNorm current NDC associations. These are retrieval rules, not determinations of marketing availability.'],
 ['Name matching','Exact names / synonyms first (search=0), then normalized names (search=1), allsrc=0. No fuzzy or substring search. Multiple RxCUIs require user selection. One name per line; underscores become spaces; duplicate inputs are removed without regard to case.'],
 ['Concept scope','IN, PIN, MIN and BN are expanded to active SCD, SBD, GPCK and BPCK products. An entered specific product / pack is queried directly. Salt-specific names may give narrower coverage than the base ingredient.'],
 ['Products','Combination products are included by default. If disabled, single-ingredient (IN / PIN) searches retain only products / packs with exactly one distinct base ingredient, identified by related.json?tty=IN. Ingredients are counted across the whole pack; salt forms are not counted separately. Explicit brands, combination names (MIN) and specific products / packs keep their matched scope.'],
 ['Combination filter limitations','The filter uses current RxNorm product relationships before retrieving current or historical NDCs. It does not independently reclassify historical remapped concepts. Products with missing or failed ingredient checks are withheld and the lookup is marked Partial. This tool does not establish ATC / CYP classification, route eligibility, formulation eligibility or study inclusion.'],
 ['Historical retrieval','getAllHistoricalNDCs(history=2) returns direct and indirect / remapped associations for each retrieved product. The entry point uses active name and product relationships and may miss disconnected older products. Results are not a complete archive of all historical NDCs.'],
 ['Dates','Start and end dates are RxNorm association release months (YYYYMM). They are not marketing, dispensing or clinical exposure dates. First / last summaries can span gaps; original intervals and remapped concepts are listed in the Historical association details column of NDC mapping. No date filter is applied.'],
 ['Lookup timestamps','Displayed and exported lookup timestamps use US Eastern Time (America/New_York), with EDT or EST according to daylight saving time. Export filenames use the Eastern calendar date. RxNorm association release months are unchanged.'],
 ['Association labels','Current association: returned by RxNorm getNDCs for a retrieved product. History API only: returned only by the RxNorm historical API for these products; not a global obsolete determination. Current check incomplete: current API requests did not all finish successfully.'],
 ['NDC mapping','One row per entered drug and distinct NDC, preserving many-to-many product relationships. Unique NDC counts across all inputs may be smaller than the sum of per-drug counts.'],
 ['Workbook contents','Drug summary: one row per input, lookup outcomes, counts, selected options and errors. NDC mapping: one row per input / NDC, products, API links and historical association details. Methods: run metadata, definitions and API documentation.'],
 ['API evidence','NDC mapping includes the product, ingredient (when checked), current NDC and historical NDC API URLs supporting each mapping. Historical association details identify the queried and associated product RxCUIs, direct / indirect route and each release-month interval. Drug summary retains lookup status and notes / errors, including for drugs with no NDCs.'],
 ['Product exclusions','Drug summary records candidate, retained, excluded-combination and unconfirmed product counts. Excluded products do not contribute NDC rows. Detailed excluded-product inventories and the full successful-request log are not exported.'],
 ['Status','Completed means the requested API workflow finished, not exhaustive historical coverage. No name match / unsupported concepts / no related products need review. Failed or stopped retrievals are partial, never confirmed zero results.'],
 ['Formatting','NDCs are stored as text, preserving leading zeros. Unexpected API formats are retained as raw values with blank NDC11 and a partial status.'],
 ['Privacy','Drug names are sent directly to NLM. Results and this workbook are created in the browser. No API key or additional backend is used.'],
 ['Name API','https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.findRxcuiByString.html'],
 ['Products API','https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getRelatedByType.html'],
 ['Current NDC API','https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getNDCs.html'],
 ['Historical NDC API','https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getAllHistoricalNDCs.html']
];
export function mappingTable(rows,meta={}){
 return {headers:['Input drug','NDC11','Raw API NDC','Source','RxNorm current','RxNorm history returned','Matched RxCUI','Matched RxNorm name','Concept type','Product RxCUIs','Product names','RxNorm association for retrieved products','First RxNorm release month','Last RxNorm release month','Current RxNorm API URLs','Historical RxNorm API URLs','Product API URLs','Ingredient API URLs','Historical association details','Coverage formula','RxNorm release','Retrieved Eastern Time','Combination products setting','Combination filter applied'],rows:consolidate(rows).map(n=>{
  const period=associationPeriod(n.evidence);
  const row=rows.find(r=>r.input===n.input);
  const products=row.products.filter(p=>n.productRxcuis.includes(p.rxcui));
  const urls=field=>[...new Set(products.map(p=>p[field]).filter(Boolean))].join('\n');
  const history=n.evidence.map(e=>'Queried '+e.productRxcui+' → associated '+e.associatedRxcui+' ('+e.route+'): '+e.startDate+'–'+e.endDate).join('\n');
  return [n.input,/^\d{11}$/.test(n.ndc)?n.ndc:'',n.ndc,'RxNorm',n.current?'Yes':n.currentComplete?'No':'Not established',n.historySources.length?'Yes':'No',n.concept?.rxcui,n.concept?.name,n.concept?.tty,n.productRxcuis.join('; '),n.productNames.join(' | '),ndcStatus(n),period.first,period.last,n.currentSources.join('\n'),n.historySources.join('\n'),urls('source'),urls('ingredientSource'),history,coverageFormula(meta.coverage||rows[0]?.coverage),meta.version,easternTime(meta.retrieved,true),combinationLabel(row.includeCombinations),combinationApplies(row)?'Yes':'No'];
 })};
}
export function buildSheets(rows,meta={}){
 const sheets=[],add=(name,headers,data)=>sheets.push({name,rows:[headers,...data]});
 add('Drug summary',['Input drug','Matched RxCUI','Matched RxNorm name','Concept type','Name match method','Candidate RxCUIs','RxNorm products retained','Unique NDCs','Current NDCs','History API only NDCs','Lookup status','Notes / errors','Started Eastern Time','Finished Eastern Time','Combination products setting','Combination filter applied','Candidate products','Excluded combination products','Products not confirmed'],rows.map(r=>{
  const ns=consolidate([r]);
  return [r.input,r.selected?.rxcui,r.selected?.name,r.selected?.tty,r.match,r.concepts.map(c=>`${c.rxcui}: ${c.name} (${c.tty})`).join(' | '),r.products.length,ns.length,ns.filter(n=>n.current).length,r.currentComplete?ns.filter(n=>!n.current).length:'Not established',rowStatus(r),[...new Set([...r.notes,...r.errors])].join(' | '),easternTime(r.started,true),easternTime(r.finished,true),combinationLabel(r.includeCombinations),combinationApplies(r)?'Yes':'No',r.productCandidates.length,r.productCandidates.filter(p=>p.selection==='Excluded — multiple ingredients').length,r.productCandidates.filter(p=>p.selection.startsWith('Not ')).length];
 }));
 const mapping=mappingTable(rows,meta);add('NDC mapping',mapping.headers,mapping.rows);
 add('Methods',['Topic','Description'],[
  ['Tool version','2.3.0'],['Run status',runStatus(rows,meta)],['Coverage',coverageLabel(meta.coverage||rows[0]?.coverage)],['Coverage formula',coverageFormula(meta.coverage||rows[0]?.coverage)],['Combination products setting',combinationLabel(meta.includeCombinations??rows[0]?.includeCombinations)],['RxNorm release',meta.version||'Unavailable'],['Lookup started Eastern Time',easternTime(meta.retrieved,true)],['Exported Eastern Time',easternTime(new Date(),true)],['Run notes / errors',(meta.errors||[]).join(' | ')],...METHOD_ROWS
 ]);
 return sheets;
}
