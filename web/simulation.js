// Data acquisition and email delivery are simulated; user-entered configuration stays on the server.
let monitoringSimulation=true,simulationEpoch=0;
try{monitoringSimulation=(localStorage.getItem('kaska-simulation')||localStorage.getItem('kaska-monitoring-simulation'))!=='off'}catch{}
let simulationResults={};
let simulationIdSequence=0;
// IDs for fictional local results only; these are never authentication tokens.
function simulationResultId(){
 const id=typeof globalThis.crypto?.randomUUID==='function'?globalThis.crypto.randomUUID():Date.now().toString(36)+'-'+(++simulationIdSequence).toString(36)+'-'+Math.random().toString(36).slice(2);
 return 'sim-'+id;
}
try{simulationResults=JSON.parse(sessionStorage.getItem('kaska-data-simulation-results')||'{}')}catch{}
const simulatedFetchPaths=new Set(['discover/contacts/search','prospecting/search','prospecting/verify','signals/scan','signals/discovery/start','signals/discovery/cancel','signals/monitoring/companies','research','ai/proof-points','library/discover','library/add','sync']);
function shouldSimulateRequest(path,data){
 if(path==='prospecting/candidates/bulk'&&String(data?.id).startsWith('sim-')){
  if(!monitoringSimulation)throw Error('Włącz symulację, aby zmieniać fikcyjne wyniki.');return true;
 }
 if(path==='prospecting/contacts/add'&&String(data?.id).startsWith('sim-')){
  if(!monitoringSimulation)throw Error('Włącz symulację, aby dodać fikcyjne kontakty.');
  return true;
 }
 if(monitoringSimulation&&path==='campaign/status')return true;
 if(path==='contacts/tags/bulk'&&Array.isArray(data?.ids)&&data.ids.length&&data.ids.every(id=>Number.isInteger(id)&&id<0)){
  if(!monitoringSimulation)throw Error('Włącz symulację, aby zmieniać fikcyjne kontakty.');
  return true;
 }
 if(path==='discover/contacts/add'&&String(data?.id).startsWith('sim-')){
  if(!monitoringSimulation)throw Error('Włącz symulację, aby dodać fikcyjne kontakty.');
  return true;
 }
 if(['contact/group','contact/tags','contact/status'].includes(path)&&state.contacts.some(c=>c.simulated&&c.id<0&&c.id===data?.id))return true;
 if(path==='prospecting/draft'&&String(data?.id).startsWith('sim-'))throw Error('Wyniki symulacji są fikcyjne. Nie można tworzyć z nich rzeczywistych kampanii.');
 return monitoringSimulation&&simulatedFetchPaths.has(path);
}
function fetchedSimulation(projectId=state.seller_project.id){return simulationResults[projectId]||={runs:[],candidates:[],materials:[],libraryProjects:[],jobs:[]}}
function simulationContactResults(project,projects){
 const key='contacts:'+(project.share_contacts?'shared':project.id);
 if(!simulationResults[key]){
  const owners=project.share_contacts?projects.filter(row=>row.share_contacts):[project],unique=new Map();
  for(const owner of owners)for(const contact of simulationResults[owner.id]?.contacts||[])if(!unique.has(contact.email.toLowerCase()))unique.set(contact.email.toLowerCase(),contact);
  simulationResults[key]={contacts:[...unique.values()].map((contact,index)=>({...contact,id:-index-1}))};
 }
 return simulationResults[key];
}
function saveSimulationResults(){try{sessionStorage.setItem('kaska-data-simulation-results',JSON.stringify(simulationResults))}catch{}}
async function saveSimulationMode(enabled,csrf){
 const response=await fetch('/api/data-simulation',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({enabled})});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Nie udało się zmienić symulacji.');return result.enabled;
}
async function loadAppState(){
 const response=await fetch('/api/state');if(!response.ok)throw Error('Nie można połączyć się z aplikacją');
 const snapshot=await response.json();
 if(snapshot.data_simulation===null)snapshot.data_simulation=await saveSimulationMode(monitoringSimulation,snapshot.csrf);
 else monitoringSimulation=snapshot.data_simulation;
 try{localStorage.setItem('kaska-simulation',monitoringSimulation?'on':'off');localStorage.setItem('kaska-monitoring-simulation',monitoringSimulation?'on':'off')}catch{}
 if(!monitoringSimulation)return snapshot;
 const results=fetchedSimulation(snapshot.seller_project.id),contactResults=simulationContactResults(snapshot.seller_project,snapshot.seller_projects);
 if(results){
  const demoContacts=(contactResults.contacts||[]).filter(contact=>!snapshot.contacts.some(real=>real.email.toLowerCase()===contact.email.toLowerCase()));
  demoContacts.forEach(contact=>contact.tags=contactTags(contact));
  snapshot.contacts=[...demoContacts,...snapshot.contacts];snapshot.totals.contacts+=demoContacts.length;
  const knownTags=new Map((snapshot.contact_tags||[]).map(tag=>[tag.toLocaleLowerCase(),tag]));
  demoContacts.flatMap(contact=>contact.tags).forEach(tag=>{if(!knownTags.has(tag.toLocaleLowerCase()))knownTags.set(tag.toLocaleLowerCase(),tag)});
  snapshot.contact_tags=[...knownTags.values()].sort((a,b)=>a.localeCompare(b));
  snapshot.contact_groups=[...new Set([...(snapshot.contact_groups||[]),...demoContacts.map(c=>c.target_group).filter(Boolean)])].sort((a,b)=>a.localeCompare(b));
  snapshot.prospecting.runs=[...results.runs,...snapshot.prospecting.runs];
  snapshot.prospecting.candidates=[...results.candidates,...snapshot.prospecting.candidates];
  snapshot.library.materials=[...snapshot.library.materials,...results.materials];
  snapshot.library.projects=[...snapshot.library.projects,...results.libraryProjects.filter(p=>!snapshot.library.projects.some(existing=>existing.website===p.website))];
  snapshot.signals.discovery.jobs=[...results.jobs,...snapshot.signals.discovery.jobs];
 }
 snapshot.prospecting.hunter=true;
 const demo=snapshot.signals.sources.filter(s=>s.enabled).flatMap(source=>simulationSignals(source).map(signal=>({...signal,company:source.company||'',status:'new',scope:source.company?'company':'market'})));
 snapshot.signals.items=[...demo,...snapshot.signals.items];snapshot.signals.counts.new=(snapshot.signals.counts.new||0)+demo.length;
 return applyDeliverySimulation(snapshot);
}
async function simulationApi(path,data={}){
 const results=fetchedSimulation(data.project_id??state.seller_project.id),contactResults=simulationContactResults(state.seller_project,state.seller_projects),now=Date.now()/1000;let result;
 if(path==='discover/contacts/search'){
  const names=['Anna Kowalska','Piotr Nowak','Marta Wiśniewska','Tomasz Wójcik','Katarzyna Zielińska','Michał Kamiński','Agnieszka Lewandowska','Paweł Dąbrowski','Magdalena Szymańska','Krzysztof Woźniak'],roles=['Operations Manager','CEO','IT Director','Sales Director','Marketing Manager'];
  result={id:simulationResultId(),company:data.company,domain:'demo.example',organization:data.company,contacts:Array.from({length:Math.max(1,Math.min(10,Math.floor(Number(data.limit)||5)))},(_,i)=>({id:i,name:names[i],email:`kontakt${i+1}@demo.example`,role:data.titles||roles[i%roles.length],sources:[],existing:null})),simulated:true};
  (results.contactSearches||={})[result.id]=result;
 }else if(path==='discover/contacts/add'){
  const search=results.contactSearches?.[data.id];
  if(!search||data.confirm_company!==true)throw Error('Potwierdź dodanie kontaktów z symulacji.');
  if(!Array.isArray(data.selected)||!data.selected.length||data.selected.some(i=>!Number.isInteger(i)||!search.contacts[i]))throw Error('Wybierz kontakty z wyników wyszukiwania.');
  const plans=[...new Set(data.selected)].map(index=>{
   const person=search.contacts[index],tags=contactTags(data.tags_by_contact?.[person.email]??data.tags??data.target_group??'');
   if(tags.length>30||tags.some(tag=>tag.length>100||/[\u0000-\u001f\u007f]/.test(tag)))throw Error('Nieprawidłowe tagi.');
   return {person,tags,group:tags.join('; ')};
  });
  const contacts=contactResults.contacts||=[];let added=0,existing=0;
  for(const {person,tags,group} of plans){
   const saved=contacts.find(c=>c.email===person.email);
   if(saved){existing++;if(group){saved.tags=contactTags([...contactTags(saved),...tags]);saved.target_group=saved.tags.join('; ')}continue}
   if(state.contacts.some(c=>!c.simulated&&c.email.toLowerCase()===person.email.toLowerCase())){existing++;continue}
   const id=Math.min(0,...contacts.map(c=>c.id))-1;
   contacts.push({id,name:person.name,email:person.email,role:person.role,company:search.company,notes:'Fikcyjny kontakt z symulacji.',status:'active',target_group:group,tags,simulated:true});added++;
  }
  result={added,existing,simulated:true};
 }else if(path==='contacts/tags/bulk'){
  const tags=contactTags(data.tags),contacts=(contactResults.contacts||[]).filter(contact=>data.ids.includes(contact.id));
  if(!tags.length||contacts.length!==new Set(data.ids).size)throw Error('Wybierz kontakty i co najmniej jeden tag.');
  const updates=contacts.map(contact=>({contact,tags:contactTags([...contactTags(contact),...tags])}));
  if(updates.some(row=>row.tags.length>30||row.tags.some(tag=>tag.length>100||/[\u0000-\u001f\u007f]/.test(tag))))throw Error('Nieprawidłowe tagi.');
  updates.forEach(row=>{row.contact.tags=row.tags;row.contact.target_group=row.tags.join('; ')});
  result={updated:contacts.length,tags,simulated:true};
 }else if(path==='contact/group'||path==='contact/tags'||path==='contact/status'){
  const contact=(contactResults.contacts||[]).find(c=>c.id===data.id);if(!contact)throw Error('Nie znaleziono kontaktu z symulacji.');
  if(path==='contact/group'||path==='contact/tags'){
   const tags=contactTags(data.tags??data.target_group??'');
   if(tags.length>30||tags.some(tag=>tag.length>100||/[\u0000-\u001f\u007f]/.test(tag)))throw Error('Nieprawidłowe tagi.');
   contact.tags=tags;contact.target_group=tags.join('; ');
  }else{if(!['active','paused','unsubscribed'].includes(data.status))throw Error('Nieprawidłowy status');contact.status=data.status}
  result={ok:true,simulated:true};
 }else if(path==='prospecting/search'){
  const id=simulationResultId();
  const searchLanguages=data.search_languages?.length?data.search_languages:[null],limit=Math.max(1,Math.min(10,Number(data.company_limit)||3));
  const requests=searchLanguages.map(language=>({language,request:{query:data.audience,limit},search_areas:data.search_areas||[],filters:{simulated:true}}));
  results.runs.unshift({...data,id,simulated:true,project_id:state.seller_project.id,status:'ready',stage:'Wyniki symulacji pobierania danych',warnings:'["Dane fikcyjne. Nie można użyć ich do rzeczywistej kampanii."]',filters:JSON.stringify({requests}),error:''});
  for(let i=1;i<=limit*searchLanguages.length;i++)results.candidates.push({id:id+'-'+i,run_id:id,simulated:true,tags:[],name:`Osoba Testowa ${i}`,company:`Klient Demo ${i}`,email:`kontakt${i}@przyklad.example`,role:data.titles||'Operations Manager',qualification:'uncertain',fit_reason:'Przykładowy wynik dla podanych kryteriów.',missing_data:'Fikcyjne dane',why_now:'Przykładowe zdarzenie',verification_status:'unverified',sources:'[]',evidence:JSON.stringify({company_summary:'Firma demonstracyjna',retrieved:now})});result={id};
 }else if(path==='prospecting/candidates/bulk'){
  const selected=new Set(data.candidate_ids),rows=results.candidates.filter(row=>row.run_id===data.id&&selected.has(row.id));
  if(!selected.size||rows.length!==selected.size)throw Error('Wybierz kontakty z tego wyszukiwania.');
  if(data.action==='delete')results.candidates=results.candidates.filter(row=>row.run_id!==data.id||!selected.has(row.id));
  else if(data.action==='tags'){
   const tags=contactTags(data.tags);if(!tags.length)throw Error('Wybierz co najmniej jeden tag.');
   const updates=rows.map(row=>({row,tags:contactTags([...contactTags(row.tags||[]),...tags])}));
   if(updates.some(update=>update.tags.length>30||update.tags.some(tag=>tag.length>100||/[;\u0000-\u001f\u007f]/.test(tag))))throw Error('Nieprawidłowe tagi.');
   const contacts=state.contacts.filter(contact=>contact.id>0&&rows.some(row=>row.email.toLowerCase()===contact.email.toLowerCase()));
   if(contacts.length)await api('contacts/tags/bulk',{ids:contacts.map(contact=>contact.id),tags});
   updates.forEach(update=>update.row.tags=update.tags);
  }else throw Error('Nieznana operacja na wynikach.');
  result={updated:rows.length,simulated:true};
 }else if(path==='prospecting/contacts/add'){
  if(!Array.isArray(data.candidate_ids)||!data.candidate_ids.length)throw Error('Wybierz kontakty z wyników.');
  const selected=[...new Set(data.candidate_ids)],rows=results.candidates.filter(row=>row.run_id===data.id&&selected.includes(row.id));
  if(rows.length!==selected.length)throw Error('Wybierz kontakty z tego wyszukiwania.');
  result=await api('prospecting/contacts/add-simulation',{project_id:state.seller_project.id,contacts:rows.map(({name,email,company,role})=>({name,email,company,role})),tags_by_contact:data.tags_by_contact||{}});
 }else if(path==='prospecting/verify'){
  for(const candidate of results.candidates.filter(c=>c.run_id===data.id))Object.assign(candidate,{verification_status:'unknown',checked_at:now,error:'Symulowany odczyt nie potwierdza adresu.'});result={simulated:true};
 }else if(path==='signals/scan'){result={created:state.signals.sources.filter(s=>s.enabled&&(!data.id||s.id===data.id)).length*3,enrolled:0,errors:[],simulated:true};
 }else if(path==='signals/discovery/start'){
  const id=simulationResultId();results.jobs.unshift({id,status:'completed',completed:data.companies.length,total:data.companies.length,error:'',results:data.companies.map(company=>({company,reason:'Symulowane pobieranie. Nie dodano fikcyjnych źródeł do konfiguracji.',signal_kinds:[],entries:[],citations:[]}))});result={id};
 }else if(path==='signals/discovery/cancel'){result={simulated:true};
 }else if(path==='signals/monitoring/companies'){result={count:0,simulated:true};
 }else if(path==='research'){
  result={offer:state.seller_project.offer||'Symulowany opis oferty — uzupełnij treścią swojej firmy.',audience:state.seller_project.audience||'',source:normalizeWebsite(data.url),ai:false,simulated:true};
 }else if(path==='ai/proof-points'){result={proof_points:'',sources:[],website:data.website,simulated:true};
 }else if(path==='library/discover'||path==='library/add'){
  const website=normalizeWebsite(data.website),url=normalizeWebsite(data.url||website),id=simulationResultId();
  results.materials.push({id,website,url,title:'Symulowany odczyt strony',summary:'Przykładowa treść — nie odczytano tej strony.',kind:'service',enabled:1,simulated:true});
  results.libraryProjects=results.libraryProjects.filter(p=>p.website!==website);results.libraryProjects.push({id,website,name:new URL(website).hostname,offer:state.seller_project.offer||'Symulowany opis strony',updated:now,simulated:true});result={website,offer:state.seller_project.offer||'Symulowany opis strony',added:1,errors:[],simulated:true};
 }else if(path==='campaign/status'){result=await simulateCampaignStatus(data);
 }else if(path==='sync'){applyDeliverySimulation(state);result={simulated:true};
 }else throw Error('Nieznana operacja symulowanego pobierania.');
 saveSimulationResults();return result;
}
async function setAppSimulation(enabled){
 const checkbox=$('#app-simulation'),previous=monitoringSimulation;checkbox.disabled=true;
 try{
  const form=$('#prospect-form')||$('#seller-project-form');if(form)updateSellerProject(form);await flushSellerProject();
  await saveSimulationMode(enabled,state.csrf);monitoringSimulation=enabled;simulationEpoch++;
  if(!enabled)pauseDeliverySimulations();
  try{localStorage.setItem('kaska-simulation',enabled?'on':'off');localStorage.setItem('kaska-monitoring-simulation',enabled?'on':'off')}catch{}
  discoverReview.stop=true;$('#modal').close();await refresh();
 }catch(error){monitoringSimulation=previous;try{await saveSimulationMode(previous,state.csrf)}catch{}throw error}
 finally{checkbox.checked=monitoringSimulation;checkbox.disabled=false;renderSimulationControl()}
}
function renderSimulationControl(){const input=$('#app-simulation');if(input)input.checked=monitoringSimulation;document.body.classList.toggle('simulation-mode',monitoringSimulation)}
document.addEventListener('DOMContentLoaded',()=>{renderSimulationControl();$('#app-simulation').onchange=e=>run(null,()=>setAppSimulation(e.target.checked))});
function simulationSources(){const ids=new Set((sig().monitoring?.monitors||[]).flatMap(m=>m.source_ids));return sig().sources.filter(s=>ids.has(s.id)&&s.enabled)}
function simulationSignals(source){
 const topic=JSON.parse(source.config||'{}').topic||source.company||source.name,selected=JSON.parse(source.signal_kinds||'[]'),kinds=selected.length?selected:['tender','erp','hiring'];
 return Array.from({length:3},(_,index)=>{
  const company=`${translateUiText('Firma demonstracyjna')} ${source.id}.${index+1}`,kind=kinds[index%kinds.length];
  return {id:`demo-${source.id}-${index}`,source_id:source.id,company,kind,topic,score:0,explanation:'Symulacja pobierania',title:`${company}: ${kind} — ${topic}`,evidence:translateUiText('Przykładowe zdarzenie wygenerowane na potrzeby symulacji. Nie pochodzi z odczytu źródła.'),reason:translateUiText('Przykładowa okazja do rozmowy o ofercie z wybranego projektu. Wymagałaby potwierdzenia w rzeczywistym źródle.'),observed:Date.now()/1000,simulated:true};
 });
}
function allSimulationSignals(){return simulationSources().flatMap(simulationSignals)}
function simulationBanner(){return ''}
function simulationSignalCards(signals){return signals.map(s=>`<article class="signal-card" data-demo-signal="${esc(s.id)}"><span class="badge warn">Symulacja</span><h3 data-no-translate>${esc(s.title)}</h3><p>${esc(s.evidence)}</p><p class="hint">${esc(s.reason)}</p></article>`).join('')}
function showSimulationSignals(signals){modal(`<h2>Sygnały symulowane</h2><p class="hint">To przykłady pobranych danych. Nie można ich używać do rzeczywistych kampanii.</p>${simulationSignalCards(signals)}`)}
document.addEventListener('click',e=>{
 if(e.target.closest('[data-simulation-scan]')){renderDiscover();toast('Symulacja gotowa: 3 sygnały z każdego źródła.');return}
 const button=e.target.closest('[data-simulation-source]');if(!button)return;
 const source=simulationSources().find(s=>s.id===Number(button.dataset.simulationSource));if(source)showSimulationSignals(simulationSignals(source));
});
