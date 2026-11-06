function sourceLink(url){return /^https:\/\//i.test(url)?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="link">${esc(url)}</a>`:''}
const opportunityPages=new Map(),opportunityPanels=new Set();
const opportunityFilters=new Map();
function opportunityFilter(){const key=opportunityRequestKey();if(!opportunityFilters.has(key))opportunityFilters.set(key,{category:'',days:'30',location:'',score:'0',decision:'open',sort:'score'});return opportunityFilters.get(key)}
function opportunityDecision(item){return monitoringSimulation?(fetchedSimulation().opportunityReviews||{})[item.id]||'new':item.decision||'new'}
function filterOpportunities(items){
 const f=opportunityFilter(),cutoff=new Date(Date.now()-Number(f.days)*86400000).toISOString().slice(0,10);
 return items.filter(item=>(!f.category||item.category===f.category)&&Number(item.relevance)>=Number(f.score)&&(!f.location||String(item.location||'').toLocaleLowerCase().includes(f.location.trim().toLocaleLowerCase()))&&String(item.published_date||item.event_date||'')>=cutoff&&(f.decision==='all'||(f.decision==='open'?opportunityDecision(item)!=='rejected':opportunityDecision(item)===f.decision)))
  .sort((a,b)=>f.sort==='date'?String(b.published_date||b.event_date).localeCompare(String(a.published_date||a.event_date))||b.relevance-a.relevance:b.relevance-a.relevance||String(b.published_date||b.event_date).localeCompare(String(a.published_date||a.event_date)));
}
function opportunityFilterBar(items){
 if(!items.length)return '';
 const f=opportunityFilter(),select=(key,label,options)=>`<label><span>${label}</span><select data-opportunity-filter="${key}">${options.map(([value,text])=>`<option value="${esc(value)}" ${String(f[key])===String(value)?'selected':''}>${esc(translateUiText(text))}</option>`).join('')}</select></label>`;
 return `<div class="opportunity-filters">${select('category','Kategoria',[['','Wszystkie kategorie'],...[...new Set(items.map(item=>item.category))].map(category=>[category,category])])}${select('days','Okres',[['7','Ostatnie 7 dni'],['14','Ostatnie 14 dni'],['30','Ostatnie 30 dni']])}<label><span>Kraj / lokalizacja</span><input data-opportunity-filter="location" value="${esc(f.location)}" placeholder="np. Niemcy, Berlin"></label>${select('score','Minimalne dopasowanie',[['0','Dowolne'],['50','50 / 100'],['70','70 / 100'],['90','90 / 100']])}${select('decision','Decyzja',[['open','Nowe i interesujące'],['new','Nowe'],['interested','Interesuje mnie'],['rejected','Odrzucone'],['all','Wszystkie']])}${select('sort','Sortowanie',[['score','Najlepsze dopasowanie'],['date','Najnowsze']])}<button type="button" class="link" data-opportunity-filter-reset>Wyczyść filtry</button></div><p class="hint"><span>Widoczne okazje:</span> ${filterOpportunities(items).length} / ${items.length}</p>`;
}
document.addEventListener('change',event=>{
 const key=event.target.dataset.opportunityFilter;if(!key)return;
 opportunityFilter()[key]=event.target.value;event.target.blur();opportunityPages.clear();renderDiscoverOpportunities();
});
document.addEventListener('click',event=>{
 const reset=event.target.closest('[data-opportunity-filter-reset]');if(reset){opportunityFilters.delete(opportunityRequestKey());opportunityPages.clear();renderDiscoverOpportunities()}
 const button=event.target.closest('[data-opportunity-review]');if(!button)return;
 const projectId=sellerProject().id,simulated=monitoringSimulation,id=button.dataset.opportunityReview,decision=button.dataset.decision;
 run(button,async()=>{
  if(simulated){const data=fetchedSimulation(projectId);(data.opportunityReviews||={})[id]=decision;saveSimulationResults();renderDiscoverOpportunities()}
  else{await api('discover/opportunities/review',{project_id:projectId,id:Number(id),decision});await refresh()}
 });
});
function opportunityReviewActions(item){
 const decision=opportunityDecision(item);
 return `<div class="actions opportunity-review-actions">${decision==='interested'?'<span class="badge">Interesuje mnie</span>':`<button type="button" class="secondary" data-opportunity-review="${esc(item.id)}" data-decision="interested">Interesuje mnie</button>`}${decision==='rejected'?'<span class="badge gray">Odrzucone</span>':`<button type="button" class="link danger" data-opportunity-review="${esc(item.id)}" data-decision="rejected">Odrzuć</button>`}${decision!=='new'?`<button type="button" class="link" data-opportunity-review="${esc(item.id)}" data-decision="new">Cofnij decyzję</button>`:''}</div>`;
}
function opportunityEvidenceGaps(item){
 return `<details class="opportunity-evidence"><summary>Dowody i rzeczy do sprawdzenia</summary><p data-no-translate>${esc(item.quote)}</p><ul>${!item.domain?'<li>Oficjalna domena firmy nie została potwierdzona.</li>':''}${!item.location?'<li>Brak potwierdzonej lokalizacji.</li>':''}${!item.event_date?'<li>Data zdarzenia nie została potwierdzona.</li>':''}<li>Potrzeba zakupu, budżet i osoba decyzyjna wymagają potwierdzenia w rozmowie.</li></ul></details>`;
}
function dashboardActionsPanel(){
 let counts=state.dashboard_actions||{};
 if(monitoringSimulation)counts={opportunities:(state.discovery_opportunities?.items||[]).filter(item=>opportunityDecision(item)==='new').length,leads:(state.prospecting?.candidates||[]).filter(person=>!state.contacts.some(contact=>contact.email===person.email)).length,campaigns:state.campaigns.filter(c=>['draft','paused'].includes(c.status)&&state.messages.some(m=>m.campaign_id===c.id&&m.status==='queued')).length,replies:state.replies.length};
 return `<section class="panel dashboard-actions"><h2>Co wymaga Twojej uwagi?</h2><div class="workflow-actions">${[['opportunities','Nowe okazje','discover','Sprawdź zdarzenia i oceń firmy'],['leads','Leady do sprawdzenia','prospecting','Sprawdź osoby, adresy i tagi'],['campaigns','Kampanie do sprawdzenia','campaigns','Sprawdź treść i harmonogram przed wysyłką'],['replies','Odpowiedzi w projekcie','inbox','Przejdź do rozmów']].map(([key,label,target,description])=>`<button type="button" class="workflow-action" data-view="${target}"><strong>${counts[key]||0}</strong><span>${label}</span><small>${description}</small></button>`).join('')}</div></section>`;
}
const opportunityRequestPanels=new Set();
function opportunityRequestKey(){return JSON.stringify([sellerProject().id,monitoringSimulation])}
function renderOpportunityRequestPreview(data,run){
 const preview=data.request_preview,key=opportunityRequestKey();
 const queryBlock=(query,instructions,model)=>`<section class="opportunity-request-query"><h4>${esc(query.category)}</h4><p class="hint"><span>Model:</span> <span data-no-translate>${esc(query.model||model||'')}</span></p><label><span>Dane wejściowe</span><textarea readonly rows="12" spellcheck="false" data-no-translate>${esc(JSON.stringify(query.input,null,2))}</textarea></label><label><span>Instrukcja dla AI</span><textarea readonly rows="7" spellcheck="false" data-no-translate>${esc(query.instructions||instructions||'')}</textarea></label></section>`;
 return `<details class="opportunity-request-preview" data-opportunity-request-preview="${esc(key)}" ${opportunityRequestPanels.has(key)?'open':''}><summary>Co trafia do AI</summary>${monitoringSimulation?'<p class="hint">Symulacja: dane nie są wysyłane do AI.</p>':''}${!monitoringSimulation&&run?`<h3>Ostatnie wyszukiwanie</h3>${run.queries?.length?'<p class="hint">Zapytania przygotowane do wysłania. Błąd połączenia może uniemożliwić ich dostarczenie.</p>'+run.queries.map(query=>queryBlock(query)).join(''):`<p class="hint">Pełny podgląd zapytań jest dostępny dla nowych wyszukiwań.</p>${run.request?`<label><span>Zapisane kryteria wyszukiwania</span><textarea readonly rows="10" spellcheck="false" data-no-translate>${esc(JSON.stringify(run.request,null,2))}</textarea></label>`:''}`}`:''}<h3>Następne wyszukiwanie — podgląd</h3><p class="hint">Podgląd nie uruchamia AI. Dane dotyczą bieżącego projektu. Lista wcześniejszych okazji jest aktualizowana przed każdym zapytaniem.</p>${preview?.queries?.length?preview.queries.map(query=>queryBlock(query,preview.instructions,preview.model)).join(''):'<p class="hint">Wybierz sygnały w projekcie, aby zobaczyć zapytania dla kategorii.</p>'}</details>`;
}
document.addEventListener('toggle',event=>{if(event.target.matches?.('[data-opportunity-request-preview]')&&event.target.isConnected){const key=event.target.dataset.opportunityRequestPreview;event.target.open?opportunityRequestPanels.add(key):opportunityRequestPanels.delete(key)}},true);
function opportunityPage(category){const key=JSON.stringify([sellerProject().id,monitoringSimulation,category]);if(!opportunityPages.has(key))opportunityPages.set(key,1);return {key,page:opportunityPages.get(key)}}
function renderDiscoverOpportunities(){
 const root=$('#discover-opportunities');if(!root)return;
 if(root.contains(document.activeElement?.closest('[data-opportunity-filter]')))return;
 const project=sellerProject(),data=state.discovery_opportunities||{runs:[],items:[]},run=data.runs[0],active=data.runs.find(r=>['running','cancelling'].includes(r.status));
 const selected=(state.project_catalog||[]).filter(item=>(project.signal_interests||[]).includes(item.key)),groups=new Map();
 for(const type of selected.length?selected:(state.project_catalog||[])){if(!groups.has(type.category))groups.set(type.category,[]);groups.get(type.category).push(type)}
 const statuses={running:'Wyszukiwanie trwa',cancelling:'Zatrzymywanie wyszukiwania',completed:'Wyszukiwanie zakończone',partial:'Część kategorii wymaga ponowienia',error:'Wyszukiwanie wymaga uwagi',cancelled:'Wyszukiwanie zatrzymane',interrupted:'Wyszukiwanie przerwane',stale:'Kryteria projektu zmieniły się'};
 root.innerHTML=`<div class="panel-head"><div><h2>Okazje według kategorii</h2><p class="hint">Na podstawie oferty i katalogu bieżącego projektu. Ostatnie 30 dni.</p></div><button type="button" class="primary" data-find-opportunities ${active||!selected.length||!project.offer?.trim()||(!monitoringSimulation&&!state.integrations.ai)?'disabled':''}>Znajdź okazje</button></div><p class="hint">Wyszukiwanie uruchamiasz na żądanie. AI korzysta z internetu i może zużywać środki OpenAI.</p>${!selected.length?'<p class="notice">Wybierz typy sygnałów w katalogu projektu. <button type="button" class="link" data-open-project-catalog>Otwórz katalog projektu</button></p>':''}${!project.offer?.trim()?'<p class="hint"><button type="button" class="link" data-view="project">Uzupełnij ofertę projektu</button></p>':''}${!monitoringSimulation&&!state.integrations.ai?'<p class="hint"><button type="button" class="link" data-view="settings">Podłącz OpenAI</button></p>':''}${run?`<div class="opportunity-search-status" role="status"><strong><span>${esc(statuses[run.status]||run.status)}</span> · ${run.completed} / ${run.total}</strong><p data-no-translate>${esc(run.stage)}</p>${active?`<progress max="${run.total||1}" value="${run.completed||0}" aria-label="${esc(translateUiText('Postęp wyszukiwania okazji'))}"></progress><button type="button" class="link danger" data-cancel-opportunities="${active.id}" ${active.status==='cancelling'?'disabled':''}>Przerwij wyszukiwanie</button>`:''}${run.signature&&run.signature!==data.signature?'<p class="hint">Wyniki pochodzą z wcześniejszych kryteriów projektu. Uruchom nowe wyszukiwanie.</p>':''}${run.warnings?.length?`<details><summary><span>Niepotwierdzone wyniki i błędy:</span> ${run.warnings.length}</summary>${run.warnings.map(w=>`<p class="hint" data-no-translate>${esc(w)}</p>`).join('')}</details>`:''}</div>`:''}${renderOpportunityRequestPreview(data,run)}${opportunityFilterBar(data.items)}<div class="opportunity-categories ${!selected.length?'is-unconfigured':''}">${[...groups].filter(([category])=>!data.items.length||!opportunityFilter().category||category===opportunityFilter().category).map(([category,types])=>{
  const rows=filterOpportunities(data.items).filter(item=>types.some(type=>type.key===item.kind)),p=opportunityPage(category),pages=Math.max(1,Math.ceil(rows.length/5));p.page=Math.min(p.page,pages);opportunityPages.set(p.key,p.page);
  return `<details class="opportunity-category" data-opportunity-category="${esc(category)}" open><summary><strong>${esc(category)}</strong><span class="badge gray">${rows.length}</span>${!selected.length?'<span class="hint">Nie skonfigurowano</span>':''}</summary><p class="hint">${types.map(t=>esc(translateUiText(t.label))).join(' · ')}</p>${rows.slice((p.page-1)*5,p.page*5).map(item=>renderOpportunityCard(item,data.signature)).join('')||(data.items.some(item=>types.some(type=>type.key===item.kind))?'<p class="hint">Brak okazji spełniających filtry. Zmień lub wyczyść filtry.</p>':!selected.length?'<p class="hint">Wybierz interesujące zdarzenia w projekcie. <button type="button" class="link" data-open-project-catalog>Wybierz sygnały</button></p>':active?'<p class="hint" role="status">Sprawdzam źródła. Potwierdzone okazje pojawią się tutaj.</p>':run&&run.signature===data.signature&&['completed','partial'].includes(run.status)?'<p class="hint">W tym wyszukiwaniu nie znaleziono nowych potwierdzonych okazji w tej kategorii.</p>':'<p class="hint">Brak potwierdzonych okazji w tej kategorii. Kliknij „Znajdź okazje”, aby przeszukać internet.</p>')}${pages>1?`<nav class="discover-company-pagination"><button type="button" class="secondary" data-opportunity-page="${p.page-1}" data-category="${esc(category)}" ${p.page===1?'disabled':''}>Poprzednia</button><span class="hint"><span>Strona</span> ${p.page} / ${pages}</span><button type="button" class="secondary" data-opportunity-page="${p.page+1}" data-category="${esc(category)}" ${p.page===pages?'disabled':''}>Następna</button></nav>`:''}</details>`;
 }).join('')}</div>`;
}
function renderOpportunityCard(item,currentSignature){
 const type=(state.project_catalog||[]).find(t=>t.key===item.kind),key=JSON.stringify([sellerProject().id,monitoringSimulation,item.id]);
 return `<article class="opportunity-card" data-opportunity-id="${esc(item.id)}"><div class="panel-head"><div><span class="section-label">${esc(type?.label||item.kind)}</span><h3 data-no-translate>${esc(item.company)}</h3></div>${opportunityFit(item.relevance)}</div>${item.simulated?'<span class="badge warn">Symulacja</span>':''}<h4 data-no-translate>${esc(item.title)}</h4><p data-no-translate>${esc(item.summary)}</p><p class="hint"><span>Data zdarzenia:</span> ${esc(item.event_date||translateUiText('Niepotwierdzona'))}${item.published_date?` · <span>Publikacja:</span> ${esc(item.published_date)}`:''}${item.location?` · <span data-no-translate>${esc(item.location)}</span>`:''}</p><div class="opportunity-reason"><strong>Dlaczego ta firma?</strong><p data-no-translate>${esc(item.reason)}</p></div>${opportunityEvidenceGaps(item)}<blockquote data-no-translate>${esc(item.quote)}</blockquote>${item.sources.map(source=>`<p>${sourceLink(source.url)}</p>${source.quote!==item.quote?`<blockquote data-no-translate>${esc(source.quote)}</blockquote>`:''}`).join('')}${item.website?`<p class="hint"><span>Strona firmy:</span> ${sourceLink(item.website)}</p>`:''}${item.signature&&item.signature!==currentSignature?'<p class="hint">Ocena dotyczy wcześniejszych kryteriów projektu.</p>':''}<p class="hint">To możliwa okazja, nie potwierdzenie chęci zakupu.${sellerProject().search_areas?.length?' Lokalizacja w wybranym promieniu wymaga sprawdzenia.':''}</p>${opportunityReviewActions(item)}<details data-opportunity-contact="${esc(key)}" ${opportunityPanels.has(key)?'open':''}><summary>Znajdź kontakt w firmie</summary><p class="hint">Dane kontaktowe wyszukasz w panelu firmy poniżej.</p><button type="button" class="secondary" data-opportunity-company="${esc(item.company)}">Znajdź kontakt</button></details></article>`;
}

function opportunityFit(score){
 const value=Number(score);
 if(score===null||score===undefined||score===''||!Number.isFinite(value)||value<0||value>100)return '<span class="badge gray">Nie oceniono</span>';
 return `<div class="opportunity-fit"><span>Dopasowanie do oferty</span><strong>${value}<small>/100</small></strong><meter min="0" max="100" value="${value}" aria-label="${esc(translateUiText('Dopasowanie do oferty'))}">${value}/100</meter></div>`;
}
document.addEventListener('toggle',event=>{if(event.target.matches('[data-opportunity-contact]')&&event.target.isConnected){const key=event.target.dataset.opportunityContact;event.target.open?opportunityPanels.add(key):opportunityPanels.delete(key)}},true);
document.addEventListener('click',event=>{
 if(event.target.closest('[data-open-project-catalog]')){
  view='project';selectedCampaign=null;render();
  selectProjectTab('signals');
  const catalog=$('.project-interest-catalog');
  if(catalog){for(let node=catalog;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;catalog.scrollIntoView({block:'start',behavior:'smooth'});catalog.querySelector('input[type=checkbox]')?.focus({preventScroll:true})}
  return;
 }
 const find=event.target.closest('[data-find-opportunities]'),cancel=event.target.closest('[data-cancel-opportunities]'),page=event.target.closest('[data-opportunity-page]'),company=event.target.closest('[data-opportunity-company]');
 if(find)run(find,async()=>{await flushSellerProject();await api('discover/opportunities/start',{project_id:sellerProject().id});await refresh();toast('Wyszukiwanie okazji uruchomione w tle.');});
 if(cancel)run(cancel,async()=>{await api('discover/opportunities/cancel',{project_id:sellerProject().id,id:Number(cancel.dataset.cancelOpportunities)});await refresh()});
 if(page){const p=opportunityPage(page.dataset.category);opportunityPages.set(p.key,Number(page.dataset.opportunityPage));renderDiscoverOpportunities()}
 if(company){const index=discoverFirms().findIndex(firm=>firm.company===company.dataset.opportunityCompany);if(index>=0)discoverCompanyPage().page=Math.floor(index/discoverCompanyPage().size)+1;const p=discoverContactPanel(company.dataset.opportunityCompany);p.companyOpen=true;p.open=true;renderDiscoverCompanies();const panel=[...document.querySelectorAll('[data-discover-company]')].find(el=>el.dataset.discoverCompany===p.key);panel?.scrollIntoView({block:'start',behavior:'smooth'})}
});
const discoverContactPanels=new Map();let discoverContactPanelId=0;
const discoverCompanyPages=new Map();
function discoverCompanyPage(){
 const key=state.seller_project.id+':'+monitoringSimulation;
 if(!discoverCompanyPages.has(key))discoverCompanyPages.set(key,{page:1,size:10});
 return discoverCompanyPages.get(key);
}
function discoverCompanyPagination(p,total,position){
 if(!total)return '';
 const pages=Math.max(1,Math.ceil(total/p.size)),start=(p.page-1)*p.size+1,end=Math.min(p.page*p.size,total);
 return `<nav class="discover-company-pagination" aria-label="${esc(translateUiText('Strony firm'))}"><span class="hint" data-no-translate>${start}–${end} / ${total}</span>${position==='top'?`<label><span>Firm na stronie</span><select data-discover-page-size>${[10,25,50].map(size=>`<option value="${size}" ${p.size===size?'selected':''}>${size}</option>`).join('')}</select></label>`:''}<div class="actions"><button type="button" class="secondary" data-discover-page="1" ${p.page===1?'disabled':''}>« <span>Pierwsza</span></button><button type="button" class="secondary" data-discover-page="${p.page-1}" ${p.page===1?'disabled':''}>‹ <span>Poprzednia</span></button><span class="hint"><span>Strona</span> ${p.page} / ${pages}</span><button type="button" class="secondary" data-discover-page="${p.page+1}" ${p.page===pages?'disabled':''}><span>Następna</span> ›</button><button type="button" class="secondary" data-discover-page="${pages}" ${p.page===pages?'disabled':''}><span>Ostatnia</span> »</button></div></nav>`;
}
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-discover-page]');if(!button||button.disabled)return;
 discoverCompanyPage().page=Number(button.dataset.discoverPage);renderDiscoverCompanies();
 $('#discover-companies').scrollIntoView({block:'start'});
});

