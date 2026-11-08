let contactSearch='',contactGroupFilter='all',contactBulkMode=false,contactBulkTags=[],contactBulkBusy=false,contactBulkScope='';
const contactBulkSelected=new Set();
let state, view=['dashboard','discover','prospecting','contacts','campaigns','inbox','library','reports','settings','administration','project'].includes(location.hash.slice(1))?location.hash.slice(1):'dashboard', selectedCampaign=null;
const $=s=>document.querySelector(s);
function normalizeWebsite(value){
  let address=String(value||'').trim();
  if(!address)return '';
  if(address.startsWith('//'))address='https:'+address;
  else if(!/^[a-z][a-z0-9+.-]*:/i.test(address))address='https://'+address;
  let parsed;try{parsed=new URL(address)}catch{throw Error('Podaj poprawny adres strony, np. firma.pl.');}
  if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password||/\s/.test(address))throw Error('Podaj publiczny adres HTTPS firmy.');
  return parsed.href;
}
const websiteFields='#prospect-website,#company-url,#lib-website,#lib-url';
document.addEventListener('input',e=>{if(e.target.matches(websiteFields))e.target.setCustomValidity('')});
document.addEventListener('focusout',e=>{if(e.target.matches(websiteFields)){try{e.target.value=normalizeWebsite(e.target.value);e.target.setCustomValidity('')}catch(error){e.target.setCustomValidity(translateUiText(error.message))}}});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={draft:'Szkic',active:'Aktywna',paused:'Wstrzymana',sent:'Wysłano',queued:'W kolejce',cancelled:'Zatrzymano',uncertain:'Sprawdź wysyłkę',replied:'Odpowiedział',unsubscribed:'Rezygnacja',sending:'Wysyłanie'};
const badge=s=>`<span class="badge ${['paused','draft','cancelled'].includes(s)?'gray':s==='uncertain'?'warn':''}">${esc(labels[s]||s)}</span>`;
const date=v=>new Date(v*1000).toLocaleString(uiLanguage==='en'?'en-GB':'pl-PL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const empty=(title,text)=>`<div class="empty"><strong>${title}</strong>${text}</div>`;
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',6500)}
async function api(path,data,signal){
 if(['prospecting/search'].includes(path))data={...data,project_id:data.project_id??sellerProject().id};
 const simulate=shouldSimulateRequest(path,data),requestEpoch=simulationEpoch,progressId=beginBackgroundRequest(path);
 if(simulate){try{return await simulationApi(path,data)}finally{endBackgroundRequest(progressId)}}
 try{const res=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(data),signal});const result=await res.json();if(requestEpoch!==simulationEpoch)throw Error('Zmieniono tryb aplikacji. Odśwież dane.');if(!res.ok)throw Error(result.error);return result}
 finally{endBackgroundRequest(progressId)}
}

