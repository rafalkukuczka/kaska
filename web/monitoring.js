let discoverReview={running:false,stop:false,completed:0,total:0};
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
function discoverPersonTags(p,person){
 return p.contactTags[person.email]??contactTags(state.contacts.find(contact=>contact.email.toLowerCase()===person.email.toLowerCase())||[]);
}
function discoverPersonTagControl(p,person){
 const html=contactTagsControl(discoverPersonTags(p,person),'discover-person-tags-'+p.uid+'-'+person.id);
 return p.running||p.importing?html.replace(/<(input|select|button)\b/g,'<$1 disabled'):html;
}
function renderDiscoverContactPanel(company){
 const p=discoverContactPanel(company),result=p.result,contacts=result?.contacts||[],busy=p.running||p.importing;
 return `<details class="discover-contact-panel" data-discover-contact-panel="${esc(p.key)}" ${p.open?'open':''}><summary><strong>Znajdź kontakt</strong></summary><p class="hint">${monitoringSimulation?'Symulacja: wyszukiwanie pokazuje fikcyjne osoby i adresy email bez połączenia z Hunter.':'Hunter wyszuka publicznie znalezione adresy. Wyszukiwanie może zużywać kredyty. Dodanie kontaktów nie uruchamia wysyłki.'}</p><div class="row"><label>Domena firmy (opcjonalnie)<input type="text" data-discover-contact-field="domain" value="${esc(p.domain)}" placeholder="firma.pl" maxlength="2000"></label><label>Stanowiska (opcjonalnie)<input type="text" data-discover-contact-field="titles" value="${esc(p.titles)}" maxlength="500" placeholder="np. CEO, COO"></label></div><label>Liczba kontaktów<input type="number" data-discover-contact-field="limit" value="${esc(p.limit)}" min="1" max="10"></label><button type="button" class="secondary" data-discover-contact-action="search" ${busy||(!monitoringSimulation&&!state.prospecting?.hunter)?'disabled':''}>Szukaj kontaktów</button>${!monitoringSimulation&&!state.prospecting?.hunter?'<p class="hint">Podłącz Hunter w Integracjach.</p>':''}${busy?'<p class="hint" role="status">'+(p.running?'Szukam kontaktów…':'Dodaję wybrane kontakty…')+'</p>':''}${p.error?`<p class="error" role="alert" data-no-translate>${esc(p.error)}</p>`:''}${p.message?`<p class="hint" role="status" data-no-translate>${esc(p.message)}</p>`:''}${result?.simulated?renderSimulatedDiscoverContacts(result,p):result?`<div class="discover-contact-results">${result.simulated?'<p class="notice">Kontakty z symulacji nie są zapisywane w bazie.</p>':''}${result.domain?`<p><span>Znaleziona firma i domena:</span> <strong data-no-translate>${esc(result.organization||p.company)} · ${esc(result.domain)}</strong></p>`:''}${contacts.map(person=>{const existing=state.contacts.find(c=>c.email.toLowerCase()===person.email.toLowerCase());return `<article class="discover-found-contact" data-discover-person="${esc(person.email)}"><label class="check"><input type="checkbox" data-discover-contact-select="${person.id}" ${p.selected.has(person.id)?'checked':''} ${result.simulated||busy?'disabled':''}><span data-no-translate><strong>${esc(person.name)}</strong><small>${esc(person.role)} · ${esc(person.email)}</small></span></label>${discoverPersonTagControl(p,person)}${existing?'<span class="badge gray">Już w kontaktach</span>':''}<details><summary>Źródła adresu</summary>${person.sources.map(source=>`<p>${sourceLink(source.url)}</p>`).join('')}</details></article>`}).join('')||'<p class="hint">Nie znaleziono kontaktów ze źródłami. Spróbuj podać domenę firmy lub inne stanowisko.</p>'}${contacts.length?`<label class="check"><input type="checkbox" data-discover-contact-confirm ${p.confirmed?'checked':''} ${result.simulated||busy?'disabled':''}><span>Potwierdzam, że znaleziona domena należy do właściwej firmy.</span></label><p class="hint">Adresy wymagają weryfikacji przed wysyłką. Wybrane istniejące kontakty trafią do wskazanej grupy bez zmiany ich statusu.</p><button type="button" class="primary" data-discover-contact-action="add" ${busy||result.simulated||!p.confirmed||!p.selected.size?'disabled':''}>Dodaj wybrane do kontaktów i grupy</button>`:''}</div>`:''}</details>`;
}
function renderSimulatedDiscoverContacts(result,p){
 const busy=p.running||p.importing;
 return `<section class="discover-contact-results discover-simulated-contacts" aria-label="${esc(translateUiText('Fikcyjne kontakty'))}"><h4><span>Fikcyjne kontakty</span> · ${result.contacts.length}</h4>${result.contacts.map(person=>`<article class="discover-found-contact" data-discover-person="${esc(person.email)}"><label class="check"><input type="checkbox" data-discover-contact-select="${person.id}" ${p.selected.has(person.id)?'checked':''} ${busy?'disabled':''}><span data-no-translate><strong>${esc(person.name)}</strong><small>${esc(person.role)}</small><span class="discover-contact-email">${esc(person.email)}</span></span></label>${discoverPersonTagControl(p,person)}</article>`).join('')}<label class="check"><input type="checkbox" data-discover-contact-confirm ${p.confirmed?'checked':''} ${busy?'disabled':''}><span>Potwierdzam dodanie fikcyjnych kontaktów do listy w symulacji.</span></label><button type="button" class="primary" data-discover-contact-action="add" ${busy||!p.confirmed||!p.selected.size?'disabled':''}>Dodaj wybrane do kontaktów i grupy</button><button type="button" class="secondary" data-discover-contact-action="persist" ${busy||!p.confirmed||!p.selected.size?'disabled':''}>Zapisz wybrane w bazie</button><p class="notice">Zapis w bazie wymaga listy kontaktów. Dane zachowają oznaczenie symulacji i będą pomijane przy rzeczywistej wysyłce.</p></section>`;
}
function refreshDiscoverContactPanel(p){
 if(view!=='discover'||state.seller_project.id!==p.projectId||monitoringSimulation!==p.simulation)return;
 const root=[...document.querySelectorAll('[data-discover-contact-panel]')].find(node=>node.dataset.discoverContactPanel===p.key);
 if(root)root.outerHTML=renderDiscoverContactPanel(p.company);
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
function discoverPendingSignals(){if(monitoringSimulation)return [];const revision=sellerProject().revision,monitoring=sig().monitoring||{},reviews=new Map((monitoring.reviews||[]).map(r=>[r.signal_id,r])),own=new Set((monitoring.monitors||[]).flatMap(m=>m.source_ids)),other=new Set(monitoring.other_source_ids||[]);return sig().items.filter(s=>!s.company&&s.status!=='dismissed'&&(!other.has(s.source_id)||own.has(s.source_id))&&reviews.get(s.id)?.revision!==revision)}
function renderDiscover(){
 if(!$('#discover-root')){
   $('#content').innerHTML=renderTop('Discover','Odkrywaj firmy, dla których Twoja oferta może być przydatna.',`<button class="secondary" data-signal="scan">${monitoringSimulation?'Symuluj skanowanie':'↻ Skanuj źródła'}</button>`)+`<div id="discover-root">${simulationBanner()}${projectContextLink()}<details class="panel" id="discover-companies"></details><div id="signal-content"></div></div>`;
 }
 const scan=$('#content .topline [data-signal=scan]');if(scan)scan.textContent=monitoringSimulation?'Symuluj skanowanie':'\u21bb Skanuj \u017ar\u00f3d\u0142a';
 renderDiscoverCompanies();renderMonitoring();
}
function renderDiscoverCompanies(){
 renderBackgroundProgress();
 const root=$('#discover-companies');if(!root)return;
 if(root.contains(document.activeElement?.closest('[data-discover-contact-panel]')))return;
 const demo=monitoringSimulation?allSimulationSignals():null;
 const rows=demo?demo.map(s=>({signal_id:s.id,company:s.company,quote:s.evidence,reason:s.reason})):(sig().monitoring?.companies||[]),signals=new Map((demo||sig().items).map(s=>[s.id,s]));
 const groups=new Map();
 for(const company of rows){const signal=signals.get(company.signal_id);if(!signal||signal.status==='dismissed')continue;const review=sig().monitoring?.reviews?.find(r=>r.signal_id===signal.id);const key=company.company.toLocaleLowerCase();if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...company,signal,review})}
 const pagination=discoverCompanyPage(),total=groups.size;
 pagination.page=Math.max(1,Math.min(pagination.page,Math.max(1,Math.ceil(total/pagination.size))));
 const pageGroups=[...groups.values()].slice((pagination.page-1)*pagination.size,pagination.page*pagination.size);
 root.innerHTML=`<summary><strong>Firmy warte uwagi</strong> <span class="badge gray">${groups.size}</span></summary><div class="panel-head"><div><p>Dlaczego mogą potrzebować Twoich usług — na podstawie zdarzeń i wspólnej oferty.</p></div></div><p class="hint">${monitoringSimulation?'Symulacja działa lokalnie, bez zapytań do AI i bez wysyłania wiadomości.':'AI wskazuje firmy wymienione w dowodach. Dopasowanie do oferty to hipoteza do sprawdzenia. Firmy możesz wskazać z poziomu zdarzeń monitoringu.'}</p>${discoverReview.running?`<p role="status"><span>Oceniono zdarzeń:</span> ${discoverReview.completed} / ${discoverReview.total}</p><button class="secondary" data-discover-stop ${discoverReview.stop?'disabled':''}>Przerwij ocenianie</button>`:''}${discoverCompanyPagination(pagination,total,'top')}${pageGroups.map(entries=>{const company=entries[0],panel=discoverContactPanel(company.company);return `<details class="signal-card discover-company" data-discover-company="${esc(panel.key)}" ${panel.companyOpen?'open':''}><summary><span class="discover-company-toggle ${discoverCompanyHasContacts(company.company)?'has-contacts':''}" aria-hidden="true"></span><h3 data-no-translate>${esc(company.company)}</h3><span class="badge gray">${entries.length} <span>zdarzeń</span></span></summary><div class="discover-company-body">${entries.map(entry=>`<div class="monitor-plan-row"><strong data-no-translate>${esc(entry.signal.title)}</strong>${!monitoringSimulation&&entry.review?.revision!==sellerProject().revision?'<p class="hint">Ocena dotyczy wcześniejszej wersji projektu. Oceń ponownie, aby uwzględnić zmiany.</p>':''}<p data-no-translate>${esc(entry.reason)}</p><blockquote data-no-translate>${esc(entry.quote)}</blockquote><p class="hint">${esc(signalLabel(entry.signal.kind))} · ${date(entry.signal.observed)}</p>${monitoringSimulation?'<span class="badge warn">Symulacja</span>':sourceLink(entry.signal.url)}</div>`).join('')}${renderDiscoverContactPanel(company.company)}</div></details>`}).join('')||empty('Jeszcze nie ma firm do oceny','Uruchom monitoring poniżej, pobierz zdarzenia i oceń wymienione w nich firmy. Oferta i punkty wartości pochodzą z projektu.')}${discoverCompanyPagination(pagination,total,'bottom')}`;
 const stop=$('[data-discover-stop]');if(stop)stop.onclick=()=>{discoverReview.stop=true;renderDiscoverCompanies()};
}
async function reviewDiscoverCompanies(){
 await flushSellerProject();
 const pending=discoverPendingSignals().slice(0,10);
 const project_id=sellerProject().id,review={running:true,stop:false,completed:0,total:pending.length};discoverReview=review;renderDiscoverCompanies();
 try{
   for(const signal of pending){if(review.stop||view!=='discover'||sellerProject().id!==project_id)break;await api('signals/monitoring/companies',{id:signal.id,project_id});review.completed++;await refresh()}
 }finally{review.running=false;renderBackgroundProgress();if(discoverReview===review)renderDiscoverCompanies()}
}
function monitorMatches(m,s){return m.source_ids.includes(s.source_id)&&m.plan.some(row=>row.topic.toLocaleLowerCase()===s.topic?.toLocaleLowerCase()&&(!row.signal_kinds.length||row.signal_kinds.includes(s.kind)))}
const openMonitorSourcePanels=new Set(),openMonitoringPanels=new Set();
function monitorSources(sources,mode='topic',plan=[],monitorId=''){
 const panelKey=sellerProject().id+':'+monitorId;
 const topicKey=topic=>topic.trim().normalize('NFC').toLocaleLowerCase('pl');
 const groups=new Map(plan.map(row=>[topicKey(row.topic),{...row,sources:[]}]));
 for(const source of sources){
   const topic=(JSON.parse(source.config||'{}').topic||source.company||source.name).trim().normalize('NFC'),key=topicKey(topic);
   if(!groups.has(key))groups.set(key,{topic,sources:[]});
   groups.get(key).sources.push(source);
 }
 return `<details class="monitor-source-list" data-monitor-source-panel="${esc(panelKey)}" ${openMonitorSourcePanels.has(panelKey)?'open':''}><summary><strong>${mode==='offer'?'Ofertowe źródła monitoringu':'Tematyczne źródła monitoringu'}</strong></summary>${[...groups.values()].map(group=>`<section class="monitor-source-group"><h5 data-no-translate>${esc(group.topic)}</h5>${group.reason?`<p class="monitor-topic-reason" data-no-translate>${esc(group.reason)}</p>`:''}${group.signal_kinds?`<p class="hint monitor-topic-kinds">${group.signal_kinds.length?group.signal_kinds.map(k=>esc(signalLabel(k))).join(' \u00b7 '):translateUiText('Wszystkie typy sygna\u0142\u00f3w')}</p>`:''}${!group.sources.length?'<p class="hint monitor-topic-kinds">Brak \u017ar\u00f3de\u0142 w tym temacie.</p>':''}${group.sources.map(source=>`<div class="monitor-source-row" data-monitor-source="${source.id}"><div><strong data-no-translate>${esc(sourceKindLabel(source.kind))}</strong><p class="hint">${source.enabled?'Włączone':'Wstrzymane'}</p></div>${monitoringSimulation?`<button class="link" data-simulation-source="${source.id}">3 <span>sygnały (symulacja)</span></button>`:''}<button class="link danger" data-signal="delete-source" data-id="${source.id}">Usuń źródło</button></div>`).join('')}</section>`).join('')||'<p class="hint">W tym monitoringu nie ma już źródeł.</p>'}</details>`;
}
function renderMonitorCard(m){const sources=sig().sources.filter(s=>m.source_ids.includes(s.id)),events=monitoringSimulation?sources.flatMap(simulationSignals):sig().items.filter(s=>monitorMatches(m,s));return `<article class="signal-card monitor-card"><div class="panel-head"><div><span class="section-label">${m.mode==='offer'?'Na podstawie oferty':'Monitoring tematu'}</span><h3 data-no-translate>${esc(m.name)}</h3></div><span class="badge ${sources.some(s=>s.enabled)?'':'gray'}">${sources.filter(s=>s.enabled).length} <span>aktywnych źródeł</span></span></div>${m.shared?'<p class="hint">Monitoring współdzielony</p>':''}${m.audience?`<p data-no-translate>${esc(m.audience)}</p>`:''}${m.search_areas?.length?`<p class="hint"><strong>Obszary monitoringu:</strong> <span data-no-translate>${esc(searchAreasLabel(m.search_areas))}</span></p>`:''}${monitorSources(sources,m.mode,m.plan,m.id)}<div class="actions"><button class="link" data-monitor-events="${m.id}"><span>Zobacz zdarzenia</span> (${events.length})</button><button class="link" data-monitor-sources>Zarządzaj źródłami</button><button class="link danger" data-monitor-delete="${m.id}">Usuń monitoring</button></div></article>`}
const closedOfferMonitoringPanels=new Set();
const closedTopicMonitoringPanels=new Set();
function renderMonitorCategory(mode,monitors){
 if(!monitors.length)return '';
 const cards=`<div class="monitor-cards-grid">${monitors.map(renderMonitorCard).join('')}</div>`;
 if(mode==='offer')return `<details class="panel monitor-category" data-monitor-category="offer" ${closedOfferMonitoringPanels.has(sellerProject().id)?'':'open'}><summary><strong>Monitoringi ofertowe</strong> <span class="badge gray">${monitors.length}</span></summary>${cards}</details>`;
 return `<details class="panel monitor-category" data-monitor-category="topic" ${closedTopicMonitoringPanels.has(sellerProject().id)?'':'open'}><summary><strong>Monitoringi tematyczne</strong> <span class="badge gray">${monitors.length}</span></summary>${cards}</details>`;
}
function renderMonitoring(){
 const monitoring=sig().monitoring||{monitors:[],companies:[]};
 $('#signal-content').innerHTML=`<details class="panel" id="my-monitoring" ${openMonitoringPanels.has(sellerProject().id)?'open':''}><summary><strong>Twoje monitoringi</strong> <span class="badge gray">${monitoring.monitors.length}</span></summary><section class="monitor-setup"><button type="button" class="link" data-monitor-sources>Konfiguracja źródeł w Sygnałach →</button>${sellerProject().offer?.trim()?'<p>Zacznij od swojej oferty albo wybierz temat rynku. Nie potrzebujesz firm w Kontaktach.</p>':'<p><button type="button" class="link" data-monitor-add-offer>Dodaj ofertę</button></p>'}<div class="monitor-mode-grid"><article class="monitor-mode"><span class="section-label">✧ AI</span><h3>Na podstawie oferty</h3><p>Kaśka dobierze tematy i typy sygnałów do wspólnej oferty, problemów i propozycji wartości.</p><button class="primary" data-monitor-offer ${state.integrations.ai?'':'disabled'}>Dobierz sygnały do oferty</button>${!state.integrations.ai?'<p class="hint">Podłącz OpenAI w Integracjach.</p>':''}</article><article class="monitor-mode"><span class="section-label">◫</span><h3>Monitoring tematu</h3><p>Wpisz branżę, technologię lub przepis. Monitoruj wiadomości bez podawania oferty i firmy.</p><button class="primary" data-monitor-topic>Monitoruj temat</button></article></div></section><div class="panel-head"><button class="link" data-monitor-company>Monitorowanie konkretnych firm →</button></div>${['offer','topic'].map(mode=>renderMonitorCategory(mode,monitoring.monitors.filter(m=>m.mode===mode))).join('')||empty('Wybierz sposób monitorowania','Plan z oferty lub własny temat zamieni się w źródła wiadomości i listę zdarzeń.')}</details>`;
 const monitoringPanel=$('#my-monitoring'),projectId=sellerProject().id;
 monitoringPanel.ontoggle=()=>{if(!monitoringPanel.isConnected)return;if(monitoringPanel.open)openMonitoringPanels.add(projectId);else openMonitoringPanels.delete(projectId)};
 const offerPanel=$('[data-monitor-category="offer"]');
 if(offerPanel)offerPanel.ontoggle=()=>{if(!offerPanel.isConnected)return;offerPanel.open?closedOfferMonitoringPanels.delete(projectId):closedOfferMonitoringPanels.add(projectId)};
 const topicPanel=$('[data-monitor-category="topic"]');
 if(topicPanel)topicPanel.ontoggle=()=>{if(!topicPanel.isConnected)return;topicPanel.open?closedTopicMonitoringPanels.delete(projectId):closedTopicMonitoringPanels.add(projectId)};
 const addOffer=$('[data-monitor-add-offer]');if(addOffer)addOffer.onclick=editSellerProject;
 $('[data-monitor-offer]').onclick=monitorOfferForm;
 $('[data-monitor-topic]').onclick=monitorTopicForm;
 $('[data-monitor-company]').onclick=()=>{view='signals';signalTab='sources';render()};
 document.querySelectorAll('[data-monitor-sources]').forEach(button=>button.onclick=()=>{view='signals';signalTab='sources';render()});
 document.querySelectorAll('[data-monitor-source-panel]').forEach(panel=>panel.ontoggle=()=>{if(panel.open)openMonitorSourcePanels.add(panel.dataset.monitorSourcePanel);else openMonitorSourcePanels.delete(panel.dataset.monitorSourcePanel)});
 document.querySelectorAll('[data-monitor-delete]').forEach(button=>button.onclick=()=>deleteMonitorForm(Number(button.dataset.monitorDelete)));
 document.querySelectorAll('[data-monitor-events]').forEach(button=>button.onclick=()=>{if(monitoringSimulation){const monitor=monitoring.monitors.find(m=>m.id===Number(button.dataset.monitorEvents));showSimulationSignals(simulationSources().filter(s=>monitor.source_ids.includes(s.id)).flatMap(simulationSignals));return}signalFilter={company:'',kind:'',status:'',scope:'market',monitor:Number(button.dataset.monitorEvents)};view='signals';signalTab='feed';render()});
}
function deleteMonitorForm(id){
 const monitor=sig().monitoring?.monitors.find(m=>m.id===id);if(!monitor)return;
 const project_id=sellerProject().id;
 modal(`<h2>Usunąć monitoring?</h2><p data-no-translate><strong>${esc(monitor.name)}</strong></p><p>Źródła używane tylko przez ten monitoring zostaną wstrzymane. Współdzielone źródła będą działały dalej. Dotychczasowe sygnały pozostaną zachowane.</p>${monitor.shared?'<p class="hint">Usunięcie tego monitoringu dotyczy wszystkich współdzielących go projektów.</p>':''}<p class="hint" role="status" data-monitor-delete-status></p><div class="actions"><button class="secondary close">Anuluj</button><button class="primary danger" data-monitor-delete-confirm>Usuń monitoring</button></div>`);
 $('[data-monitor-delete-confirm]').onclick=e=>run(e.currentTarget,async()=>{
   const status=$('[data-monitor-delete-status]'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   status.textContent='Usuwam monitoring…';
   try{await api('signals/monitoring/delete',{id,project_id},controller.signal);if(status.isConnected)$('#modal').close();await refresh();toast('Monitoring usunięty')}
   catch(error){const message=error.name==='AbortError'?'Przekroczono czas oczekiwania. Odśwież listę monitoringów.':error.message;if(status.isConnected)status.textContent=message;throw Error(message)}
   finally{clearTimeout(timer)}
 });
 $('#modal .close').focus();
}
function monitoringMapControls(){return `<h3>Obszary monitoringu</h3>${searchMapControls()}<p class="hint">Obszary zapisujemy jako zasięg monitoringu. Źródła wiadomości nie gwarantują filtrowania po promieniu; lokalizacja zdarzeń wymaga sprawdzenia.</p>`}
function bindMonitoringMap(form,areas=[]){form.elements.search_areas.value=JSON.stringify(areas||[]);bindSearchMap(form)}
function monitoringNotice(){return '<p class="hint">Google News i GDELT wyszukują dokładną frazę tematu. Nowe źródła wymagają ręcznej akceptacji. Istniejące źródła zachowują ustawienia akceptacji. Sam monitoring nie uruchamia wysyłki.</p>'}
function monitorOfferForm(){
 const project=sellerProject();
 if(!project.offer?.trim()){editSellerProject();toast('Najpierw uzupełnij wspólną ofertę.');return}
 modal(`<h2>Dobierz sygnały do oferty</h2><form id="monitor-offer-form"><p>Skorzystamy z projektu firmy.</p><p data-no-translate>${esc(project.website||'')}</p><div class="monitor-plan-row"><strong>Oferta</strong><p data-no-translate>${esc(project.offer)}</p></div>${[['pain_points','Problemy odbiorców'],['value_props','Propozycje wartości'],['proof_points','Proof points']].map(([field,label])=>project[field]?`<div class="monitor-plan-row"><strong>${label}</strong><p class="project-lines" data-no-translate>${esc(project[field])}</p></div>`:'').join('')}<button type="button" class="link" data-edit-seller>Edytuj projekt</button>${monitoringMapControls()}<p class="hint">AI przygotuje plan do sprawdzenia. To jedno zapytanie do płatnego OpenAI API. Monitoring uruchomisz po wybraniu tematów.</p><div class="actions"><button class="primary">Zaproponuj plan z AI</button><button type="button" class="secondary close">Anuluj</button></div><p role="status" class="hint" data-monitor-progress></p></form>`);
 const form=$('#monitor-offer-form');bindMonitoringMap(form,project.search_areas);
 $('[data-edit-seller]').onclick=()=>{$('#modal').close();editSellerProject()};
 form.onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{
   $('[data-monitor-progress]').textContent=translateUiText('Kaśka dobiera tematy i typy sygnałów…');
   try{await flushSellerProject();const result=await api('signals/monitoring/propose',{search_areas:readSearchAreas(form)});
     if(form.isConnected&&$('#modal').open)monitorPlanForm({...result,search_areas:readSearchAreas(form)});
   }finally{if(form.isConnected)form.querySelector('[data-monitor-progress]').textContent=''}
 })};
}
function monitorPlanForm(result){
 modal(`<h2>Plan monitorowania do sprawdzenia</h2><p>Wybierz tematy, które chcesz śledzić. Powiązanie z ofertą jest propozycją AI.</p><form id="monitor-plan-form">${result.plan.map((row,index)=>`<section class="monitor-plan-row"><label class="check"><input type="checkbox" name="selected" value="${index}" checked><strong data-no-translate>${esc(row.topic)}</strong></label><p data-no-translate>${esc(row.reason)}</p><p class="hint">${row.signal_kinds.length?row.signal_kinds.map(k=>esc(signalLabel(k))).join(' · '):translateUiText('Wszystkie typy sygnałów')}</p></section>`).join('')}${monitoringMapControls()}${monitoringNotice()}<div class="actions"><button class="primary">Uruchom wybrane monitoringi</button><button type="button" class="secondary close">Anuluj</button></div></form>`);
 bindMonitoringMap($('#monitor-plan-form'),result.search_areas);
 $('#monitor-plan-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{
   const selected=[...e.target.querySelectorAll('[name=selected]:checked')].map(input=>Number(input.value));
   if(!selected.length)throw Error('Wybierz co najmniej jeden temat z planu.');
   await api('signals/monitoring/activate',{id:result.id,project_id:result.project_id,selected,search_areas:readSearchAreas(e.target)});$('#modal').close();view='discover';await refresh();toast('Monitoring uruchomiony. Źródła będą sprawdzane w tle.');
 })};
}
function monitorTopicForm(){
 modal(`<h2>Monitoruj temat</h2><form id="monitor-topic-form"><label>Monitorowany temat<input name="topic" required minlength="2" maxlength="150" placeholder="np. fotowoltaika, NIS2, logistyka"></label><label>Typy sygnałów (opcjonalnie)<select name="kinds" multiple size="7">${kindOptions()}</select></label>${monitoringMapControls()}<p class="hint">Bez zaznaczonych typów zapiszemy wszystkie zdarzenia pasujące do tematu. Ten tryb nie wymaga AI ani oferty.</p>${monitoringNotice()}<div class="actions"><button class="primary">Uruchom monitoring tematu</button><button type="button" class="secondary close">Anuluj</button></div></form>`);
 bindMonitoringMap($('#monitor-topic-form'),sellerProject().search_areas);
 $('#monitor-topic-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{
   await api('signals/monitoring/topic',{topic:e.target.elements.topic.value,search_areas:readSearchAreas(e.target),signal_kinds:[...e.target.elements.kinds.selectedOptions].map(option=>option.value)});
   $('#modal').close();view='discover';await refresh();toast('Monitoring uruchomiony. Źródła będą sprawdzane w tle.');
 })};
}
function signalCompanies(signal){
 if(signal.simulated)return '<span class="badge warn">Symulacja pobierania</span>';
 const rows=(sig().monitoring?.companies||[]).filter(row=>row.signal_id===signal.id);
 return `${rows.length?`<details class="monitor-companies"><summary><span>Firmy wymienione w zdarzeniu</span> (${rows.length})</summary><p class="hint">Powiązanie z ofertą jest hipotezą do sprawdzenia.</p>${rows.map(row=>`<div class="monitor-plan-row"><strong data-no-translate>${esc(row.company)}</strong><blockquote data-no-translate>${esc(row.quote)}</blockquote><p data-no-translate>${esc(row.reason)}</p>${sourceLink(signal.url)}</div>`).join('')}</details>`:''}${!signal.company?`<button class="link" data-monitor-companies="${signal.id}" ${state.integrations.ai?'':'disabled'}>Wskaż firmy z AI</button>`:''}`;
}
document.addEventListener('click',e=>{
 const button=e.target.closest('[data-monitor-companies]');if(!button)return;
 run(button,async()=>{
   const result=await api('signals/monitoring/companies',{id:Number(button.dataset.monitorCompanies)});
   await refresh();toast(result.count?'Zapisano firmy z cytatami do sprawdzenia.':'W dowodzie nie znaleziono firm.');
 });
});