function renderDiscover(){
 if(!$('#discover-root'))$('#content').innerHTML=renderTop('Discover','Firmy znalezione dla bieżącego projektu.')+'<div id="discover-root"><section class="panel" id="discover-opportunities"></section><details class="panel" id="discover-companies" open></details></div>';
 if(!$('#discover-opportunities'))$('#discover-root').insertAdjacentHTML('afterbegin','<section class="panel" id="discover-opportunities"></section>');
 renderDiscoverOpportunities();
 renderDiscoverCompanies();
}
function discoverFirms(){
 const firms=new Map();
 for(const row of [...(state.discovery_opportunities?.items||[]),...(state.prospecting?.candidates||[]),...state.contacts]){const name=String(row.company||'').trim(),key=name.toLocaleLowerCase();if(!name)continue;if(!firms.has(key))firms.set(key,{company:name,domain:row.domain||''});else if(row.domain&&!firms.get(key).domain)firms.get(key).domain=row.domain}
 return [...firms.values()];
}
function renderDiscoverCompanies(){
 const root=$('#discover-companies');if(!root)return;
 if(root.contains(document.activeElement?.closest('[data-discover-contact-panel]')))return;
 const firms=discoverFirms();
 const pagination=discoverCompanyPage(),total=firms.length;
 pagination.page=Math.max(1,Math.min(pagination.page,Math.max(1,Math.ceil(total/pagination.size))));
 const rows=firms.slice((pagination.page-1)*pagination.size,pagination.page*pagination.size);
 root.innerHTML=`<summary><strong>Firmy/Instytucje</strong> <span class="badge gray">${total}</span></summary><p class="hint">Firmy z okazji, Leadów i Kontaktów. Dopasowanie jest oceniane po znalezieniu zdarzenia i sprawdzeniu jego źródła.</p>${discoverCompanyPagination(pagination,total,'top')}${rows.map(company=>{
  const panel=discoverContactPanel(company.company);if(!panel.domain&&!panel.result)panel.domain=company.domain;
  const opportunities=(state.discovery_opportunities?.items||[]).filter(item=>item.company.toLocaleLowerCase()===company.company.toLocaleLowerCase()),current=opportunities.filter(item=>item.simulated||item.signature===state.discovery_opportunities.signature),categories=[...new Set(opportunities.map(item=>item.category))];
  return `<details class="signal-card discover-company" data-discover-company="${esc(panel.key)}" ${panel.companyOpen?'open':''}><summary><span class="discover-company-toggle ${discoverCompanyHasContacts(company.company)?'has-contacts':''}" aria-hidden="true"></span><h3 data-no-translate>${esc(company.company)}</h3><span class="discover-company-fit">${current.length?opportunityFit(Math.max(...current.map(item=>item.relevance))):'<span class="badge gray">Nie oceniono</span>'}</span></summary><div class="discover-company-body">${categories.map(category=>`<span class="badge">${esc(category)}</span>`).join(' ')}${opportunities.length?`<p class="hint">Oceny i uzasadnienia znajdziesz w okazjach według kategorii powyżej.</p>`:''}${company.domain?`<p class="hint" data-no-translate>${esc(company.domain)}</p>`:''}${renderDiscoverContactPanel(company.company)}${discoverCampaignHandoff(company.company)}</div></details>`;
 }).join('')||empty('Brak firm w tym projekcie','Wyszukaj firmy w Leadach lub dodaj kontakty.')}<div class="actions"><button type="button" class="secondary" data-view="prospecting">Szukaj firm</button></div>${discoverCompanyPagination(pagination,total,'bottom')}`;
}
document.addEventListener('change',event=>{
 if(!event.target.matches('[data-discover-page-size]'))return;
 const p=discoverCompanyPage(),size=Number(event.target.value);if(![10,25,50].includes(size))return;
 p.size=size;p.page=1;renderDiscoverCompanies();
 $('#discover-companies [data-discover-page-size]')?.focus({preventScroll:true});
});
function discoverContactPanel(company){
 const projectId=state.seller_project.id,key=projectId+':'+monitoringSimulation+':'+company.toLocaleLowerCase();
 if(!discoverContactPanels.has(key))discoverContactPanels.set(key,{key,uid:++discoverContactPanelId,projectId,simulation:monitoringSimulation,company,open:false,domain:'',titles:'',limit:5,contactTags:{},selected:new Set(),confirmed:false,result:null,running:false,importing:false,message:'',error:''});
 return discoverContactPanels.get(key);
}
function discoverCompanyHasContacts(company){
 const key=company.normalize('NFC').trim().toLocaleLowerCase();
 const matches=value=>String(value||'').normalize('NFC').trim().toLocaleLowerCase()===key;
 return (state.contact_company_counts||[]).some(row=>row.total>0&&matches(row.company))||state.contacts.some(contact=>matches(contact.company));
}
function discoverCampaignHandoff(company){
 const contacts=state.contacts.filter(contact=>String(contact.company||'').trim().toLocaleLowerCase()===company.toLocaleLowerCase());
 if(!contacts.length)return '';
 const eligible=contacts.filter(contact=>contact.status==='active'&&!contact.simulated);
 return `<div class="discover-campaign-handoff"><strong>Kontakty w bazie:</strong> ${contacts.length}<p class="hint">Sprawdź adresy i tagi przed przygotowaniem kampanii. Kontakty nieaktywne i symulacyjne są pomijane.</p><div class="actions"><button type="button" class="secondary" data-discover-campaign="${esc(company)}" ${!eligible.length?'disabled':''}><span>Przygotuj kampanię</span> · ${eligible.length}</button><button type="button" class="link" data-view="contacts">Sprawdź kontakty i tagi</button></div></div>`;
}
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-discover-campaign]');if(!button||button.disabled)return;
 const projectId=sellerProject().id;
 const ids=state.contacts.filter(contact=>contact.status==='active'&&!contact.simulated&&String(contact.company||'').trim().toLocaleLowerCase()===button.dataset.discoverCampaign.toLocaleLowerCase()).map(contact=>contact.id);
 if(!ids.length)return;
 // The existing unsaved draft stays intact until the user chooses to replace it.
 const open=()=>{if(sellerProject().id!==projectId)return;try{localStorage.removeItem('campaign-builder-draft:'+sellerProject().id)}catch{}newCampaign();importCampaignProject();$('#build-name').value=button.dataset.discoverCampaign;$('#builder-campaign-title').textContent=button.dataset.discoverCampaign;$('#build-mode').value='selected';for(const input of document.querySelectorAll('[name=contact_ids]'))input.checked=ids.includes(Number(input.value));updateRecipientHint();persistBuilder()};
 let draft=null;try{draft=localStorage.getItem('campaign-builder-draft:'+sellerProject().id)}catch{}
 if(draft){modal('<h2>Masz niezapisany szkic kampanii</h2><p>Nowa kampania zastąpi szkic w tej przeglądarce.</p><div class="actions"><button type="button" class="primary" data-confirm-discover-campaign>Przygotuj nową kampanię</button><button type="button" class="secondary close">Anuluj</button></div>');$('[data-confirm-discover-campaign]').onclick=open}else open();
});
function discoverPersonTags(p,person){
 return p.contactTags[person.email]??contactTags(state.contacts.find(contact=>contact.email.toLowerCase()===person.email.toLowerCase())||[]);
}
function discoverPersonTagControl(p,person){
 const html=contactTagsControl(discoverPersonTags(p,person),'discover-person-tags-'+p.uid+'-'+person.id);
 return p.running||p.importing?html.replace(/<(input|select|button)\b/g,'<$1 disabled'):html;
}
function renderDiscoverContactPanel(company){
 const p=discoverContactPanel(company),result=p.result,contacts=result?.contacts||[],busy=p.running||p.importing;
 return `<details class="discover-contact-panel" data-discover-contact-panel="${esc(p.key)}" ${p.open?'open':''}><summary><strong>Znajdź kontakt</strong></summary><p class="hint">${monitoringSimulation?'Symulacja: wyszukiwanie pokazuje fikcyjne osoby i adresy email bez połączenia z Hunter.':'Hunter wyszuka publicznie znalezione adresy. Wyszukiwanie może zużywać kredyty. Dodanie kontaktów nie uruchamia wysyłki.'}</p><div class="row"><label>Domena firmy (opcjonalnie)<input type="text" data-discover-contact-field="domain" value="${esc(p.domain)}" placeholder="firma.pl" maxlength="2000"></label><label>Stanowiska (opcjonalnie)<input type="text" data-discover-contact-field="titles" value="${esc(p.titles)}" maxlength="500" placeholder="np. CEO, COO"></label></div><label>Liczba kontaktów<input type="number" data-discover-contact-field="limit" value="${esc(p.limit)}" min="1" max="10"></label><button type="button" class="secondary" data-discover-contact-action="search" ${busy||(!monitoringSimulation&&!state.prospecting?.hunter)?'disabled':''}>Szukaj kontaktów</button>${!monitoringSimulation&&!state.prospecting?.hunter?'<p class="hint">Podłącz Hunter w Integracjach.</p>':''}${busy?'<p class="hint" role="status">'+(p.running?'Szukam kontaktów…':'Dodaję wybrane kontakty…')+'</p>':''}${p.error?`<p class="error" role="alert" data-no-translate>${esc(p.error)}</p>`:''}${p.message?`<p class="hint" role="status" data-no-translate>${esc(p.message)}</p>`:''}${result?.simulated?renderSimulatedDiscoverContacts(result,p):result?`<div class="discover-contact-results">${result.simulated?'<p class="notice">Kontakty z symulacji nie są zapisywane w bazie.</p>':''}${result.domain?`<p><span>Znaleziona firma i domena:</span> <strong data-no-translate>${esc(result.organization||p.company)} · ${esc(result.domain)}</strong></p>`:''}${renderEnrichmentTrace(result.enrichment)}${contacts.map(person=>{const existing=state.contacts.find(c=>c.email.toLowerCase()===person.email.toLowerCase());return `<article class="discover-found-contact" data-discover-person="${esc(person.email)}"><label class="check"><input type="checkbox" data-discover-contact-select="${person.id}" ${p.selected.has(person.id)?'checked':''} ${result.simulated||busy?'disabled':''}><span data-no-translate><strong>${esc(person.name)}</strong><small>${esc(person.role)} · ${esc(person.email)}</small></span></label>${discoverPersonTagControl(p,person)}${existing?'<span class="badge gray">Już w kontaktach</span>':''}<details><summary>Źródła adresu</summary>${person.sources.map(source=>`<p>${sourceLink(source.url)}</p>`).join('')}</details></article>`}).join('')||'<p class="hint">Nie znaleziono kontaktów ze źródłami. Spróbuj podać domenę firmy lub inne stanowisko.</p>'}${contacts.length?`<label class="check"><input type="checkbox" data-discover-contact-confirm ${p.confirmed?'checked':''} ${result.simulated||busy?'disabled':''}><span>Potwierdzam, że znaleziona domena należy do właściwej firmy.</span></label><p class="hint">Adresy wymagają weryfikacji przed wysyłką. Wybrane istniejące kontakty trafią do wskazanej grupy bez zmiany ich statusu.</p><button type="button" class="primary" data-discover-contact-action="add" ${busy||result.simulated||!p.confirmed||!p.selected.size?'disabled':''}>Dodaj wybrane do kontaktów i grupy</button>`:''}</div>`:''}</details>`;
}
function renderSimulatedDiscoverContacts(result,p){
 const busy=p.running||p.importing;
 return `<section class="discover-contact-results discover-simulated-contacts" aria-label="${esc(translateUiText('Fikcyjne kontakty'))}"><h4><span>Fikcyjne kontakty</span> · ${result.contacts.length}</h4>${result.contacts.map(person=>`<article class="discover-found-contact" data-discover-person="${esc(person.email)}"><label class="check"><input type="checkbox" data-discover-contact-select="${person.id}" ${p.selected.has(person.id)?'checked':''} ${busy?'disabled':''}><span data-no-translate><strong>${esc(person.name)}</strong><small>${esc(person.role)}</small><span class="discover-contact-email">${esc(person.email)}</span></span></label>${discoverPersonTagControl(p,person)}</article>`).join('')}<label class="check"><input type="checkbox" data-discover-contact-confirm ${p.confirmed?'checked':''} ${busy?'disabled':''}><span>Potwierdzam dodanie fikcyjnych kontaktów do listy w symulacji.</span></label><button type="button" class="primary" data-discover-contact-action="add" ${busy||!p.confirmed||!p.selected.size?'disabled':''}>Dodaj wybrane do kontaktów i grupy</button><button type="button" class="secondary" data-discover-contact-action="persist" ${busy||!p.confirmed||!p.selected.size?'disabled':''}>Zapisz wybrane w bazie</button><p class="notice">Zapis w bazie wymaga listy kontaktów. Dane zachowają oznaczenie symulacji i będą pomijane przy rzeczywistej wysyłce.</p></section>`;
}
function refreshDiscoverContactPanel(p){
 if(view!=='discover'||state.seller_project.id!==p.projectId||monitoringSimulation!==p.simulation)return;
 const root=[...document.querySelectorAll('[data-discover-contact-panel]')].find(node=>node.dataset.discoverContactPanel===p.key);
 if(root){const parent=root.parentElement;root.outerHTML=renderDiscoverContactPanel(p.company);parent.querySelector('.discover-campaign-handoff')?.remove();parent.insertAdjacentHTML('beforeend',discoverCampaignHandoff(p.company))}
 const marker=[...document.querySelectorAll('[data-discover-company]')].find(node=>node.dataset.discoverCompany===p.key)?.querySelector('.discover-company-toggle');
 if(marker)marker.classList.toggle('has-contacts',discoverCompanyHasContacts(p.company));
}
document.addEventListener('toggle',event=>{
 const root=event.target;if(!root.isConnected)return;
 if(root.matches('[data-discover-company]')){const p=discoverContactPanels.get(root.dataset.discoverCompany);if(p)p.companyOpen=root.open;return}
 if(!root.matches('[data-discover-contact-panel]'))return;
 const p=discoverContactPanels.get(root.dataset.discoverContactPanel);if(p){p.open=root.open;if(p.open&&p.simulation&&!p.result&&!p.running)root.querySelector('[data-discover-contact-action=search]')?.click()}
},true);
document.addEventListener('input',event=>{
 const root=event.target.closest('[data-discover-contact-panel]');if(!root)return;
 const p=discoverContactPanels.get(root.dataset.discoverContactPanel);if(!p)return;
 const field=event.target.dataset.discoverContactField;
 if(field)p[field]=field==='limit'?Number(event.target.value):event.target.value;
 if(event.target.name==='tags'){const person=event.target.closest('[data-discover-person]');if(person)p.contactTags[person.dataset.discoverPerson]=contactTags(event.target.value)}
});
document.addEventListener('change',event=>{
 const root=event.target.closest('[data-discover-contact-panel]');if(!root)return;
 const p=discoverContactPanels.get(root.dataset.discoverContactPanel);if(!p)return;
 if(event.target.matches('[data-discover-contact-select]')){const id=Number(event.target.dataset.discoverContactSelect);event.target.checked?p.selected.add(id):p.selected.delete(id)}
 if(event.target.matches('[data-discover-contact-confirm]'))p.confirmed=event.target.checked;
 root.querySelectorAll('[data-discover-contact-action=add],[data-discover-contact-action=persist]').forEach(button=>button.disabled=p.running||p.importing||!p.confirmed||!p.selected.size);
});
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-discover-contact-action]');if(!button)return;
 const root=button.closest('[data-discover-contact-panel]'),p=discoverContactPanels.get(root.dataset.discoverContactPanel);if(!p||p.running||p.importing)return;
 run(null,async()=>{
  const search=button.dataset.discoverContactAction==='search';p.open=true;p.error='';p.message='';
  if(search)p.running=true;else p.importing=true;refreshDiscoverContactPanel(p);
  try{
   if(search){p.result=await api('discover/contacts/search',{project_id:p.projectId,company:p.company,domain:p.domain,titles:p.titles,limit:p.limit});p.selected.clear();p.confirmed=false;p.contactTags={}}
   else{
    if(!p.result)throw Error('Najpierw wyszukaj kontakty.');
    const persist=button.dataset.discoverContactAction==='persist';
    const result=await api(persist?'discover/contacts/add-simulation':'discover/contacts/add',{project_id:p.projectId,id:p.result.id,selected:[...p.selected],contacts:p.result.contacts.filter(person=>p.selected.has(person.id)),company:p.company,tags_by_contact:Object.fromEntries(p.result.contacts.filter(person=>p.selected.has(person.id)).map(person=>[person.email,discoverPersonTags(p,person)])),confirm_company:p.confirmed});
    p.selected.clear();p.message=translateUiText('Dodano:')+' '+result.added+' · '+translateUiText('Już w kontaktach:')+' '+result.existing;await refresh();
   }
  }catch(error){p.error=error.message;throw error}
  finally{p.running=false;p.importing=false;refreshDiscoverContactPanel(p)}
 });
});