async function refresh(){const epoch=simulationEpoch,snapshot=await loadAppState();if(epoch!==simulationEpoch)return;state=snapshot;syncSellerProject();finishProspectDraft();render();syncLanguages()}
function modal(content){$('#modal-content').innerHTML=content;if($('#campaign-form')){$('#campaign-form').insertAdjacentHTML('afterbegin',`<label>Strona firmy (dowolna firma dla tej kampanii)</label><div class="actions"><input id="company-url" placeholder="https://twoja-firma.pl" aria-label="Strona firmy"><button type="button" class="secondary" data-action="research">Pobierz opis firmy</button></div><p id="research-status" class="hint">Opiszesz ofertę ręcznie albo pobierzesz kontekst z publicznej strony firmy. Sprawdź wynik przed zapisem.</p>`)}$('#modal').showModal()}
function campaignRows(){return state.campaigns.map(c=>{const messages=state.messages.filter(m=>m.campaign_id===c.id);const sent=messages.filter(m=>m.status==='sent').length;return `<tr><td><strong>${esc(c.name)}</strong><small>${esc(c.audience||campaignAudience(c))}</small></td><td>${badge(c.status)}</td><td>${sent} / ${messages.length}</td><td><button class="link" data-action="campaign" data-id="${c.id}">Otwórz →</button> <button class="link" data-action="edit-campaign" data-id="${c.id}">Edytuj</button> <button class="link danger" data-action="delete-campaign" data-id="${c.id}">Usuń kampanię</button></td></tr>`}).join('')}
function campaignTable(){return state.campaigns.length?`<div class="table-wrap"><table><thead><tr><th>Kampania</th><th>Status</th><th>Wysłano</th><th></th></tr></thead><tbody>${campaignRows()}</tbody></table></div>`:empty('Twoja pierwsza kampania zaczyna się tutaj','Dodaj kontakty, opisz ofertę i przygotuj wiadomości.')}
function replyMailLinks(reply,contact){
 const email=String(reply.email||contact?.email||'').trim();
 const valid=value=>/^[^\s@<>;,?&:#]+@[^\s@<>;,?&:#]+\.[^\s@<>;,?&:#]+$/.test(value);
 if(!valid(email))return null;
 const raw=String(reply.subject||'').replace(/\s+/g,' ').trim().slice(0,250),subject=/^re\s*:/i.test(raw)?raw:'Re: '+raw;
 const params=new URLSearchParams({view:'cm',fs:'1',to:email,su:subject});
 const sender=String(state.integrations.sender||'').trim(),account=sender.match(/<([^<>]+)>/)?.[1]||sender;
 if(valid(account))params.set('authuser',account);
 return {email,subject,gmail:'https://mail.google.com/mail/?'+params,mailto:'mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(subject)};
}
function renderInbox(){
 $('#content').innerHTML=renderTop('Odpowiedzi','Każda wykryta odpowiedź zatrzymuje sekwencję dla danej osoby.',`<button class="primary" data-action="sync">↻ Synchronizuj pocztę</button>`)+(!monitoringSimulation&&!state.integrations.imap?'<div class="notice">Odczyt odpowiedzi wymaga podłączenia IMAP w integracjach.</div>':'')+`<section class="panel">${state.replies.map(reply=>{
  const contact=state.contacts.find(c=>c.id===reply.contact_id),links=replyMailLinks(reply,contact);
  return `<article class="inbox-reply"><div class="panel-head"><h3 data-no-translate>${esc(contact?.name||reply.contact_name||reply.email||'Kontakt')} · ${esc(reply.subject)}</h3><small class="muted">${date(reply.received)}</small></div>${reply.delivery_simulated?'<span class="badge warn">Symulowana odpowiedź</span>':''}<div class="message">${esc(reply.body)}</div>${links?`<div class="actions"><a href="${esc(links.gmail)}" class="button secondary" target="_blank" rel="noopener noreferrer" data-reply-gmail>Odpowiedz w Gmailu ↗</a><a href="${esc(links.mailto)}" class="link" data-reply-mailto>Otwórz aplikację pocztową</a></div><p class="hint" data-no-translate>${esc(links.email)}</p>`:'<p class="hint">Brak adresu email nadawcy odpowiedzi.</p>'}</article>`;
 }).join('')||empty('Jeszcze bez odpowiedzi','Po podłączeniu IMAP odpowiedzi z ostatnich 200 wiadomości w skrzynce będą sprawdzane co minutę.')}</section>`;
}
function renderTop(title,sub,action=''){if(title==='Integracje')action='<button class="primary" data-action="connect-gmail">Podłącz Gmail</button>';return `<div class="topline"><div><h1>${title}</h1><p class="muted">${sub}</p></div>${action}</div>${monitoringSimulation?'<p class="notice app-simulation-notice">Symulowane są pobieranie danych, wysyłka i odpowiedzi. Twoje wpisy i konfiguracja są zapisywane normalnie. Wiadomości nie są wysyłane do klientów.</p>':''}`}
const dashboardSearchDrafts=new Map();
function searchRefinement(project){
 const cached=dashboardSearchDrafts.get(project.id);
 if(cached?.source===leadBriefSource(project))return cached.text;
 try{const saved=JSON.parse(sessionStorage.getItem('kaska-search-refinement:'+project.id)||'null');if(saved?.source===leadBriefSource(project))return saved.text||''}catch{}
 return '';
}
function setSearchRefinement(project,text){
 const value={source:leadBriefSource(project),text};dashboardSearchDrafts.set(project.id,value);
 try{sessionStorage.setItem('kaska-search-refinement:'+project.id,JSON.stringify(value))}catch{}
}
function refinedLeadBrief(project,refinement){
 return [projectLeadBrief(project),refinement?translateUiText('Doprecyzowanie tego wyszukiwania:')+'\n'+refinement:''].filter(Boolean).join('\n\n');
}
function dashboardCanSearch(project,refinement=''){
 return [project.offer,project.audience,refinement].some(value=>String(value||'').trim().length>=10);
}
function dashboardWelcomePanel(leads=false){
 const project=sellerProject(),draft=searchRefinement(project);
 return `<section class="hero dashboard-welcome"><div class="welcome-decoration welcome-decoration-left" aria-hidden="true"></div><div class="welcome-decoration welcome-decoration-right" aria-hidden="true"></div><div class="welcome-content"><div class="welcome-intro"><img src="/assets/kaska.png" alt="" class="welcome-avatar"><div><p class="welcome-greeting">Dobrze Cię widzieć!</p><h2>Kogo dziś szukamy?</h2></div></div><${leads?'div':'form'} id="dashboard-search-form" data-project-id="${project.id}" data-search-view="${leads?'leads':'dashboard'}"><label class="welcome-search-label" for="dashboard-audience">Doprecyzuj wyszukiwanie (opcjonalnie)</label><div class="welcome-search"><input id="dashboard-audience" value="${esc(draft)}" maxlength="3000" placeholder="np. tym razem tylko producenci żywności"><button type="submit" class="primary" ${leads?'id="prospect-search" form="prospect-form"':''} ${dashboardCanSearch(project,draft)?'':'disabled'}>Szukaj <span aria-hidden="true">↗</span></button></div><p class="hint dashboard-search-context"><span>Korzystasz z kryteriów projektu</span> <strong data-no-translate>${esc(project.name)}</strong> <button type="button" class="link" data-view="project">Zmień kryteria</button></p><p class="hint">Puste pole oznacza wyszukiwanie według projektu. Doprecyzowanie dotyczy tylko tego wyszukiwania.</p></${leads?'div':'form'}><div class="welcome-shortcuts"><button type="button" class="secondary" data-view="discover">Odkryj firmy</button><button type="button" class="secondary" data-view="contacts">Twoje kontakty</button><button type="button" class="secondary" data-view="reports">Zobacz raporty</button><button type="button" class="secondary" data-action="new-campaign">Nowa kampania</button></div><p class="welcome-project"><span>Bieżący projekt:</span> <strong data-no-translate>${esc(project.name)}</strong></p></div></section>`;
}
function bindDashboardWelcome(){
 const form=$('#dashboard-search-form');if(!form)return;
 const projectId=state.seller_project.id,input=$('#dashboard-audience'),leads=form.dataset.searchView==='leads';let submitting=false;
 const button=form.querySelector('button[type=submit]'),sync=()=>{button.disabled=submitting||!dashboardCanSearch(sellerProject(),input.value)||(leads&&($('#prospect-form')?.dataset.searching==='true'||$('#prospect-form')?.dataset.translating==='true'||!state.prospecting?.hunter||state.prospecting.runs.some(r=>['searching','verifying','drafting'].includes(r.status))||leadImportBusy.size>0))};
 input.oninput=()=>{const project=sellerProject();setSearchRefinement(project,input.value);if(leads){const brief=refinedLeadBrief(project,input.value.trim());$('#prospect-lead-brief').value=brief;cacheLeadBrief(project,brief);$('#prospect-lead-brief').oninput()}sync()};sync();
 if(leads){input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();if(!button.disabled)$('#prospect-form').requestSubmit(button)}};return}
 form.onsubmit=event=>{event.preventDefault();if(submitting||!dashboardCanSearch(sellerProject(),input.value))return;submitting=true;run(event.submitter||button,async()=>{try{
  const refinement=input.value.trim();await flushSellerProject();
  if(state.seller_project.id!==projectId)return;
  const project=sellerProject();
  const brief=refinedLeadBrief(project,refinement);
  if(brief.length>3000)throw Error(translateUiText('Opis wyszukiwania jest za długi. Skróć doprecyzowanie lub kryteria projektu.'));
  cacheLeadBrief(project,brief);
  setSearchRefinement(project,refinement);view='prospecting';render();syncLanguages();
  $('#prospect-lead-brief').value=brief;
  const search=$('#prospect-search');
  if(search.disabled){
   const message=translateUiText(!state.prospecting?.hunter?'Podłącz Hunter w Integracjach.':'Operacja już trwa. Poczekaj na jej zakończenie.');
   $('#prospect-feedback').textContent=message;toast(message);return;
  }
  $('#prospect-form').requestSubmit(search);
 }finally{submitting=false}}).finally(sync)};
}
function render(){if(state&&view==='dashboard'&&document.activeElement?.id==='dashboard-audience'&&Number($('#dashboard-search-form')?.dataset.projectId)===state.seller_project.id)return;renderSimulationControl();renderBackgroundProgress();if(state)renderProjectPicker();if(!state||view==='builder')return;history.replaceState(null,'','#'+view);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));$('#breadcrumb').textContent='Przestrzeń robocza / '+({dashboard:'Dashboard',reports:'Raporty',administration:'Administracja',project:'Projekt',contacts:'Kontakty',campaigns:'Kampanie',inbox:'Odpowiedzi',settings:'Integracje',signals:'Sygnały sprzedażowe'}[view]);const el=$('#content');if(view==='prospecting'){$('#breadcrumb').textContent='Przestrze\u0144 robocza / Znajd\u017a klient\u00f3w';renderProspecting();return}if(view==='discover'){$('#breadcrumb').textContent='Przestrze\u0144 robocza / Discover';renderDiscover();return}if(view==='library'){renderLibrary();return}if(view==='project'){renderSellerProject();return}if(view==='reports'){renderReports();return}
if(view==='dashboard'){const sent=state.messages.filter(m=>m.status==='sent').length;el.innerHTML=renderTop('Dashboard',new Intl.DateTimeFormat(uiLanguage==='en'?'en-GB':'pl-PL',{dateStyle:'long',timeZone:'Europe/Warsaw'}).format(new Date()))+dashboardWelcomePanel()+dashboardActionsPanel()+`<div class="stats">${[['Kontakty',state.totals.contacts,'Twoja baza potencjalnych klientów'],['Aktywne kampanie',state.campaigns.filter(c=>c.status==='active').length,'Sekwencje pracujące dla Ciebie'],['Wysłane wiadomości',sent,'Potwierdzone przez serwer SMTP'],['Odpowiedzi',state.replies.length,'Rozmowy wykryte przez IMAP']].map(([l,n,t])=>`<div class="stat"><p>${l}</p><strong>${n}</strong><small>${t}</small></div>`).join('')}</div><div class="grid"><section class="panel"><div class="panel-head"><h2>Twoje kampanie</h2><button class="link" data-view="campaigns">Zobacz wszystkie →</button></div>${campaignTable()}</section><section class="panel"><h2>Ostatnia aktywność</h2>${state.events.slice(0,7).map(e=>`<div class="activity">${esc(e.detail)}<small>${date(e.created)}</small></div>`).join('')||empty('Czysta karta','Tutaj pojawią się zdarzenia z Twoich kampanii.')}<button class="link" data-view="settings">Sprawdź integracje →</button></section></div>`}
if(view==='dashboard'){const stats=$('#content .stats');stats.classList.add('dashboard-stats');stats.children[0].insertAdjacentHTML('afterend',projectCoverageTile());bindProjectCoverageTile();stats.insertAdjacentHTML('beforebegin',dashboardFlowPanel());stats.insertAdjacentHTML('afterend',dashboardActivityPanel());bindDashboardWelcome();renderDashboardActivity()}
if(view==='contacts'){renderContactsView()}
if(view==='campaigns'){if(selectedCampaign){renderCampaign();return}el.innerHTML=renderTop('Kampanie','Od pierwszego kontaktu do następnej rozmowy.',`<button class="primary" data-action="new-campaign">+ Nowa kampania</button>`)+`<section class="panel">${campaignTable()}</section>`}
if(view==='inbox'){renderInbox()}
if(view==='administration'){renderAdministration()}
if(view==='settings'){renderSettings()}}
function renderCampaign(){const campaign=state.campaigns.find(c=>c.id===selectedCampaign);if(!campaign){selectedCampaign=null;render();return}renderCampaignWorkspace(campaign)}
function newCampaign(){openCampaignBuilder()}
function confirmCampaignDelete(id){
  const campaign=state.campaigns.find(c=>c.id===id);if(!campaign)return;
  modal(`<h2>Usunąć kampanię?</h2><p data-no-translate><strong>${esc(campaign.name)}</strong></p><p>Kampania zniknie z listy, a oczekujące wiadomości zostaną anulowane. Kontakty i historia wysyłek pozostaną zachowane. Tej operacji nie można cofnąć w aplikacji.</p><div class="actions"><button type="button" class="secondary" data-delete-cancel>Anuluj</button><button type="button" class="primary danger" data-delete-confirm>Usuń kampanię</button></div>`);
  $('#modal-content').insertAdjacentHTML('beforeend','<p class="hint" role="status" data-delete-status></p>');
  $('[data-delete-cancel]').onclick=()=>$('#modal').close();
  $('[data-delete-confirm]').onclick=e=>run(e.currentTarget,async()=>{
    const status=$('[data-delete-status]'),controller=new AbortController();
    status.textContent='Usuwam kampanię…';
    const timer=setTimeout(()=>controller.abort(),10000);
    try{
      await api('campaign/delete',{id},controller.signal);
      if(status.isConnected)$('#modal').close();
      if(selectedCampaign===id)selectedCampaign=null;
      await refresh();toast('Kampania usunięta');
    }catch(error){
      const message=error.name==='AbortError'?'Przekroczono czas oczekiwania. Odśwież listę, aby sprawdzić, czy kampania została usunięta.':error.message;
      if(status.isConnected)status.textContent=message;
      throw Error(message);
    }finally{clearTimeout(timer)}
  });
  $('[data-delete-cancel]').focus();
}
function addStep(){const n=document.querySelectorAll('.step').length;if(n>=6)return toast('Maksymalnie 6 kroków');const lang=$('#build-language')?.value||state.preferences.message_language,spec=state.languages[lang];$('#steps').insertAdjacentHTML('beforeend',`<div class="step"><h3>Krok ${n+1}</h3><label>Dzień wysyłki</label><input name="delay" type="number" min="0" max="365" value="${n*3}" required><label>Temat</label><input name="subject" value="${esc(n?spec.follow_subject:spec.subject)}" required><label>Treść</label><textarea name="body" required>${esc(n?spec.follow_body:spec.body)}</textarea></div>`)}
async function run(button,fn){if(button)button.disabled=true;try{await fn()}catch(e){toast(e.message)}finally{if(button)button.disabled=false}}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.classList.contains('close'))return $('#modal').close();if(b.dataset.view){view=b.dataset.view;selectedCampaign=null;render();return}const a=b.dataset.action,id=Number(b.dataset.id);if(!a)return;run(b,async()=>{if(a==='new-contact'){modal(`<h2>Dodaj kontakt</h2><form id="contact-form">${contactTagsControl()}<label>Imię i nazwisko</label><input name="name" required><label>Email</label><input name="email" type="email" required><div class="row"><div><label>Firma</label><input name="company"></div><div><label>Stanowisko</label><input name="role"></div></div><label>Kontekst / notatki dla AI</label><textarea name="notes"></textarea><button class="primary">Zapisz kontakt</button></form>`);$('#contact-form').onsubmit=async e=>{e.preventDefault();await run(e.submitter,async()=>{await api('contacts',Object.fromEntries(new FormData(e.target)));$('#modal').close();await refresh();toast('Kontakt zapisany')})}}if(a==='import'){modal(`<h2>Import kontaktów</h2><p>CSV z nagłówkami: <code>name,email,company,role,notes,tags</code>. Wymagana jest kolumna email; duplikaty są pomijane. Maksymalnie 2 MB.</p>${contactTagsControl()}<label>Plik CSV</label><input id="csv-file" type="file" accept=".csv,text/csv"><p class="hint">Obsługiwany separator: przecinek lub średnik. W razie błędnego adresu cały import jest wycofywany.</p><button class="primary" data-action="upload-csv">Importuj kontakty</button>`)}if(a==='upload-csv'){const file=$('#csv-file').files[0];if(!file)throw Error('Wybierz plik CSV');await api('import',{csv:await file.text(),tags:$('#contact-tags').value});$('#modal').close();await refresh();toast('Import zakończony')}if(a==='delete-campaign')confirmCampaignDelete(id);if(a==='new-campaign')newCampaign();if(a==='edit-campaign')await editCampaign(id);if(a==='add-step')addStep();if(a==='campaign'){selectedCampaign=id;view='campaigns';render()}if(a==='back'){selectedCampaign=null;render()}if(a==='prepare'){toast('Przygotowuję wiadomości. Przy użyciu AI może to potrwać kilka minut.');await api('campaign/prepare',{id});await refresh();toast('Wiadomości gotowe do sprawdzenia')}if(a==='campaign-status'){if(b.dataset.status==='active'&&!monitoringSimulation){await showCampaignPreflight(id);return}await api('campaign/status',{id,status:b.dataset.status});await refresh();toast(b.dataset.status==='active'?'Kampania uruchomiona':'Kampania wstrzymana')}if(a==='contact-group')contactGroupForm(id);if(a==='contact-status'){await api('contact/status',{id,status:b.dataset.status});await refresh();toast('Zatrzymano dalsze wiadomości do kontaktu')}if(a==='sync'){await api('sync',{});await refresh();toast('Poczta zsynchronizowana')}if(a==='message'){const m=findCampaignMessage(id);if(!m)throw Error('Nie znaleziono wiadomości.');const editable=m.status==='queued'&&state.campaigns.find(c=>c.id===m.campaign_id)?.status!=='active';modal(`<h2>Wiadomość · krok ${m.position+1}</h2><form id="message-form"><label>Temat</label><input name="subject" value="${esc(m.subject)}" ${editable?'':'readonly'}><label>Treść</label><textarea name="body" rows="12" ${editable?'':'readonly'}>${esc(m.body)}</textarea>${editable?'<button class="primary">Zapisz zmiany</button>':'<p class="hint">Aby edytować oczekującą wiadomość, wstrzymaj kampanię.</p>'}</form>`);$('#message-form').onsubmit=async e=>{e.preventDefault();await run(e.submitter,async()=>{await api('message',{id,...Object.fromEntries(new FormData(e.target))});$('#modal').close();await refresh();toast('Zapisano wiadomość')})}}})});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const a=b.dataset.action;if(a==='research')run(b,async()=>{const url=$('#company-url').value;if(!url)throw Error('Podaj adres strony firmy');$('#research-status').textContent='Pobieram kontekst firmy…';const result=await api('research',{url});$('#campaign-form [name=offer]').value=result.offer;$('#campaign-form [name=audience]').value=result.audience;$('#research-status').textContent=`Źródło: ${result.source}. ${result.ai?'Opis i grupa klientów zaproponowane przez AI — sprawdź je.':'Pobrano opis ze strony. Uzupełnij ofertę i grupę klientów; AI nie jest podłączone.'}`});if(a==='connect-gmail'){modal(`<h2>Podłącz Gmail / Google Workspace</h2><p>Sprawdzimy logowanie do wysyłki i odczytu odpowiedzi. Nie wyślemy wiadomości testowej.</p><form id="gmail-form"><label>Adres email</label><input name="email" type="email" autocomplete="username" required placeholder="ty@twoja-firma.pl"><label>Hasło aplikacji Google</label><input name="password" type="password" autocomplete="new-password" required placeholder="16 liter hasła aplikacji"><p class="hint">Użyj hasła aplikacji, nie zwykłego hasła do konta Google. <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Utwórz hasło aplikacji ↗</a>. Dostępność zależy od ustawień konta i administratora Workspace. <a href="https://support.google.com/a/answer/176600" target="_blank" rel="noopener">Instrukcja Google</a>.</p><p class="hint">Dane zostaną zapisane w lokalnym pliku .env, pomijanym przez Git. Dostęp do pliku powinien mieć tylko właściciel tego komputera.</p><button class="primary">Sprawdź i podłącz</button></form>`);$('#gmail-form').onsubmit=async e=>{e.preventDefault();await run(e.submitter,async()=>{await api('integrations/gmail',Object.fromEntries(new FormData(e.target)));e.target.reset();$('#modal').close();$('#modal-content').innerHTML='';await refresh();toast('Gmail podłączony. Logowanie SMTP i IMAP działa.')})}}});
function renderSettings(){
  const i=state.integrations;
  $('#content').innerHTML=renderTop('Integracje','Połącz narzędzia, na których pracuje Twoja sprzedaż.')+`
    <section class="panel"><h2>Dane nadawcy</h2><form id="sender-form"><label for="sender-name">Imię i nazwisko nadawcy</label><input id="sender-name" name="name" maxlength="150" autocomplete="name" value="${esc(i.sender_name||'')}" placeholder="np. Anna Kowalska"><p class="hint">Podpis wiadomości korzysta z tego imienia i nazwiska. Gdy pole jest puste, używany jest adres podłączonej skrzynki.</p><p class="hint"><span>Adres nadawcy:</span> <span data-no-translate>${esc(i.sender||'—')}</span></p><button type="submit" class="primary">Zapisz dane nadawcy</button></form></section>
    <section class="panel">${[
      ['Poczta wychodząca · SMTP','Wysyłka sekwencji przez Twoją skrzynkę.',i.smtp],
      ['Odpowiedzi · IMAP','Odczyt odpowiedzi i zatrzymanie kolejnych wiadomości.',i.imap],
      ['ChatGPT / OpenAI','Analiza firmy i generowanie spersonalizowanych wiadomości.',i.ai]
    ].map(([n,d,on])=>`<div class="integration"><div><strong>${n}</strong><p>${d}</p></div><span class="badge ${on?'':'gray'}">${on?'Skonfigurowano':'Nie skonfigurowano'}</span></div>`).join('')}
    <p class="hint">Status oznacza obecność ustawień. Przycisk poniżej sprawdza działanie OpenAI.</p></section>
    <section class="panel"><h2>ChatGPT / OpenAI</h2>
      <p>Podłącz klucz z <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI Platform ↗</a>. API jest rozliczane oddzielnie od abonamentu ChatGPT.</p>
      <form id="openai-form">
        <label for="openai-key">Klucz API</label><input id="openai-key" name="api_key" type="password" autocomplete="new-password" ${i.ai?'':'required'} placeholder="${i.ai?'Pozostaw puste, aby zachować zapisany klucz':'sk-…'}">
        <label for="openai-model">Model</label><input id="openai-model" name="model" required value="${esc(i.ai_model)}" placeholder="gpt-6-luna">
        <p class="hint">Sprawdzenie wykonuje krótkie, płatne zapytanie API. Klucz jest zapisywany w lokalnym pliku .env i nie jest odsyłany do przeglądarki. Przy generowaniu do OpenAI trafiają dane kontaktu, oferty, sygnału i wybranego materiału; przy analizie firmy — tekst jej strony.</p>
        <div class="actions"><button class="primary" type="submit">Sprawdź i zapisz</button>${i.ai?'<button class="secondary" type="button" id="disconnect-openai">Odłącz OpenAI</button>':''}</div>
      </form>
    </section>
    <section class="panel"><h2>Konfiguracja na tym komputerze</h2>
      <p>Gmail podłączysz przyciskiem u góry. Pozostałe skrzynki skonfigurujesz w pliku <code>.env</code> na podstawie <code>.env.example</code>; po ręcznej edycji uruchom serwer ponownie.</p>
      <p><strong>SMTP:</strong> SMTP_HOST, SMTP_PORT, SMTP_FROM, SMTP_USER, SMTP_PASSWORD, SMTP_SECURITY (starttls lub ssl).</p>
      <p><strong>IMAP:</strong> IMAP_HOST, IMAP_USER, IMAP_PASSWORD.</p>
      <p><strong>Limity:</strong> DAILY_SEND_LIMIT i SEND_INTERVAL_SECONDS. Domyślnie 50 wiadomości dziennie, odstęp 60 sekund.</p>
      <p><strong>Rezygnacja:</strong> PUBLIC_BASE_URL musi wskazywać publiczny adres instancji, aby link działał u odbiorców.</p>
      <p class="hint">Wysyłka i synchronizacja działają, kiedy serwer jest uruchomiony. Bez klucza OpenAI aplikacja używa zapisanych szablonów.</p>
    </section>`;
  renderHunterSettings();
  $('#sender-form').onsubmit=event=>{event.preventDefault();run(event.submitter,async()=>{await api('integrations/sender',Object.fromEntries(new FormData(event.target)));await refresh();toast(translateUiText('Dane nadawcy zapisane.'))})};
  maskSavedApiKey($('#openai-key'),i.ai);
  $('#openai-form').onsubmit=e=>{
    e.preventDefault();
    run(e.submitter,async()=>{
      await api('integrations/openai',apiKeyFormData(e.target));
      e.target.reset();await refresh();toast('OpenAI podłączone. Test generowania zakończony powodzeniem.');
    });
  };
  if($('#disconnect-openai'))$('#disconnect-openai').onclick=e=>run(e.currentTarget,async()=>{
    await api('integrations/openai',{disconnect:true});await refresh();toast('OpenAI odłączone.');
  });
}

