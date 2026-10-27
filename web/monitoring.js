let discoverReview={running:false,stop:false,completed:0,total:0};
function discoverPendingSignals(){if(monitoringSimulation)return [];const revision=sellerProfile().revision,monitoring=sig().monitoring||{},reviews=new Map((monitoring.reviews||[]).map(r=>[r.signal_id,r])),own=new Set((monitoring.monitors||[]).flatMap(m=>m.source_ids)),other=new Set(monitoring.other_source_ids||[]);return sig().items.filter(s=>!s.company&&s.status!=='dismissed'&&(!other.has(s.source_id)||own.has(s.source_id))&&reviews.get(s.id)?.revision!==revision)}
function renderDiscover(){
 if(!$('#discover-root')){
   $('#content').innerHTML=renderTop('Discover','Odkrywaj firmy, dla których Twoja oferta może być przydatna.',`<button class="secondary" ${monitoringSimulation?'data-simulation-scan':'data-signal="scan"'}>${monitoringSimulation?'Symuluj skanowanie':'↻ Skanuj źródła'}</button>`)+`<div id="discover-root">${simulationBanner()}${sharedProfilePanel()}<section class="panel" id="discover-companies"></section><div id="signal-content"></div></div>`;
   bindDiscoverProfile();
 }
 renderDiscoverCompanies();renderMonitoring();
}
function renderDiscoverCompanies(){
 renderBackgroundProgress();
 const root=$('#discover-companies');if(!root)return;
 const demo=monitoringSimulation?allSimulationSignals():null;
 const rows=demo?demo.map(s=>({signal_id:s.id,company:s.company,quote:s.evidence,reason:s.reason})):(sig().monitoring?.companies||[]),signals=new Map((demo||sig().items).map(s=>[s.id,s]));
 const groups=new Map();
 for(const company of rows){const signal=signals.get(company.signal_id);if(!signal||signal.status==='dismissed')continue;const review=sig().monitoring?.reviews?.find(r=>r.signal_id===signal.id);const key=company.company.toLocaleLowerCase();if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...company,signal,review})}
 const pending=discoverPendingSignals();
 root.innerHTML=`<div class="panel-head"><div><h2>Firmy warte uwagi</h2><p>Dlaczego mogą potrzebować Twoich usług — na podstawie zdarzeń i wspólnej oferty.</p></div><button class="primary" data-discover-review ${!state.integrations.ai||discoverReview.running||!pending.length?'disabled':''}>Oceń firmy z nowych zdarzeń</button></div><p class="hint">${monitoringSimulation?'Symulacja działa lokalnie, bez zapytań do AI i bez wysyłania wiadomości.':'AI wskazuje firmy wymienione w dowodach. Dopasowanie do oferty to hipoteza do sprawdzenia. Jedno kliknięcie ocenia do 10 zdarzeń przez płatne OpenAI API.'}</p>${discoverReview.running?`<p role="status"><span>Oceniono zdarzeń:</span> ${discoverReview.completed} / ${discoverReview.total}</p><button class="secondary" data-discover-stop ${discoverReview.stop?'disabled':''}>Przerwij ocenianie</button>`:''}${[...groups.values()].map(entries=>{const company=entries[0];return `<article class="signal-card discover-company"><div class="panel-head"><h3 data-no-translate>${esc(company.company)}</h3><span class="badge gray">${entries.length} <span>zdarzeń</span></span></div>${entries.map(entry=>`<div class="monitor-plan-row"><strong data-no-translate>${esc(entry.signal.title)}</strong>${!monitoringSimulation&&entry.review?.revision!==sellerProfile().revision?'<p class="hint">Ocena dotyczy wcześniejszej wersji profilu. Oceń ponownie, aby uwzględnić zmiany.</p>':''}<p data-no-translate>${esc(entry.reason)}</p><blockquote data-no-translate>${esc(entry.quote)}</blockquote><p class="hint">${esc(signalLabel(entry.signal.kind))} · ${date(entry.signal.observed)}</p>${monitoringSimulation?'<span class="badge warn">Symulacja</span>':sourceLink(entry.signal.url)}</div>`).join('')}</article>`}).join('')||empty('Jeszcze nie ma firm do oceny','Uruchom monitoring poniżej, pobierz zdarzenia i oceń wymienione w nich firmy. Oferta i punkty wartości pochodzą z profilu.')}`;
 $('[data-discover-review]').onclick=e=>run(e.currentTarget,reviewDiscoverCompanies);
 const stop=$('[data-discover-stop]');if(stop)stop.onclick=()=>{discoverReview.stop=true;renderDiscoverCompanies()};
}
async function reviewDiscoverCompanies(){
 await flushSellerProfile();
 const pending=discoverPendingSignals().slice(0,10);
 const profile_id=sellerProfile().id,review={running:true,stop:false,completed:0,total:pending.length};discoverReview=review;renderDiscoverCompanies();
 try{
   for(const signal of pending){if(review.stop||view!=='discover'||sellerProfile().id!==profile_id)break;await api('signals/monitoring/companies',{id:signal.id,profile_id});review.completed++;await refresh()}
 }finally{review.running=false;renderBackgroundProgress();if(discoverReview===review)renderDiscoverCompanies()}
}
function monitorMatches(m,s){return m.source_ids.includes(s.source_id)&&m.plan.some(row=>row.topic.toLocaleLowerCase()===s.topic?.toLocaleLowerCase()&&(!row.signal_kinds.length||row.signal_kinds.includes(s.kind)))}
function monitorSources(sources,mode='topic',plan=[]){
 const topicKey=topic=>topic.trim().normalize('NFC').toLocaleLowerCase('pl');
 const groups=new Map(plan.map(row=>[topicKey(row.topic),{...row,sources:[]}]));
 for(const source of sources){
   const topic=(JSON.parse(source.config||'{}').topic||source.company||source.name).trim().normalize('NFC'),key=topicKey(topic);
   if(!groups.has(key))groups.set(key,{topic,sources:[]});
   groups.get(key).sources.push(source);
 }
 return `<div class="monitor-source-list"><h4>${mode==='offer'?'Ofertowe źródła monitoringu':'Tematyczne źródła monitoringu'}</h4>${[...groups.values()].map(group=>`<section class="monitor-source-group"><h5 data-no-translate>${esc(group.topic)}</h5>${group.reason?`<p class="monitor-topic-reason" data-no-translate>${esc(group.reason)}</p>`:''}${group.signal_kinds?`<p class="hint monitor-topic-kinds">${group.signal_kinds.length?group.signal_kinds.map(k=>esc(signalLabel(k))).join(' \u00b7 '):translateUiText('Wszystkie typy sygna\u0142\u00f3w')}</p>`:''}${!group.sources.length?'<p class="hint monitor-topic-kinds">Brak \u017ar\u00f3de\u0142 w tym temacie.</p>':''}${group.sources.map(source=>`<div class="monitor-source-row" data-monitor-source="${source.id}"><div><strong data-no-translate>${esc(sourceKindLabel(source.kind))}</strong><p class="hint">${source.enabled?'Włączone':'Wstrzymane'}</p></div>${monitoringSimulation?`<button class="link" data-simulation-source="${source.id}">3 <span>sygnały (symulacja)</span></button>`:''}<button class="link danger" data-signal="delete-source" data-id="${source.id}" ${monitoringSimulation?'disabled':''}>Usuń źródło</button></div>`).join('')}</section>`).join('')||'<p class="hint">W tym monitoringu nie ma już źródeł.</p>'}</div>`;
}
function renderMonitoring(){
 const monitoring=sig().monitoring||{monitors:[],companies:[]};
 $('#signal-content').innerHTML=`<section class="panel"><h2>Jak chcesz szukać okazji?</h2><p>Zacznij od swojej oferty albo wybierz temat rynku. Nie potrzebujesz firm w Kontaktach.</p><div class="monitor-mode-grid"><article class="monitor-mode"><span class="section-label">✧ AI</span><h3>Na podstawie oferty</h3><p>Kaśka dobierze tematy i typy sygnałów do wspólnej oferty, problemów i propozycji wartości.</p><button class="primary" data-monitor-offer ${state.integrations.ai?'':'disabled'}>Dobierz sygnały do oferty</button>${!state.integrations.ai?'<p class="hint">Podłącz OpenAI w Integracjach.</p>':''}</article><article class="monitor-mode"><span class="section-label">◫</span><h3>Monitoring tematu</h3><p>Wpisz branżę, technologię lub przepis. Monitoruj wiadomości bez podawania oferty i firmy.</p><button class="secondary" data-monitor-topic>Monitoruj temat</button></article></div></section><section class="panel"><div class="panel-head"><h2>Twoje monitoringi</h2><button class="link" data-monitor-company>Monitorowanie konkretnych firm →</button></div>${monitoring.monitors.map(m=>{const sources=sig().sources.filter(s=>m.source_ids.includes(s.id)),events=monitoringSimulation?sources.flatMap(simulationSignals):sig().items.filter(s=>monitorMatches(m,s));return `<article class="signal-card"><div class="panel-head"><div><span class="section-label">${m.mode==='offer'?'Na podstawie oferty':'Monitoring tematu'}</span><h3 data-no-translate>${esc(m.name)}</h3></div><span class="badge ${sources.some(s=>s.enabled)?'':'gray'}">${sources.filter(s=>s.enabled).length} <span>aktywnych źródeł</span></span></div>${m.audience?`<p data-no-translate>${esc(m.audience)}</p>`:''}${monitorSources(sources,m.mode,m.plan)}<div class="actions"><button class="link" data-monitor-events="${m.id}"><span>Zobacz zdarzenia</span> (${events.length})</button><button class="link" data-monitor-sources>Zarządzaj źródłami</button></div></article>`}).join('')||empty('Wybierz sposób monitorowania','Plan z oferty lub własny temat zamieni się w źródła wiadomości i listę zdarzeń.')}</section>`;
 $('[data-monitor-offer]').onclick=monitorOfferForm;
 $('[data-monitor-topic]').onclick=monitorTopicForm;
 $('[data-monitor-company]').onclick=()=>{view='signals';signalTab='sources';render()};
 document.querySelectorAll('[data-monitor-sources]').forEach(button=>button.onclick=()=>{view='signals';signalTab='sources';render()});
 document.querySelectorAll('[data-monitor-events]').forEach(button=>button.onclick=()=>{if(monitoringSimulation){const monitor=monitoring.monitors.find(m=>m.id===Number(button.dataset.monitorEvents));showSimulationSignals(simulationSources().filter(s=>monitor.source_ids.includes(s.id)).flatMap(simulationSignals));return}signalFilter={company:'',kind:'',status:'',scope:'market',monitor:Number(button.dataset.monitorEvents)};view='signals';signalTab='feed';render()});
}
function monitoringNotice(){return '<p class="hint">Google News i GDELT wyszukują dokładną frazę tematu. Nowe źródła wymagają ręcznej akceptacji. Istniejące źródła zachowują ustawienia akceptacji. Sam monitoring nie uruchamia wysyłki.</p>'}
function monitorOfferForm(){
 const profile=sellerProfile();
 if(!profile.offer?.trim()){editSellerProfile();toast('Najpierw uzupełnij wspólną ofertę.');return}
 modal(`<h2>Dobierz sygnały do oferty</h2><form id="monitor-offer-form"><p>Skorzystamy z profilu firmy.</p><p data-no-translate>${esc(profile.website||'')}</p><div class="monitor-plan-row"><strong>Oferta</strong><p data-no-translate>${esc(profile.offer)}</p></div>${[['pain_points','Problemy odbiorców'],['value_props','Propozycje wartości'],['proof_points','Proof points']].map(([field,label])=>profile[field]?`<div class="monitor-plan-row"><strong>${label}</strong><p class="profile-lines" data-no-translate>${esc(profile[field])}</p></div>`:'').join('')}<button type="button" class="link" data-edit-seller>Edytuj profil</button><p class="hint">AI przygotuje plan do sprawdzenia. To jedno zapytanie do płatnego OpenAI API. Monitoring uruchomisz po wybraniu tematów.</p><div class="actions"><button class="primary">Zaproponuj plan z AI</button><button type="button" class="secondary close">Anuluj</button></div><p role="status" class="hint" data-monitor-progress></p></form>`);
 const form=$('#monitor-offer-form');
 $('[data-edit-seller]').onclick=()=>{$('#modal').close();editSellerProfile()};
 form.onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{
   $('[data-monitor-progress]').textContent=translateUiText('Kaśka dobiera tematy i typy sygnałów…');
   try{await flushSellerProfile();const result=await api('signals/monitoring/propose',{});
     if(form.isConnected&&$('#modal').open)monitorPlanForm(result);
   }finally{if(form.isConnected)form.querySelector('[data-monitor-progress]').textContent=''}
 })};
}
function monitorPlanForm(result){
 modal(`<h2>Plan monitorowania do sprawdzenia</h2><p>Wybierz tematy, które chcesz śledzić. Powiązanie z ofertą jest propozycją AI.</p><form id="monitor-plan-form">${result.plan.map((row,index)=>`<section class="monitor-plan-row"><label class="check"><input type="checkbox" name="selected" value="${index}" checked><strong data-no-translate>${esc(row.topic)}</strong></label><p data-no-translate>${esc(row.reason)}</p><p class="hint">${row.signal_kinds.length?row.signal_kinds.map(k=>esc(signalLabel(k))).join(' · '):translateUiText('Wszystkie typy sygnałów')}</p></section>`).join('')}${monitoringNotice()}<div class="actions"><button class="primary">Uruchom wybrane monitoringi</button><button type="button" class="secondary close">Anuluj</button></div></form>`);
 $('#monitor-plan-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{
   const selected=[...e.target.querySelectorAll('[name=selected]:checked')].map(input=>Number(input.value));
   if(!selected.length)throw Error('Wybierz co najmniej jeden temat z planu.');
   await api('signals/monitoring/activate',{id:result.id,profile_id:result.profile_id,selected});$('#modal').close();view='discover';await refresh();toast('Monitoring uruchomiony. Źródła będą sprawdzane w tle.');
 })};
}
function monitorTopicForm(){
 modal(`<h2>Monitoruj temat</h2><form id="monitor-topic-form"><label>Monitorowany temat<input name="topic" required minlength="2" maxlength="150" placeholder="np. fotowoltaika, NIS2, logistyka"></label><label>Typy sygnałów (opcjonalnie)<select name="kinds" multiple size="7">${kindOptions()}</select></label><p class="hint">Bez zaznaczonych typów zapiszemy wszystkie zdarzenia pasujące do tematu. Ten tryb nie wymaga AI ani oferty.</p>${monitoringNotice()}<div class="actions"><button class="primary">Uruchom monitoring tematu</button><button type="button" class="secondary close">Anuluj</button></div></form>`);
 $('#monitor-topic-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{
   await api('signals/monitoring/topic',{topic:e.target.elements.topic.value,signal_kinds:[...e.target.elements.kinds.selectedOptions].map(option=>option.value)});
   $('#modal').close();view='discover';await refresh();toast('Monitoring uruchomiony. Źródła będą sprawdzane w tle.');
 })};
}
function signalCompanies(signal){
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
