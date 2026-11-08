let prospectSelected=new Set(),prospectRunId=null;
let prospectDraftPending=null;
function finishProspectDraft(){
  if(prospectDraftPending===null)return;
  const record=state.prospecting?.runs.find(r=>r.id===prospectDraftPending);
  if(!record||record.status==='drafting'||(record.status==='ready'&&!record.campaign_id&&!record.error))return;
  prospectDraftPending=null;
  if(record.campaign_id){
    prospectSelected.clear();
    if(view==='prospecting'&&prospectRunId===record.id){selectedCampaign=record.campaign_id;view='campaigns'}
    toast('Szkice gotowe. Sprawdź treść przed uruchomieniem wysyłki.');
  }else if(record.error)toast(record.error);
}
const prospectStatus={searching:'Szukanie klientów',verifying:'Weryfikacja emaili',drafting:'Tworzenie szkiców',ready:'Do przeglądu',error:'Wymaga uwagi',interrupted:'Przerwano'};
const verificationLabels={unverified:'Nie sprawdzono',valid:'Zweryfikowany',invalid:'Nieprawidłowy',accept_all:'Accept-all — niepotwierdzony',unknown:'Nie udało się potwierdzić',pending:'Weryfikacja w toku',webmail:'Poczta prywatna',disposable:'Adres tymczasowy'};
function prospectEligible(p){return !p.simulated&&p.verification_status==='valid'&&p.qualification!=='rejected'&&p.checked_at>Date.now()/1000-7*86400&&p.verified_at>Date.now()/1000-31*86400&&!state.contacts.some(c=>c.email.toLowerCase()===p.email.toLowerCase())}
function renderHunterSettings(){
  $('#openai-form').closest('section').insertAdjacentHTML('afterend',`<section class="panel"><div class="panel-head"><h2>Hunter · firmy, osoby i weryfikacja</h2><span class="badge ${state.prospecting?.hunter?'':'gray'}">${state.prospecting?.hunter?'Skonfigurowano':'Nie podłączono'}</span></div><p>Kaśka wyszukuje firmy według Twojego opisu, odczytuje publicznie znalezione adresy osób i sprawdza je przed przygotowaniem kampanii.</p><form id="hunter-form"><label for="hunter-key">Klucz Hunter API</label><input id="hunter-key" type="password" name="api_key" autocomplete="new-password" ${state.prospecting?.hunter?'':'required'} placeholder="Klucz z konta Hunter"><p class="hint">Klucz znajdziesz na <a href="https://hunter.io/api" target="_blank" rel="noopener">koncie Hunter ↗</a>. Zapis sprawdza dostęp do konta. Wyszukiwanie kontaktów i weryfikacja mogą zużywać kredyty Twojego planu; dostęp do Discover zależy od konta. Klucz trafia wyłącznie do lokalnego .env.</p><div class="actions"><button class="primary">Sprawdź i podłącz Hunter</button>${state.prospecting?.hunter?'<button type="button" class="secondary" id="hunter-disconnect">Odłącz Hunter</button>':''}</div></form></section>`);
  maskSavedApiKey($('#hunter-key'),state.prospecting?.hunter);
  $('#hunter-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{await api('integrations/hunter',apiKeyFormData(e.target));e.target.reset();await refresh();toast('Hunter podłączony. Możesz szukać klientów.');})};
  if($('#hunter-disconnect'))$('#hunter-disconnect').onclick=e=>run(e.currentTarget,async()=>{await api('integrations/hunter',{disconnect:true});await refresh();toast('Hunter odłączony.');});
  $('#hunter-form').closest('section').insertAdjacentHTML('afterend',`<section class="panel"><div class="panel-head"><h2>Apollo · uzupełnianie kontaktów</h2><span class="badge ${state.prospecting?.apollo?'':'gray'}">${state.prospecting?.apollo?'Skonfigurowano':'Nie podłączono'}</span></div><p>Jeśli Hunter znajdzie za mało kontaktów, Kaśka sprawdzi Apollo. Wyniki łączy według adresu email, a adresy w Leadach weryfikuje przez Hunter przed dodaniem do kontaktów.</p><form id="apollo-form"><label for="apollo-key">Klucz Apollo API</label><input id="apollo-key" type="password" name="api_key" autocomplete="new-password" ${state.prospecting?.apollo?'':'required'}><p class="hint">Klucz wymaga dostępu do People API Search i People Enrichment. Uzupełnianie danych może zużywać kredyty Apollo; maksymalnie tyle prób na firmę, ile brakujących kontaktów. Nie pobieramy prywatnych adresów ani numerów telefonu. <a href="https://docs.apollo.io/docs/create-api-key" target="_blank" rel="noopener">Utwórz klucz Apollo ↗</a></p><div class="actions"><button class="primary">Sprawdź i podłącz Apollo</button>${state.prospecting?.apollo?'<button type="button" class="secondary" id="apollo-disconnect">Odłącz Apollo</button>':''}</div></form></section>`);
  maskSavedApiKey($('#apollo-key'),state.prospecting?.apollo);
  $('#apollo-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{await api('integrations/apollo',apiKeyFormData(e.target));e.target.reset();await refresh();toast('Apollo podłączone.');})};
  if($('#apollo-disconnect'))$('#apollo-disconnect').onclick=e=>run(e.currentTarget,async()=>{await api('integrations/apollo',{disconnect:true});await refresh();toast('Apollo odłączone.');});
}
function maskSavedApiKey(input,configured){
  const showMask=()=>{input.value='••••••••••••';input.dataset.masked='true'};
  if(configured)showMask();
  input.onfocus=()=>{if(input.dataset.masked==='true'){input.value='';delete input.dataset.masked}};
  input.oninput=()=>{delete input.dataset.masked};
  input.onblur=()=>{if(configured&&!input.value)showMask()};
}
function apiKeyFormData(form){
  const data=Object.fromEntries(new FormData(form));
  if(form.elements.api_key.dataset.masked==='true')data.api_key='';
  return data;
}
const leadBriefSource=project=>JSON.stringify([project.offer,project.audience,project.pain_points,project.value_props]);
function cacheLeadBrief(project,text,language=''){try{sessionStorage.setItem('kaska-lead-brief:'+project.id,JSON.stringify({source:leadBriefSource(project),text,language}))}catch{}}
function searchBriefLanguage(project){try{return sessionStorage.getItem('kaska-search-language:'+project.id)||state.preferences.message_language}catch{return state.preferences.message_language}}
function markBriefLanguage(form,language){const text=form.elements.lead_brief;text.dataset.briefLanguage=language;text.dataset.translatedText=text.value;cacheLeadBrief(sellerProject(),text.value,language)}
function translateLeadBrief(form){
 const text=form.elements.lead_brief,select=form.elements.language,project=sellerProject(),source=text.value,language=select.value,status=$('#lead-brief-status');
 if(!source.trim()||(text.dataset.briefLanguage===language&&text.dataset.translatedText===source))return Promise.resolve(true);
 if(!state.integrations.ai){status.textContent=translateUiText('Automatyczne tłumaczenie wymaga OpenAI. Możesz wpisać opis w wybranym języku ręcznie.');return Promise.resolve(true)}
 const previous=form._briefTranslation;
 if(previous?.source===source&&previous.language===language)return previous.promise;
 previous?.controller.abort();
 const task={source,language,controller:new AbortController()},scope=leadBriefSource(project),epoch=simulationEpoch;
 form._briefTranslation=task;form.dataset.translating='true';
 status.textContent=translateUiText('Tłumaczę opis wyszukiwania…');
 task.promise=(async()=>{
  try{
   const result=await api('ai/translate-search-brief',{text:source,language},task.controller.signal);
   if(!form.isConnected||form._briefTranslation!==task||sellerProject().id!==project.id||leadBriefSource(sellerProject())!==scope||simulationEpoch!==epoch||text.value!==source||select.value!==language)return false;
   text.value=result.text;markBriefLanguage(form,language);
   status.textContent=translateUiText('Opis przetłumaczony. Sprawdź go przed wyszukiwaniem.');return true;
  }catch(error){if(form._briefTranslation===task&&form.isConnected)status.textContent=translateUiText('Nie udało się przetłumaczyć opisu. Treść pozostaje bez zmian.')+' '+error.message;if(error.name==='AbortError')return false;throw error}
  finally{if(form._briefTranslation===task){delete form._briefTranslation;delete form.dataset.translating;if(form.isConnected)renderProspecting()}}
 })();return task.promise;
}
function scheduleBriefTranslation(form){
 clearTimeout(form._briefTimer);
 if($('#prospect-advanced')?.open)form._briefTimer=setTimeout(()=>{if(form.isConnected&&document.activeElement!==form.elements.lead_brief)translateLeadBrief(form).catch(()=>{})},600);
}
function initialLeadBrief(project){
 try{const cached=JSON.parse(sessionStorage.getItem('kaska-lead-brief:'+project.id)||'null');if(cached?.source===leadBriefSource(project)&&typeof cached.text==='string')return cached.text}catch{}
 return projectLeadBrief(project);
}
function projectLeadBrief(project){
 if(!project.offer?.trim()||!project.audience?.trim())return project.audience?.trim()||project.offer?.trim().slice(0,3000)||'';
 const combined=translateUiText('Szukamy firm, które mogą skorzystać z tej oferty:')+'\n'+project.offer.trim()+'\n\n'+translateUiText('Kryteria odbiorców:')+'\n'+project.audience.trim();
 return combined.length<=3000?combined:project.audience;
}
function prospectSearchAreas(){
 let areas=sellerProject().search_areas||[];
 try{if(typeof areas==='string')areas=JSON.parse(areas)}catch{areas=[]}
 if(!Array.isArray(areas))areas=[];
 return `<strong>Obszary wyszukiwania</strong><div class="prospect-area-list">${areas.length?areas.map((area,index)=>`<span class="badge gray">${area.label?`<span data-no-translate>${esc(area.label)}</span>`:`<span>Obszar</span> ${index+1}`} · <span data-no-translate>${esc(area.radius_km)} km</span></span>`).join(''):'<span>Cały świat</span>'}</div><button type="button" class="link" data-view="project">Zmień obszary w projekcie</button>`;
}
function leadBriefControls(){return `<section class="lead-brief"><div class="lead-brief-heading"><label for="prospect-lead-brief">Opis wyszukiwania</label><button type="button" class="secondary" id="formulate-lead-brief">✧ Sformułuj z AI</button></div><textarea id="prospect-lead-brief" name="lead_brief" rows="6" maxlength="3000" data-no-translate></textarea><p class="hint" role="status" id="lead-brief-status"></p></section>`}
function bindLeadBrief(form){
 const project=sellerProject(),text=$('#prospect-lead-brief'),button=$('#formulate-lead-brief'),status=$('#lead-brief-status');
 form.dataset.sellerProjectId=String(project.id);text.value=initialLeadBrief(project);
 form.elements.language.value=searchBriefLanguage(project);
 try{const saved=JSON.parse(sessionStorage.getItem('kaska-lead-brief:'+project.id)||'null');if(saved?.source===leadBriefSource(project)&&saved.text===text.value&&saved.language){text.dataset.briefLanguage=saved.language;text.dataset.translatedText=saved.text}}catch{}
 text.oninput=()=>{delete text.dataset.briefLanguage;cacheLeadBrief(sellerProject(),text.value);scheduleBriefTranslation(form)};
 text.onblur=event=>{clearTimeout(form._briefTimer);if(text.value.trim()&&event.relatedTarget!==button)translateLeadBrief(form).catch(()=>{})};
 form.elements.language.onchange=()=>{try{sessionStorage.setItem('kaska-search-language:'+sellerProject().id,form.elements.language.value)}catch{}translateLeadBrief(form).catch(()=>{})};
 $('#prospect-advanced').addEventListener('toggle',()=>{if($('#prospect-advanced')?.open)translateLeadBrief(form).catch(()=>{})});
 button.onclick=()=>run(button,async()=>{
  clearTimeout(form._briefTimer);form._briefTranslation?.controller.abort();
  if(!state.integrations.ai)throw Error(translateUiText('Podłącz OpenAI w Integracjach.'));
  await flushSellerProject();const source=sellerProject(),previous=text.value;
  if(!source.offer?.trim())throw Error(translateUiText('Najpierw uzupełnij ofertę.'));
  status.textContent=translateUiText('Formułuję opis wyszukiwania…');
  try{
   const language=form.elements.language.value;
   const result=await api('ai/suggest-audience',{offer:source.offer,audience:previous||source.audience,pain_points:source.pain_points,value_props:source.value_props,search_languages:source.search_languages,language});
   const current=sellerProject();
   if(!form.isConnected||current.id!==source.id)return;
   if(text.value!==previous||form.elements.language.value!==language||leadBriefSource(current)!==leadBriefSource(source)){status.textContent=translateUiText('Dane zmieniły się podczas generowania. Sformułuj opis ponownie.');return}
   text.value=result.audience;markBriefLanguage(form,language);
   status.textContent=translateUiText('Opis gotowy. Sprawdź go przed wyszukiwaniem.');
  }catch(error){if(status.isConnected)status.textContent=error.message;throw error}
 });
}
const leadCompanyPanels=new Set(),leadContactTags=new Map(),leadImportMessages=new Map(),leadImportBusy=new Set();
const leadResultPages=new Map();let leadSelectedScope='';
const leadRunKey=record=>JSON.stringify([state.seller_project.id,record.id]);
const leadPersonKey=(record,person)=>JSON.stringify([state.seller_project.id,record.id,person.email.toLowerCase()]);
function leadExisting(person){return state.contacts.find(contact=>contact.email.toLowerCase()===person.email.toLowerCase())||(person.contact_id?{id:person.contact_id,status:person.contact_status,tags:person.contact_tags}:null)}
function leadTags(record,person){return leadContactTags.get(leadPersonKey(record,person))??contactTags([...contactTags(person.tags||[]),...contactTags(leadExisting(person)||[])])}
function leadResultPage(record){const key=leadRunKey(record);if(!leadResultPages.has(key))leadResultPages.set(key,{page:1,size:10,bulk:false,tags:[]});return leadResultPages.get(key)}
function leadResultPagination(p,total){
 const pages=Math.max(1,Math.ceil(total/p.size));
 return `<nav class="discover-company-pagination" aria-label="${esc(translateUiText('Strony wyników'))}"><span class="hint">${total?((p.page-1)*p.size+1):0}–${Math.min(total,p.page*p.size)} / ${total}</span><label><span>Wyników na stronie</span><select data-lead-page-size>${[10,25,50].map(size=>`<option ${p.size===size?'selected':''}>${size}</option>`).join('')}</select></label><div class="actions"><button type="button" class="secondary" data-lead-page="1" ${p.page===1?'disabled':''}>« <span>Pierwsza</span></button><button type="button" class="secondary" data-lead-page="${p.page-1}" ${p.page===1?'disabled':''}>‹ <span>Poprzednia</span></button><span class="hint"><span>Strona</span> ${p.page} / ${pages}</span><button type="button" class="secondary" data-lead-page="${p.page+1}" ${p.page===pages?'disabled':''}><span>Następna</span> ›</button><button type="button" class="secondary" data-lead-page="${pages}" ${p.page===pages?'disabled':''}><span>Ostatnia</span> »</button></div></nav>`;
}
function leadBulkPanel(p,busy){
 const extra='<div class="bulk-panel-extra"><button type="button" class="secondary danger" data-lead-bulk-action="delete">Usuń zaznaczone wyniki</button><p class="hint">Usuwanie dotyczy tylko wyników wyszukiwania. Kontakty zapisane w bazie pozostają zachowane.</p></div>';
 return `<label class="contact-bulk-toggle"><input type="checkbox" data-lead-bulk-toggle ${p.bulk?'checked':''} ${busy?'disabled':''}><span>Operacje zbiorcze</span></label>${p.bulk?bulkContactTagsPanel({id:'lead-bulk-panel',count:prospectSelected.size,tags:p.tags,tagId:'lead-bulk-tags',clearAttribute:'data-lead-clear',applyAttribute:'data-lead-bulk-action="tags"',extra})+`<label class="contact-bulk-toggle lead-select-all"><input type="checkbox" data-lead-all ${busy?'disabled':''}><span>Zaznacz wszystkie widoczne kontakty</span></label>`:''}`;
}
async function bulkLeadResults(button,record){
 const key=leadRunKey(record),projectId=state.seller_project.id,p=leadResultPage(record),action=button.dataset.leadBulkAction;
 const rows=state.prospecting.candidates.filter(row=>row.run_id===record.id&&prospectSelected.has(row.id));
 if(!rows.length||leadImportBusy.has(key))return;
 leadImportBusy.add(key);syncLeadImportControls();
 try{
  const tags=[...p.tags];await api('prospecting/candidates/bulk',{id:record.id,project_id:projectId,action,candidate_ids:rows.map(row=>row.id),tags});
  if(state.seller_project.id!==projectId)return;
  for(const row of rows){const personKey=leadPersonKey(record,row);if(action==='delete'){leadContactTags.delete(personKey);prospectSelected.delete(row.id)}else leadContactTags.set(personKey,contactTags([...leadTags(record,row),...tags]))}
  document.activeElement?.blur();await refresh();
 }finally{leadImportBusy.delete(key);if(view==='prospecting'){document.activeElement?.blur();renderProspecting();syncLeadImportControls();syncLanguages()}}
}
function renderEnrichmentTrace(steps){
 return Array.isArray(steps)?`<ul class="enrichment-trace">${steps.map(step=>`<li><strong data-no-translate>${esc(step.provider)}</strong> · <span>${step.status==='error'?'Błąd źródła':'Dodane kontakty:'}</span> ${Number(step.added)||0}${step.error?`<p class="error" data-no-translate>${esc(step.error)}</p>`:''}</li>`).join('')}</ul>`:'';
}
function renderEnrichmentPipeline(record){
 const pipeline=JSON.parse(record.filters||'{}').pipeline;
 return Array.isArray(pipeline)&&pipeline.length?`<details class="enrichment-pipeline"><summary>Przebieg uzupełniania danych</summary><p class="hint">Hunter wyszukuje firmy. Apollo uzupełnia brakujące kontakty, jeśli jest podłączone. Sygnały pochodzą z zaakceptowanych zdarzeń z ostatnich 30 dni.</p>${pipeline.map(company=>`<div><strong data-no-translate>${esc(company.company)} · ${esc(company.domain)}</strong>${renderEnrichmentTrace(company.providers)}${company.error?`<p class="error" data-no-translate>${esc(company.error)}</p>`:''}</div>`).join('')}</details>`:'';
}
function renderLeadCompanies(rows,record,busy){
 const groups=new Map();for(const person of rows){const key=String(person.domain||person.company).toLowerCase();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(person)}
 return `<div class="lead-companies">${[...groups.entries()].map(([group,people])=>{
  const key=JSON.stringify([state.seller_project.id,record.id,group]),first=people[0],hasContacts=people.some(leadExisting);
  return `<details class="signal-card discover-company lead-company" data-lead-company="${esc(key)}" ${leadCompanyPanels.has(key)?'open':''}><summary><span class="discover-company-toggle ${hasContacts?'has-contacts':''}" aria-hidden="true"></span><h3 data-no-translate>${esc(first.company||first.domain)}</h3><span class="badge gray">${people.length} <span>Kontakty</span></span></summary><div class="discover-company-body">${first.domain?`<p class="hint" data-no-translate>${esc(first.domain)}</p>`:''}${people.map(person=>{
   const existing=leadExisting(person),sources=JSON.parse(person.sources||'[]'),evidence=JSON.parse(person.evidence||'{}');
   return `<article class="discover-found-contact lead-person" data-lead-person="${esc(person.id)}"><div class="panel-head"><label class="check"><input type="checkbox" data-prospect-id="${esc(person.id)}" ${busy?'disabled':''} ${prospectSelected.has(person.id)?'checked':''}><span data-no-translate><strong>${esc(person.name)}</strong><small>${esc(person.role)} · ${esc(person.email)}</small></span></label><span class="badge ${person.verification_status==='valid'?'':'gray'}">${esc(verificationLabels[person.verification_status]||person.verification_status)}</span></div>${existing?'<span class="badge gray">Już w kontaktach</span>':''}${person.simulated?'<span class="badge warn">Symulacja</span>':''}<p data-no-translate>${esc(person.fit_reason)}</p><details class="lead-person-evidence"><summary>Szczegóły i źródła</summary><p data-no-translate>${esc(evidence.company_summary)}</p><p class="hint"><span>Kontakt:</span> <strong data-no-translate>${esc(evidence.contact_provider||evidence.provider||'')}</strong></p>${renderEnrichmentTrace(evidence.enrichment)}${person.error?`<p class="error" data-no-translate>${esc(person.error)}</p>`:''}<p data-no-translate>${esc(person.why_now)}</p><p data-no-translate>${esc(person.missing_data)}</p>${sources.map(source=>`<p><a class="link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.url)}</a></p>`).join('')}</details><div class="lead-person-tags"><p class="hint">Tagi są opcjonalne.</p>${contactTagsControl(leadTags(record,person),'lead-tags-'+person.id)}</div></article>`;
  }).join('')}</div></details>`;
 }).join('')}</div>`;
}
function syncLeadImportControls(){
 const button=$('[data-prospect-action=add]'),record=state.prospecting?.runs.find(run=>run.id===prospectRunId);
 if(button)button.disabled=!prospectSelected.size||!record||leadImportBusy.has(leadRunKey(record))||['searching','verifying','drafting'].includes(record.status);
 if(record&&leadImportBusy.has(leadRunKey(record)))$('#prospect-results')?.querySelectorAll('input,select,button').forEach(input=>input.disabled=true);
 if(record){
  const busy=leadImportBusy.has(leadRunKey(record))||['searching','verifying','drafting'].includes(record.status),p=leadResultPage(record);
  const visible=[...document.querySelectorAll('[data-prospect-id]')],selected=visible.filter(input=>input.checked).length,all=$('[data-lead-all]');
  if(all){all.checked=!!visible.length&&selected===visible.length;all.indeterminate=selected>0&&selected<visible.length;all.disabled=busy||!visible.length}
  document.querySelectorAll('[data-lead-bulk-action]').forEach(control=>control.disabled=busy||!prospectSelected.size||(control.dataset.leadBulkAction==='tags'&&!p.tags.length));
  if(busy)$('#prospect-search').disabled=true;
 }
 document.querySelectorAll('#lead-selected-count,#lead-bulk-count').forEach(count=>count.textContent=prospectSelected.size);
}
document.addEventListener('toggle',event=>{const panel=event.target;if(!panel.matches?.('[data-lead-company]')||!panel.isConnected)return;panel.open?leadCompanyPanels.add(panel.dataset.leadCompany):leadCompanyPanels.delete(panel.dataset.leadCompany)},true);
document.addEventListener('input',event=>{
 if(event.target.name==='tags'&&event.target.closest('#lead-bulk-panel')){
  const record=state.prospecting.runs.find(run=>run.id===prospectRunId);if(record){leadResultPage(record).tags=contactTags(event.target.value);syncLeadImportControls()}return;
 }
 const person=event.target.closest('[data-lead-person]');if(!person||event.target.name!=='tags')return;
 const record=state.prospecting.runs.find(run=>run.id===prospectRunId),row=state.prospecting.candidates.find(candidate=>String(candidate.id)===person.dataset.leadPerson&&candidate.run_id===record?.id);
 if(row)leadContactTags.set(leadPersonKey(record,row),contactTags(event.target.value));
});
function renderProspecting(){
  const data=state.prospecting||{runs:[],candidates:[],hunter:false};
  if(!$('#prospect-form')){
    $('#content').innerHTML=renderTop('Znajdź klientów','Znajdź firmy i osoby, sprawdź wyniki i dodaj wybrane kontakty.')+dashboardWelcomePanel(true)+`
      <div class="notice" id="prospect-integrations"></div>
      <section class="panel prospect-search-options"><form id="prospect-form"><details class="prospect-advanced" id="prospect-advanced"><summary>Szukanie zaawansowane</summary><section id="prospect-search-areas" class="prospect-search-areas">${prospectSearchAreas()}</section>${leadBriefControls()}<label for="prospect-language">J\u0119zyk wyszukiwania</label><select id="prospect-language" name="language">${messageLanguageOptions(state.preferences.message_language)}</select><p class="hint">Opis wyszukiwania jest tłumaczony na wybrany język przez OpenAI. Dane projektu pozostają bez zmian.</p>          <div class="row"><div><label for="prospect-titles">Stanowiska (opcjonalnie, oddziel przecinkami)</label><input id="prospect-titles" name="titles" maxlength="500" placeholder="CEO, Head of Operations"></div><div><label for="prospect-department">Dział</label><select id="prospect-department" name="department"><option value="">Wszyscy decydenci</option>${[['executive','Zarząd'],['it','IT'],['finance','Finanse'],['sales','Sprzedaż'],['marketing','Marketing'],['hr','HR'],['operations','Operacje'],['procurement','Zakupy'],['product','Produkt']].map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></div></div>
          <div class="row"><div><label for="prospect-company-limit">Maksymalnie firm na język</label><input id="prospect-company-limit" name="company_limit" type="number" min="1" max="10" value="3" required></div><div><label for="prospect-people-limit">Osób na firmę</label><input id="prospect-people-limit" name="per_company" type="number" min="1" max="3" value="2" required></div></div>
          <label for="prospect-exclusions">Wyklucz domeny klientów i konkurentów</label><input id="prospect-exclusions" name="exclusions" placeholder="klient.pl, konkurent.com"><p class="hint">Pomijamy własną domenę i adresy już obecne w Kontaktach. Wyszukiwanie może zużyć kredyty Hunter oraz OpenAI, jeśli jest podłączone. Wyniki wymagają przeglądu; nie wysyłamy wiadomości.</p>
          </details><p id="prospect-feedback" class="hint" role="status"></p>
        </form></section>
      <section class="panel"><div class="panel-head"><h2>Firmy/Instytucje</h2><button class="secondary" id="prospect-refresh">Odśwież wyniki</button></div><div id="prospect-results"></div></section>`;
    bindLeadBrief($('#prospect-form'));bindDashboardWelcome();
    $('#prospect-advanced').addEventListener('invalid',()=>{$('#prospect-advanced').open=true},true);
    $('#prospect-form').onsubmit=e=>{e.preventDefault();const form=e.currentTarget,button=e.submitter||$('#prospect-search');if(form.dataset.searching==='true'||button.disabled)return;form.dataset.searching='true';run(button,async()=>{await flushSellerProject();clearTimeout(form._briefTimer);const projectId=sellerProject().id;if(!await translateLeadBrief(form))throw Error(translateUiText('Opis lub j?zyk zmieni? si? podczas t?umaczenia. Wyszukaj ponownie.'));if(!form.isConnected||sellerProject().id!==projectId)return;const project=sellerProject(),data={...Object.fromEntries(new FormData(form))};for(const field of ['website','offer','pain_points','value_props','proof_points','search_languages','search_areas'])data[field]=project[field];data.audience=e.target.elements.lead_brief.value.trim()||project.audience;delete data.lead_brief;if(data.audience.length>3000)throw Error(translateUiText('Opis wyszukiwania jest za długi. Skróć doprecyzowanie lub kryteria projektu.'));data.website=normalizeWebsite(data.website);if(!data.website||!data.audience?.trim()||data.audience.trim().length<10){editSellerProject();throw Error(translateUiText('Uzupełnij stronę firmy i opis odbiorców w projekcie.'))}const result=await api('prospecting/search',data);prospectRunId=result.id;prospectSelected.clear();$('#prospect-feedback').textContent='Wyszukiwanie uruchomione. Postęp pojawi się poniżej.';await refresh()}).finally(()=>{delete form.dataset.searching;if(form.isConnected)renderProspecting()})};
    $('#prospect-refresh').onclick=e=>run(e.currentTarget,()=>refresh());
  }
  const areasMarkup=prospectSearchAreas(),areasRoot=$('#prospect-search-areas');if(areasRoot._markup!==areasMarkup){areasRoot.innerHTML=areasMarkup;areasRoot._markup=areasMarkup}
  $('#prospect-integrations').innerHTML=`${data.hunter?'✓ Hunter podłączony.':'Podłącz Hunter, aby wyszukiwać klientów.'} ${data.apollo?'✓ Apollo uzupełnia brakujące kontakty.':''} ${state.integrations.ai?'✓ OpenAI ocenia dopasowanie firm.':'Bez OpenAI wyniki wymagają ręcznej oceny.'} <span>Po wyszukiwaniu adresy są automatycznie weryfikowane.</span> <button class="link" data-view="settings">Otwórz Integracje →</button>`;
  const busy=data.runs.some(r=>['searching','verifying','drafting'].includes(r.status))||leadImportBusy.size>0;
  $('#prospect-search').disabled=$('#prospect-form').dataset.searching==='true'||$('#prospect-form').dataset.translating==='true'||!data.hunter||busy||!dashboardCanSearch(sellerProject(),$('#dashboard-audience').value);
  if(!data.runs.some(r=>r.id===prospectRunId))prospectRunId=data.runs[0]?.id;
  const selectedRun=data.runs.find(r=>r.id===prospectRunId),root=$('#prospect-results');
  if(!selectedRun){root.innerHTML=empty('Zacznij od opisu odbiorców','Firmy i kontakty zostaną znalezione w Hunter. Nie tworzymy fikcyjnych wyników.');return}
  if(root.contains(document.activeElement))return;
  const rows=data.candidates.filter(p=>p.run_id===selectedRun.id),warnings=JSON.parse(selectedRun.warnings||'[]');
  const scope=leadRunKey(selectedRun),pagination=leadResultPage(selectedRun);
  if(leadSelectedScope!==scope){prospectSelected.clear();leadSelectedScope=scope}
  const known=new Set(rows.map(row=>row.id));for(const id of prospectSelected)if(!known.has(id))prospectSelected.delete(id);
  pagination.page=Math.max(1,Math.min(pagination.page,Math.max(1,Math.ceil(rows.length/pagination.size))));
  const pageRows=rows.slice((pagination.page-1)*pagination.size,pagination.page*pagination.size);
  root.innerHTML=`<div class="panel-head"><p><strong>${esc(prospectStatus[selectedRun.status]||selectedRun.status)}</strong> · ${esc(selectedRun.stage)}</p><span class="badge gray">${rows.length} osób</span></div>${selectedRun.status==='drafting'?`<div class="draft-progress" role="status"><p><span>Gotowe szkice:</span> <strong>${Number(selectedRun.draft_completed)||0} / ${Number(selectedRun.draft_total)||0}</strong></p><progress aria-label="Postęp tworzenia szkiców" max="${Number(selectedRun.draft_total)||1}" value="${Number(selectedRun.draft_completed)||0}"></progress><p class="hint">Generowanie trwa w tle. Możesz przejść do innej zakładki i wrócić do wyników.</p></div>`:''}${selectedRun.error?`<p class="error">${esc(selectedRun.error)}</p>`:''}${warnings.filter(w=>w!=='Dane fikcyjne. Nie można użyć ich do rzeczywistej kampanii.').map(w=>`<p class="hint">${esc(w)}</p>`).join('')}
    <details><summary>Oferta i zastosowane filtry wyszukiwarki</summary><p>${esc(selectedRun.offer)}</p><pre class="prospect-filters">${esc(JSON.stringify(JSON.parse(selectedRun.filters||'{}'),null,2))}</pre><p class="hint">Filtry wynikają z interpretacji opisu przez Hunter. Sprawdź, czy odpowiadają Twoim wymaganiom.</p></details>
    ${renderEnrichmentPipeline(selectedRun)}${leadResultPagination(pagination,rows.length)}${leadBulkPanel(pagination,busy)}${rows.length?renderLeadCompanies(pageRows,selectedRun,busy):empty(busy?'Trwa wyszukiwanie…':'Brak kontaktów dla tych kryteriów','Możesz zmienić opis firm, stanowiska lub dział. Brak wyników nie oznacza błędu połączenia.')}
    ${rows.length>pagination.size?leadResultPagination(pagination,rows.length):''}
    <div class="actions prospect-actions"><button class="secondary" data-prospect-action="verify" ${busy||!data.hunter||!rows.length?'disabled':''}>Zweryfikuj adresy email</button><button class="primary" data-prospect-action="add" ${busy||!prospectSelected.size?'disabled':''}>Dodaj wybrane do kontaktów</button><span class="hint"><span>Zaznaczono kontaktów:</span> <strong id="lead-selected-count">${prospectSelected.size}</strong></span></div><p class="hint">Zapis nie tworzy kampanii. Niezweryfikowane kontakty zapisujemy jako wstrzymane.</p><p class="hint" id="lead-import-status" role="status" data-no-translate>${esc(leadImportMessages.get(leadRunKey(selectedRun))||'')}</p>`;
  root.querySelectorAll('[data-prospect-id]').forEach(el=>el.onchange=()=>{const row=rows.find(p=>String(p.id)===el.dataset.prospectId);if(!row)return;el.checked?prospectSelected.add(row.id):prospectSelected.delete(row.id);syncLeadImportControls()});
  root.querySelectorAll('[data-prospect-action]').forEach(button=>button.onclick=()=>runProspectAction(button,selectedRun));
  const redraw=()=>{document.activeElement?.blur();renderProspecting();syncLanguages()};
  root.querySelectorAll('[data-lead-page]').forEach(button=>button.onclick=()=>{pagination.page=Number(button.dataset.leadPage);redraw()});
  root.querySelectorAll('[data-lead-page-size]').forEach(select=>select.onchange=()=>{pagination.size=Number(select.value);pagination.page=1;redraw()});
  $('[data-lead-bulk-toggle]').onchange=event=>{pagination.bulk=event.target.checked;prospectSelected.clear();redraw()};
  const selectAll=$('[data-lead-all]');if(selectAll)selectAll.onchange=event=>{for(const row of pageRows)event.target.checked?prospectSelected.add(row.id):prospectSelected.delete(row.id);redraw()};
  const clear=$('[data-lead-clear]');if(clear)clear.onclick=()=>{prospectSelected.clear();redraw()};
  root.querySelectorAll('[data-lead-bulk-action]').forEach(button=>button.onclick=()=>run(button,()=>bulkLeadResults(button,selectedRun)));
  syncLeadImportControls();
}