// Bundled into app.js so navigation and views are delivered together.
function sellingPointsSection(prefix){return `<section class="selling-points" data-selling-section="${prefix}"><div class="selling-heading"><h2>Stwórz unikalną propozycję wartości</h2><button type="button" class="secondary" data-suggest-points>✧ Zaproponuj z AI</button></div>${[['pain_points','Problemy odbiorców','Dodaj problem'],['value_props','Propozycje wartości','Dodaj wartość'],['proof_points','Proof points','Dodaj dowód']].map(([field,label,add])=>`<div class="point-editor" data-point-editor="${field}"><div class="point-heading"><h3 id="${prefix}-${field}-label">${label}</h3><button type="button" class="point-add" data-add-point aria-label="${add}" title="${add}">+</button></div>${field==='proof_points'?'<button type="button" class="secondary proof-scan" data-read-proof>✧ Przeczytaj ze strony z AI</button>':''}<div class="point-rows" role="group" aria-labelledby="${prefix}-${field}-label"></div><textarea name="${field}" hidden data-points-storage></textarea></div>`).join('')}<p class="hint">Problemy to hipotezy do sprawdzenia. Podawaj tylko rzeczywiste korzyści i potwierdzone wyniki.</p><p class="hint" data-points-status role="status"></p></section>`}
function bindSellingPoints(container){
  for(const editor of container.querySelectorAll('[data-point-editor]')){
    const list=editor.querySelector('.point-rows'),storage=editor.querySelector('[data-points-storage]'),add=editor.querySelector('[data-add-point]');
    const sync=()=>{storage.value=[...list.querySelectorAll('input')].map(input=>input.value.trim()).filter(Boolean).join('\n');add.disabled=list.children.length>=10;storage.dispatchEvent(new Event('input',{bubbles:true}))};
    const row=(value='',focus=false)=>{
      const element=document.createElement('div');element.className='point-row';
      element.innerHTML='<input type="text" maxlength="500" data-no-translate><button type="button" class="point-remove" aria-label="Usuń punkt" title="Usuń punkt">×</button>';
      const input=element.querySelector('input');input.value=value;input.setAttribute('aria-labelledby',editor.querySelector('h3').id);
      input.placeholder=editor.dataset.pointEditor==='proof_points'?'Dowód lub wynik ze źródłem…':editor.dataset.pointEditor==='pain_points'?'Opisz problem odbiorcy…':'Opisz wartość dla klienta…';
      input.oninput=sync;
      input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();if(list.children.length<10){row('',true);sync()}}};
      element.querySelector('button').onclick=()=>{element.remove();sync();if(!list.children.length)add.focus()};
      list.append(element);add.disabled=list.children.length>=10;if(focus)input.focus();
    };
    editor.refreshPoints=()=>{list.replaceChildren();const values=storage.value.split('\n').filter(line=>line.trim());(values.length?values:['']).forEach(value=>row(value));add.disabled=list.children.length>=10};
    add.onclick=()=>{if(list.children.length<10){row('',true);sync()}};
    editor.refreshPoints();
  }
  for(const section of container.querySelectorAll('[data-selling-section]')){
    const scan=section.querySelector('[data-read-proof]'),suggest=section.querySelector('[data-suggest-points]');
    scan.onclick=()=>run(scan,async()=>{
      const prospect=section.dataset.sellingSection==='prospect',website=normalizeWebsite(container.elements.website.value);
      if(!website)throw Error('Najpierw wpisz adres strony firmy powyżej.');
      if(!state.integrations.ai)throw Error('Podłącz OpenAI w Integracjach, aby odczytać proof points z AI.');
      container.elements.website.value=website;suggest.disabled=true;
      const status=section.querySelector('[data-points-status]');status.textContent='Czytam stronę i szukam dowodów…';
      try{
        const result=await api('ai/proof-points',{website});
        if(!section.isConnected)return;
        if(!result.proof_points){status.textContent='Nie znaleziono konkretnych dowodów w odczytanych stronach. Dotychczasowe punkty pozostają bez zmian.';return}
        $('#modal-content').innerHTML=`<h2>Proof points ze strony</h2><p>To twierdzenia opublikowane przez firmę, a nie niezależna weryfikacja. Sprawdź cytaty i źródła przed zastosowaniem.</p><form id="proof-proposal-form"><label for="suggested-proof">Proof points</label><textarea id="suggested-proof" name="proof_points" rows="7" required>${esc(result.proof_points)}</textarea><div class="proof-sources">${result.sources.map(source=>`<p><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.url)}</a></p>`).join('')}</div><p class="hint">Zastosowanie zastąpi obecną listę proof points.</p><button class="primary">Zastosuj proof points</button></form>`;
        $('#modal').showModal();status.textContent='Dowody gotowe do sprawdzenia.';
        $('#proof-proposal-form').onsubmit=event=>{event.preventDefault();run(event.submitter,async()=>{
          if(!section.isConnected){$('#modal').close();return}
          const lines=$('#suggested-proof').value.split('\n').map(line=>line.trim()).filter(Boolean);
          if(!lines.length||lines.length>10||lines.some(line=>line.length>500))throw Error('Maksymalnie 10 punktów po 500 znaków w każdej liście.');
          const editor=section.querySelector('[data-point-editor="proof_points"]'),storage=editor.querySelector('[data-points-storage]');
          storage.value=lines.join('\n');editor.refreshPoints();storage.dispatchEvent(new Event('input',{bubbles:true}));
          $('#modal').close();status.textContent='Proof points zastosowane. Możesz je edytować.';
        })};
      }catch(error){status.textContent='Nie udało się odczytać proof points. Twoje punkty pozostają bez zmian.';throw error}
      finally{suggest.disabled=false}
    });
  }
  for(const section of container.querySelectorAll('[data-selling-section]'))section.querySelector('[data-suggest-points]').onclick=e=>run(e.currentTarget,async()=>{
    const prospect=section.dataset.sellingSection==='prospect',offer=container.elements.offer.value,audience=container.elements.audience.value;
    if(!offer.trim())throw Error('Najpierw wpisz ofertę.');
    if(!state.integrations.ai)throw Error('Podłącz OpenAI w Integracjach, aby otrzymać propozycje AI.');
    section.querySelector('[data-read-proof]').disabled=true;
    const status=section.querySelector('[data-points-status]');status.textContent='Przygotowuję propozycje problemów i wartości…';
    try{
      const result=await api('ai/selling-points',{offer,audience,language:prospect?$('#prospect-language').value:$('#build-language').value});
      if(!section.isConnected)return;
      $('#modal-content').innerHTML=`<h2>Propozycje AI do sprawdzenia</h2><p>Sprawdź problemy i korzyści. Zastosowanie zastąpi aktualne listy.</p><form id="points-proposal-form"><label for="suggested-pains">Problemy odbiorców</label><textarea id="suggested-pains" name="pain_points" rows="5" required>${esc(result.pain_points)}</textarea><label for="suggested-values">Propozycje wartości</label><textarea id="suggested-values" name="value_props" rows="5" required>${esc(result.value_props)}</textarea><button class="primary">Zastosuj punkty</button></form>`;
      $('#modal').showModal();status.textContent='Propozycje gotowe do sprawdzenia.';
      $('#points-proposal-form').onsubmit=event=>{event.preventDefault();run(event.submitter,async()=>{
        if(!section.isConnected){$('#modal').close();return}
        const data=Object.fromEntries(new FormData(event.target));
        for(const field of ['pain_points','value_props']){
          const lines=data[field].split('\n').map(line=>line.trim()).filter(Boolean);
          if(lines.length>10||lines.some(line=>line.length>500))throw Error('Maksymalnie 10 punktów po 500 znaków w każdej liście.');
          data[field]=lines.join('\n');
        }
        for(const editor of section.querySelectorAll('[data-point-editor]')){if(!(editor.dataset.pointEditor in data))continue;const storage=editor.querySelector('[data-points-storage]');storage.value=data[editor.dataset.pointEditor];editor.refreshPoints();storage.dispatchEvent(new Event('input',{bubbles:true}))}
        $('#modal').close();status.textContent='Punkty zastosowane. Możesz je edytować.';
      })};
    }catch(error){status.textContent='Nie udało się przygotować propozycji. Twoje punkty pozostają bez zmian.';throw error}
    finally{section.querySelector('[data-read-proof]').disabled=false}
  });
}
function restoreSellingPoints(container){container.querySelectorAll('[data-point-editor]').forEach(editor=>editor.refreshPoints?.())}
function syncWebsiteActions(form){
 if(!form?.elements.website)return;
 const hasWebsite=!!form.elements.website.value.trim();
 form.querySelectorAll('#scan-offer-website,[data-read-proof],[data-builder="discover"]').forEach(button=>button.hidden=!hasWebsite);
 if(form.id==='campaign-form')document.querySelectorAll('[data-builder="website-shortcut"],[data-builder="materials-shortcut"]').forEach(button=>button.hidden=!hasWebsite);
 const sample=form.querySelector('[data-generate-example]');if(sample)sample.hidden=hasWebsite;
}
function bindWebsiteActions(form){
 if(!form?.elements.website||form.dataset.websiteActionsBound)return;
 form.dataset.websiteActionsBound='true';
 form.elements.website.insertAdjacentHTML('afterend','<div class="example-data-actions"><button type="button" class="secondary" data-generate-example>Wygeneruj przykładowe dane</button><p class="hint" data-example-status role="status"></p></div>');
 form.addEventListener('input',()=>syncWebsiteActions(form));form.addEventListener('change',()=>syncWebsiteActions(form));
 form.querySelector('[data-generate-example]').onclick=()=>{
  const pl=(form.elements.language?.value||state.preferences.message_language)==='pl';
  const data=pl?{name:form.id==='campaign-form'?'Kampania demonstracyjna':'Projekt demonstracyjny',offer:'Przykładowa oferta: pomagamy małym i średnim firmom automatyzować obsługę zapytań, przygotowanie ofert i raportowanie. Łączymy używane narzędzia i ograniczamy ręczne przepisywanie danych.',audience:'Małe i średnie firmy usługowe w Polsce, które ręcznie obsługują zapytania klientów i raportują w arkuszach. Odbiorcy: właściciele, dyrektorzy operacyjni i kierownicy sprzedaży.',pain_points:'Ręczne przepisywanie danych między narzędziami\nDługi czas przygotowania ofert\nBrak aktualnego obrazu wyników sprzedaży',value_props:'Mniej powtarzalnych czynności\nSprawniejsza obsługa zapytań\nRaporty dostępne w jednym miejscu',proof_points:'Dane demonstracyjne: referencje i wyniki wymagają uzupełnienia prawdziwymi dowodami.',cta:'Umówmy krótką rozmowę'}:{name:form.id==='campaign-form'?'Demo campaign':'Demo project',offer:'Example offer: we help small and medium service businesses automate enquiries, proposals and reporting, connecting existing tools and reducing manual data entry.',audience:'Small and medium service businesses that handle customer enquiries manually and report in spreadsheets. Target roles: owners, operations directors and sales managers.',pain_points:'Repeated manual data entry\nSlow proposal preparation\nLimited visibility into sales results',value_props:'Fewer repetitive tasks\nFaster enquiry handling\nReporting in one place',proof_points:'Demonstration data: replace with genuine references and verified results.',cta:'Let us arrange a short call'};
  for(const [field,value] of Object.entries(data)){const input=form.elements[field];if(input&&!input.value.trim())input.value=value}
  restoreSellingPoints(form);syncWebsiteActions(form);
  form.dispatchEvent(new Event('input',{bubbles:true}));
  form.querySelector('[data-example-status]').textContent=translateUiText('Uzupełniono puste pola fikcyjnymi danymi. Własny adres strony możesz dodać później.');
 };
 syncWebsiteActions(form);
}
function refineControls(field){return `<div class="refine-actions" data-refine-controls="${field}"><button type="button" class="secondary" data-refine="${field}">✧ Fine tune with AI</button>${field==='offer'?'<button type="button" class="secondary" id="scan-offer-website">↗ Skanuj stronę i opisz ofertę</button><p class="hint" id="offer-website-source" hidden></p>':''}<button type="button" class="link" data-refine-undo="${field}" hidden>Cofnij zmianę</button><p class="hint" data-refine-status="${field}" role="status"></p><div data-refine-proposal="${field}" hidden><textarea readonly rows="3" data-no-translate aria-label="Propozycja AI"></textarea><button type="button" class="secondary" data-refine-apply="${field}">Zastosuj propozycję</button></div></div>`}
function audienceSuggestionControls(){return `<div class="audience-suggestion" data-audience-suggestion><div class="actions"><button type="button" class="secondary" data-suggest-audience>✧ Zaproponuj filtr z AI</button><button type="button" class="link" data-audience-undo hidden>Cofnij filtr</button></div><p class="hint" role="status" data-audience-status></p><div data-audience-proposal hidden><label>Proponowany opis firm<textarea rows="4" maxlength="3000" data-audience-text data-no-translate></textarea></label><div class="actions"><button type="button" class="secondary" data-audience-apply>Zastosuj filtr</button><button type="button" class="link" data-audience-dismiss>Odrzuć propozycję</button></div></div></div>`}
function bindAudienceSuggestion(){
 const root=$('[data-audience-suggestion]');if(!root||root.dataset.bound)return;root.dataset.bound='true';
 const form=root.closest('form'),input=form.elements.audience,button=root.querySelector('[data-suggest-audience]'),status=root.querySelector('[data-audience-status]'),proposal=root.querySelector('[data-audience-proposal]'),text=root.querySelector('[data-audience-text]'),apply=root.querySelector('[data-audience-apply]'),undo=root.querySelector('[data-audience-undo]');
 const projectId=state.seller_project.id;let previous=null;
 const current=()=>root.isConnected&&state.seller_project.id===projectId;
 button.onclick=()=>run(button,async()=>{
   if(!form.elements.offer.value.trim())throw Error('Najpierw uzupełnij ofertę.');
   if(!state.integrations.ai)throw Error('Podłącz OpenAI w Integracjach, aby zaproponować filtr.');
   const original=input.value,data=Object.fromEntries(['offer','pain_points','value_props','audience'].map(field=>[field,form.elements[field]?.value||'']));
   status.textContent='AI proponuje filtr na podstawie oferty, problemów i wartości…';apply.disabled=true;
   try{
     const result=await api('ai/suggest-audience',{...data,language:state.preferences.ui_language,search_languages:readSearchLanguages(form)});
     if(!current())return;
     text.value=result.audience;proposal.hidden=false;
     status.textContent=input.value===original?'Propozycja gotowa. Sprawdź i zastosuj filtr.':'Opis zmienił się podczas generowania. Sprawdź propozycję przed zastosowaniem.';
   }catch(error){if(current())status.textContent='Nie udało się przygotować filtra. Twój opis pozostaje bez zmian.';throw error}
   finally{apply.disabled=false}
 });
 apply.onclick=()=>{
   if(!current())return;const value=text.value.trim();
   if(value.length<10||value.length>3000){toast('Opis firm powinien mieć od 10 do 3000 znaków.');return}
   previous=input.value;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));proposal.hidden=true;undo.hidden=false;status.textContent='Filtr zastosowany. Możesz go edytować przed wyszukiwaniem.';
 };
 undo.onclick=()=>{if(!current()||previous===null)return;input.value=previous;previous=null;input.dispatchEvent(new Event('input',{bubbles:true}));undo.hidden=true;status.textContent='Przywrócono poprzedni opis firm.'};
 root.querySelector('[data-audience-dismiss]').onclick=()=>{proposal.hidden=true;status.textContent='Propozycja odrzucona. Twój opis pozostaje bez zmian.'};
}
function bindRefineControls(){
  bindAudienceSuggestion();
  for(const field of ['offer','audience']){
    const input=$('#prospect-'+field),button=$('[data-refine="'+field+'"]'),undo=$('[data-refine-undo="'+field+'"]'),status=$('[data-refine-status="'+field+'"]'),proposal=$('[data-refine-proposal="'+field+'"]');
    let previous=null,currentSource=null,pendingSource=null,pendingScan=false;
    const scan=field==='offer'?$('#scan-offer-website'):null;
    const showSource=()=>{
      if(!scan)return;
      const source=$('#offer-website-source');source.replaceChildren();source.hidden=!currentSource;
      if(currentSource){const label=document.createElement('span');label.textContent='Źródło: ';const link=document.createElement('a');link.href=currentSource;link.textContent=currentSource;link.target='_blank';link.rel='noopener noreferrer';source.append(label,link)}
    };
    const apply=(text,source=currentSource,scanned=false)=>{previous={text:input.value,source:currentSource};input.value=text;currentSource=source;showSource();proposal.hidden=true;undo.hidden=false;status.textContent=scanned?'Oferta uzupełniona ze strony. Sprawdź opis przed wyszukiwaniem.':'Tekst poprawiony przez AI. Sprawdź go przed wyszukiwaniem.';input.dispatchEvent(new Event('input',{bubbles:true}))};
    undo.onclick=()=>{if(previous!==null){input.value=previous.text;currentSource=previous.source;showSource();previous=null;undo.hidden=true;status.textContent='Przywrócono poprzednią treść.';input.dispatchEvent(new Event('input',{bubbles:true}))}};
    proposal.querySelector('button').onclick=()=>apply(proposal.querySelector('textarea').value,pendingSource,pendingScan);
    button.onclick=()=>run(button,async()=>{
      const original=input.value;
      if(!original.trim())throw Error('Najpierw wpisz tekst, który AI ma poprawić.');
      if(!state.integrations.ai)throw Error('Podłącz OpenAI w Integracjach, aby poprawić tekst przez AI.');
      if(scan)scan.disabled=true;
      status.textContent='AI poprawia tekst…';
      try{
        const result=await api('ai/refine',{field,text:original,language:field==='offer'?$('#prospect-language').value:state.preferences.ui_language});
        if(!input.isConnected)return;
        if(input.value===original)apply(result.text);
        else{pendingSource=currentSource;pendingScan=false;proposal.querySelector('textarea').value=result.text;proposal.hidden=false;status.textContent='W międzyczasie zmieniono tekst. Możesz zastosować propozycję AI poniżej.'}
      }catch(error){status.textContent='Nie udało się poprawić tekstu. Twoja treść pozostaje bez zmian.';throw error}
      finally{if(scan)scan.disabled=false}
    });
    if(scan)scan.onclick=()=>run(scan,async()=>{
      const url=normalizeWebsite($('#prospect-website').value),original=input.value;
      if(!url)throw Error('Najpierw wpisz adres strony firmy powyżej.');
      $('#prospect-website').value=url;
      button.disabled=true;status.textContent='Skanuję stronę i odczytuję ofertę…';
      try{
        const result=await api('research',{url,language:$('#prospect-language').value});
        if(!input.isConnected)return;
        const source=new URL(result.source);
        if(source.protocol!=='https:'||source.username||source.password||typeof result.offer!=='string'||!result.offer.trim())throw Error('Strona nie zwróciła poprawnego opisu oferty.');
        if(input.value===original){apply(result.offer,source.href,true);if(!result.ai)status.textContent='Pobrano opis ze strony bez AI. Sprawdź i uzupełnij ofertę.'}
        else{pendingSource=source.href;pendingScan=true;proposal.querySelector('textarea').value=result.offer;proposal.hidden=false;status.textContent='W międzyczasie zmieniono tekst. Propozycja ze strony czeka poniżej.'}
      }catch(error){status.textContent='Nie udało się odczytać oferty ze strony. Twoja treść pozostaje bez zmian.';throw error}
      finally{button.disabled=false}
    });
  }
}
function runProspectAction(button,record){run(button,async()=>{
  const action=button.dataset.prospectAction;
  if(action==='open'){selectedCampaign=record.campaign_id;view='campaigns';render();return}
  if(action==='verify'){await api('prospecting/verify',{id:record.id});document.activeElement?.blur();await refresh();toast('Sprawdzam adresy. Wyniki będą aktualizowane.');return}
  const projectId=state.seller_project.id,key=leadRunKey(record),rows=state.prospecting.candidates.filter(p=>p.run_id===record.id&&prospectSelected.has(p.id));
  if(!rows.length)throw Error('Wybierz co najmniej jeden kontakt.');
  if(leadImportBusy.has(key))return;leadImportBusy.add(key);syncLeadImportControls();
  try{
   const result=await api('prospecting/contacts/add',{id:record.id,project_id:projectId,candidate_ids:rows.map(row=>row.id),tags_by_contact:Object.fromEntries(rows.map(row=>[row.email.toLowerCase(),leadTags(record,row)]))});
   if(state.seller_project.id!==projectId)return;
   prospectSelected.clear();leadImportMessages.set(key,translateUiText('Dodano:')+' '+result.added+' · '+translateUiText('Już w kontaktach:')+' '+result.existing);
   document.activeElement?.blur();await refresh();
  }finally{leadImportBusy.delete(key);if(view==='prospecting'){document.activeElement?.blur();renderProspecting();syncLeadImportControls();syncLanguages()}}

})}
setInterval(()=>{if(view==='prospecting'&&state?.prospecting?.runs.some(r=>['searching','verifying','drafting'].includes(r.status)))refresh().catch(()=>{})},3000);

document.addEventListener('DOMContentLoaded',()=>refresh().catch(e=>toast(e.message)));setInterval(()=>{if(!$('#modal').open&&!document.activeElement?.closest('#dashboard-search-form')&&!['settings','administration','project'].includes(view))refresh().catch(()=>{})},15000);

