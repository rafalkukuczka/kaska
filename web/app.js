let state, view=['dashboard','discover','prospecting','contacts','campaigns','signals','inbox','library','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'dashboard', selectedCampaign=null;
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
async function api(path,data,signal){if(['prospecting/search','signals/monitoring/propose','signals/monitoring/activate','signals/monitoring/topic','signals/monitoring/companies'].includes(path))data={...data,profile_id:data.profile_id??sellerProfile().id};const res=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(data),signal});const result=await res.json();if(!res.ok)throw Error(result.error);return result}
async function refresh(){const res=await fetch('/api/state');if(!res.ok)throw Error('Nie można połączyć się z aplikacją');state=await res.json();syncSellerProfile();finishProspectDraft();render();syncLanguages()}
function modal(content){$('#modal-content').innerHTML=content;if($('#campaign-form')){$('#campaign-form').insertAdjacentHTML('afterbegin',`<label>Strona firmy (dowolna firma dla tej kampanii)</label><div class="actions"><input id="company-url" placeholder="https://twoja-firma.pl" aria-label="Strona firmy"><button type="button" class="secondary" data-action="research">Pobierz opis firmy</button></div><p id="research-status" class="hint">Opiszesz ofertę ręcznie albo pobierzesz kontekst z publicznej strony firmy. Sprawdź wynik przed zapisem.</p>`)}$('#modal').showModal()}
function campaignRows(){return state.campaigns.map(c=>{const messages=state.messages.filter(m=>m.campaign_id===c.id);const sent=messages.filter(m=>m.status==='sent').length;return `<tr><td><strong>${esc(c.name)}</strong><small>${esc(c.audience||campaignAudience(c))}</small></td><td>${badge(c.status)}</td><td>${sent} / ${messages.length}</td><td><button class="link" data-action="campaign" data-id="${c.id}">Otwórz →</button> <button class="link danger" data-action="delete-campaign" data-id="${c.id}">Usuń kampanię</button></td></tr>`}).join('')}
function campaignTable(){return state.campaigns.length?`<div class="table-wrap"><table><thead><tr><th>Kampania</th><th>Status</th><th>Wysłano</th><th></th></tr></thead><tbody>${campaignRows()}</tbody></table></div>`:empty('Twoja pierwsza kampania zaczyna się tutaj','Dodaj kontakty, opisz ofertę i przygotuj wiadomości.')}
function renderTop(title,sub,action=''){if(title==='Integracje')action='<button class="primary" data-action="connect-gmail">Podłącz Gmail</button>';return `<div class="topline"><div><h1>${title}</h1><p class="muted">${sub}</p></div>${action}</div>`}
function render(){if(state)renderProfilePicker();if(state&&typeof renderDiscoveryBanner==='function')renderDiscoveryBanner();if(!state||view==='builder')return;history.replaceState(null,'','#'+view);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));$('#breadcrumb').textContent='Przestrzeń robocza / '+({dashboard:'Przegląd',contacts:'Kontakty',campaigns:'Kampanie',inbox:'Odpowiedzi',settings:'Integracje',signals:'Sygnały sprzedażowe'}[view]);const el=$('#content');if(view==='prospecting'){$('#breadcrumb').textContent='Przestrze\u0144 robocza / Znajd\u017a klient\u00f3w';renderProspecting();return}if(view==='discover'){$('#breadcrumb').textContent='Przestrze\u0144 robocza / Discover';renderDiscover();return}if(view==='signals'){renderSignals();return}if(view==='library'){renderLibrary();return}
if(view==='dashboard'){const sent=state.messages.filter(m=>m.status==='sent').length;el.innerHTML=renderTop('Mniej rutyny. Więcej rozmów.','Wszystko, czego potrzebujesz, żeby rozwijać sprzedaż.',`<button class="primary" data-action="new-campaign">+ Nowa kampania</button>`)+`<section class="hero"><div><div class="section-label">TWÓJ ASYSTENT SPRZEDAŻY</div><h2>Dobry kontakt zaczyna się od dobrej wiadomości.</h2><p>Zbuduj listę odbiorców, przygotuj spersonalizowaną sekwencję i prowadź rozmowy w jednym miejscu.</p><button class="secondary" data-view="contacts">Dodaj pierwsze kontakty ↗</button></div><div class="hero-symbol">✳</div></section><div class="stats">${[['Kontakty',state.totals.contacts,'Twoja baza potencjalnych klientów'],['Aktywne kampanie',state.campaigns.filter(c=>c.status==='active').length,'Sekwencje pracujące dla Ciebie'],['Wysłane wiadomości',sent,'Potwierdzone przez serwer SMTP'],['Odpowiedzi',state.replies.length,'Rozmowy wykryte przez IMAP']].map(([l,n,t])=>`<div class="stat"><p>${l}</p><strong>${n}</strong><small>${t}</small></div>`).join('')}</div><div class="grid"><section class="panel"><div class="panel-head"><h2>Twoje kampanie</h2><button class="link" data-view="campaigns">Zobacz wszystkie →</button></div>${campaignTable()}</section><section class="panel"><h2>Ostatnia aktywność</h2>${state.events.slice(0,7).map(e=>`<div class="activity">${esc(e.detail)}<small>${date(e.created)}</small></div>`).join('')||empty('Czysta karta','Tutaj pojawią się zdarzenia z Twoich kampanii.')}<button class="link" data-view="settings">Sprawdź integracje →</button></section></div>`}
if(view==='contacts'){el.innerHTML=renderTop('Kontakty','Twoja baza. Twoje relacje.',`<div class="actions"><button class="secondary" data-action="import">Import CSV</button><button class="primary" data-action="new-contact">+ Dodaj kontakt</button></div>`)+`<section class="panel"><div class="filters"><input id="search" class="search" placeholder="Szukaj osoby, firmy lub adresu…" aria-label="Szukaj kontaktu"></div><div class="table-wrap"><table><thead><tr><th>Osoba</th><th>Firma / stanowisko</th><th>Status</th><th>Działanie</th></tr></thead><tbody id="contacts-body"></tbody></table></div></section>`;renderContacts('');$('#search').oninput=e=>renderContacts(e.target.value)}
if(view==='campaigns'){if(selectedCampaign){renderCampaign();return}el.innerHTML=renderTop('Kampanie','Od pierwszego kontaktu do następnej rozmowy.',`<button class="primary" data-action="new-campaign">+ Nowa kampania</button>`)+`<section class="panel">${campaignTable()}</section>`}
if(view==='inbox'){el.innerHTML=renderTop('Odpowiedzi','Każda wykryta odpowiedź zatrzymuje sekwencję dla danej osoby.',`<button class="primary" data-action="sync">↻ Synchronizuj pocztę</button>`)+(!state.integrations.imap?'<div class="notice">Odczyt odpowiedzi wymaga podłączenia IMAP w integracjach.</div>':'')+`<section class="panel">${state.replies.map(r=>{const contact=state.contacts.find(c=>c.id===r.contact_id);return `<article><div class="panel-head"><h3>${esc(contact?.name||'Kontakt')} · ${esc(r.subject)}</h3><small class="muted">${date(r.received)}</small></div><div class="message">${esc(r.body)}</div><a href="mailto:${esc(contact?.email)}" class="link">Odpowiedz w swojej poczcie ↗</a></article>`}).join('')||empty('Jeszcze bez odpowiedzi','Po podłączeniu IMAP odpowiedzi z ostatnich 200 wiadomości w skrzynce będą sprawdzane co minutę.')}</section>`}
if(view==='settings'){renderSettings()}}
function renderContacts(q){q=q.toLowerCase();$('#contacts-body').innerHTML=state.contacts.filter(c=>[c.name,c.email,c.company,c.role].join(' ').toLowerCase().includes(q)).map(c=>`<tr><td><strong>${esc(c.name)}</strong><small>${esc(c.email)}</small></td><td>${esc(c.company)||'—'}<small>${esc(c.role)}</small></td><td>${badge(c.status)}</td><td><button class="link" data-action="contact-status" data-id="${c.id}" data-status="paused">Wstrzymaj</button><button class="link" data-action="contact-status" data-id="${c.id}" data-status="unsubscribed">Rezygnacja</button></td></tr>`).join('')||'<tr><td colspan="4">Brak kontaktów. Dodaj osobę lub zaimportuj plik CSV.</td></tr>'}
function renderCampaign(){const c=state.campaigns.find(c=>c.id===selectedCampaign);if(!c){selectedCampaign=null;render();return}const msgs=state.messages.filter(m=>m.campaign_id===c.id);$('#content').innerHTML=`<button class="link" data-action="back">← Wszystkie kampanie</button>`+renderTop(esc(c.name),esc(c.audience||campaignAudience(c)),`<div class="actions">${c.status==='draft'?`<button class="secondary" data-action="prepare" data-id="${c.id}">Przygotuj wiadomości</button>`:''}<button class="primary" data-action="campaign-status" data-id="${c.id}" data-status="${c.status==='active'?'paused':'active'}">${c.status==='active'?'Wstrzymaj kampanię':'Uruchom wysyłkę'}</button><button class="secondary danger" data-action="delete-campaign" data-id="${c.id}">Usuń kampanię</button></div>`)+`<div class="notice">${esc(campaignRecipientNotice(c))} Sprawdź odbiorców i treść przed uruchomieniem. ${state.integrations.ai?'Generowanie korzysta z OpenAI.':'Personalizacja korzysta z szablonów; AI nie jest podłączone.'}</div><section class="panel"><div class="panel-head"><h2>Twoja oferta</h2>${badge(c.status)}</div><p>${esc(c.offer)}</p><p class="hint">${state.steps.filter(s=>s.campaign_id===c.id).map(s=>`Krok ${s.position+1}: dzień ${s.delay_days}`).join(' → ')}</p></section><section class="panel"><h2>Wiadomości · ${msgs.length}</h2>${msgs.length?`<div class="table-wrap"><table><thead><tr><th>Odbiorca</th><th>Temat</th><th>Krok</th><th>Status</th><th></th></tr></thead><tbody>${msgs.map(m=>`<tr><td>${esc(state.contacts.find(t=>t.id===m.contact_id)?.email||'')}</td><td>${esc(m.subject)}${m.error?`<small class="error">${esc(m.error)}</small>`:''}</td><td>${m.position+1}</td><td>${badge(m.status)}</td><td><button class="link" data-action="message" data-id="${m.id}">Podgląd / edycja</button></td></tr>`).join('')}</tbody></table></div>`:empty('Najpierw przygotuj wiadomości','Powstaną osobne szkice dla każdego odbiorcy i kroku.')}</section>`;$('#content h1').setAttribute('data-no-translate','')}
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
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.classList.contains('close'))return $('#modal').close();if(b.dataset.view){view=b.dataset.view;selectedCampaign=null;render();return}const a=b.dataset.action,id=Number(b.dataset.id);if(!a)return;run(b,async()=>{if(a==='new-contact'){modal(`<h2>Dodaj kontakt</h2><form id="contact-form"><label>Imię i nazwisko</label><input name="name" required><label>Email</label><input name="email" type="email" required><div class="row"><div><label>Firma</label><input name="company"></div><div><label>Stanowisko</label><input name="role"></div></div><label>Kontekst / notatki dla AI</label><textarea name="notes"></textarea><button class="primary">Zapisz kontakt</button></form>`);$('#contact-form').onsubmit=async e=>{e.preventDefault();await run(e.submitter,async()=>{await api('contacts',Object.fromEntries(new FormData(e.target)));$('#modal').close();await refresh();toast('Kontakt zapisany')})}}if(a==='import'){modal(`<h2>Import kontaktów</h2><p>CSV z nagłówkami: <code>name,email,company,role,notes</code>. Wymagana jest kolumna email; duplikaty są pomijane. Maksymalnie 2 MB.</p><label>Plik CSV</label><input id="csv-file" type="file" accept=".csv,text/csv"><p class="hint">Obsługiwany separator: przecinek lub średnik. W razie błędnego adresu cały import jest wycofywany.</p><button class="primary" data-action="upload-csv">Importuj kontakty</button>`)}if(a==='upload-csv'){const file=$('#csv-file').files[0];if(!file)throw Error('Wybierz plik CSV');await api('import',{csv:await file.text()});$('#modal').close();await refresh();toast('Import zakończony')}if(a==='delete-campaign')confirmCampaignDelete(id);if(a==='new-campaign')newCampaign();if(a==='add-step')addStep();if(a==='campaign'){selectedCampaign=id;view='campaigns';render()}if(a==='back'){selectedCampaign=null;render()}if(a==='prepare'){toast('Przygotowuję wiadomości. Przy użyciu AI może to potrwać kilka minut.');await api('campaign/prepare',{id});await refresh();toast('Wiadomości gotowe do sprawdzenia')}if(a==='campaign-status'){await api('campaign/status',{id,status:b.dataset.status});await refresh();toast(b.dataset.status==='active'?'Kampania uruchomiona':'Kampania wstrzymana')}if(a==='contact-status'){await api('contact/status',{id,status:b.dataset.status});await refresh();toast('Zatrzymano dalsze wiadomości do kontaktu')}if(a==='sync'){await api('sync',{});await refresh();toast('Poczta zsynchronizowana')}if(a==='message'){const m=state.messages.find(x=>x.id===id);const editable=m.status==='queued'&&state.campaigns.find(c=>c.id===m.campaign_id)?.status!=='active';modal(`<h2>Wiadomość · krok ${m.position+1}</h2><form id="message-form"><label>Temat</label><input name="subject" value="${esc(m.subject)}" ${editable?'':'readonly'}><label>Treść</label><textarea name="body" rows="12" ${editable?'':'readonly'}>${esc(m.body)}</textarea>${editable?'<button class="primary">Zapisz zmiany</button>':'<p class="hint">Aby edytować oczekującą wiadomość, wstrzymaj kampanię.</p>'}</form>`);$('#message-form').onsubmit=async e=>{e.preventDefault();await run(e.submitter,async()=>{await api('message',{id,...Object.fromEntries(new FormData(e.target))});$('#modal').close();await refresh();toast('Zapisano wiadomość')})}}})});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const a=b.dataset.action;if(a==='research')run(b,async()=>{const url=$('#company-url').value;if(!url)throw Error('Podaj adres strony firmy');$('#research-status').textContent='Pobieram kontekst firmy…';const result=await api('research',{url});$('#campaign-form [name=offer]').value=result.offer;$('#campaign-form [name=audience]').value=result.audience;$('#research-status').textContent=`Źródło: ${result.source}. ${result.ai?'Opis i grupa klientów zaproponowane przez AI — sprawdź je.':'Pobrano opis ze strony. Uzupełnij ofertę i grupę klientów; AI nie jest podłączone.'}`});if(a==='connect-gmail'){modal(`<h2>Podłącz Gmail / Google Workspace</h2><p>Sprawdzimy logowanie do wysyłki i odczytu odpowiedzi. Nie wyślemy wiadomości testowej.</p><form id="gmail-form"><label>Adres email</label><input name="email" type="email" autocomplete="username" required placeholder="ty@twoja-firma.pl"><label>Hasło aplikacji Google</label><input name="password" type="password" autocomplete="new-password" required placeholder="16 liter hasła aplikacji"><p class="hint">Użyj hasła aplikacji, nie zwykłego hasła do konta Google. <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Utwórz hasło aplikacji ↗</a>. Dostępność zależy od ustawień konta i administratora Workspace. <a href="https://support.google.com/a/answer/176600" target="_blank" rel="noopener">Instrukcja Google</a>.</p><p class="hint">Dane zostaną zapisane w lokalnym pliku .env, pomijanym przez Git. Dostęp do pliku powinien mieć tylko właściciel tego komputera.</p><button class="primary">Sprawdź i podłącz</button></form>`);$('#gmail-form').onsubmit=async e=>{e.preventDefault();await run(e.submitter,async()=>{await api('integrations/gmail',Object.fromEntries(new FormData(e.target)));e.target.reset();$('#modal').close();$('#modal-content').innerHTML='';await refresh();toast('Gmail podłączony. Logowanie SMTP i IMAP działa.')})}}});
function renderSettings(){
  const i=state.integrations;
  $('#content').innerHTML=renderTop('Integracje','Połącz narzędzia, na których pracuje Twoja sprzedaż.')+`
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
  renderLanguageSettings();
  renderHunterSettings();
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
function prospectEligible(p){return p.verification_status==='valid'&&p.qualification!=='rejected'&&p.checked_at>Date.now()/1000-7*86400&&p.verified_at>Date.now()/1000-31*86400&&!state.contacts.some(c=>c.email.toLowerCase()===p.email.toLowerCase())}
function renderHunterSettings(){
  $('#openai-form').closest('section').insertAdjacentHTML('afterend',`<section class="panel"><div class="panel-head"><h2>Hunter · firmy, osoby i weryfikacja</h2><span class="badge ${state.prospecting?.hunter?'':'gray'}">${state.prospecting?.hunter?'Skonfigurowano':'Nie podłączono'}</span></div><p>Kaśka wyszukuje firmy według Twojego opisu, odczytuje publicznie znalezione adresy osób i sprawdza je przed przygotowaniem kampanii.</p><form id="hunter-form"><label for="hunter-key">Klucz Hunter API</label><input id="hunter-key" type="password" name="api_key" autocomplete="new-password" ${state.prospecting?.hunter?'':'required'} placeholder="Klucz z konta Hunter"><p class="hint">Klucz znajdziesz na <a href="https://hunter.io/api" target="_blank" rel="noopener">koncie Hunter ↗</a>. Zapis sprawdza dostęp do konta. Wyszukiwanie kontaktów i weryfikacja mogą zużywać kredyty Twojego planu; dostęp do Discover zależy od konta. Klucz trafia wyłącznie do lokalnego .env.</p><div class="actions"><button class="primary">Sprawdź i podłącz Hunter</button>${state.prospecting?.hunter?'<button type="button" class="secondary" id="hunter-disconnect">Odłącz Hunter</button>':''}</div></form></section>`);
  maskSavedApiKey($('#hunter-key'),state.prospecting?.hunter);
  $('#hunter-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{await api('integrations/hunter',apiKeyFormData(e.target));e.target.reset();await refresh();toast('Hunter podłączony. Możesz szukać klientów.');})};
  if($('#hunter-disconnect'))$('#hunter-disconnect').onclick=e=>run(e.currentTarget,async()=>{await api('integrations/hunter',{disconnect:true});await refresh();toast('Hunter odłączony.');});
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
function renderProspecting(){
  const data=state.prospecting||{runs:[],candidates:[],hunter:false};
  if(!$('#prospect-form')){
    $('#content').innerHTML=renderTop('Znajdź klientów','Od opisu odbiorców do sprawdzonych kontaktów i szkiców wiadomości.')+`
      <div class="notice" id="prospect-integrations"></div>
      <section class="panel"><span class="section-label">01 / TWOJA FIRMA I ODBIORCY</span><h2>Kogo ma znaleźć Kaśka?</h2>
        <form id="prospect-form"><label for="prospect-language">J\u0119zyk wiadomo\u015bci</label><select id="prospect-language" name="language">${messageLanguageOptions(state.preferences.message_language)}</select><p class="hint">Bez AI wpisz ofert\u0119 i w\u0142asne szablony w wybranym j\u0119zyku. Tre\u015bci wpisane przez Ciebie nie s\u0105 automatycznie t\u0142umaczone.</p><label for="prospect-website">Strona firmy, w imieniu której piszesz</label><input id="prospect-website" name="website" type="text" inputmode="url" autocapitalize="none" spellcheck="false" required placeholder="firma.pl">
          <label for="prospect-offer">Oferta</label><textarea id="prospect-offer" name="offer" rows="3" maxlength="10000" placeholder="Co sprzedajesz i jak pomaga to klientom?"></textarea>${refineControls('offer')}
          ${sellingPointsSection('prospect')}
          <label for="prospect-audience">Opis firm, których szukasz</label><textarea id="prospect-audience" name="audience" required minlength="10" maxlength="3000" rows="3" placeholder="Np. firmy logistyczne w Polsce, 11–200 pracowników, obsługujące sklepy internetowe."></textarea>${refineControls('audience')}
          <div class="row"><div><label for="prospect-titles">Stanowiska (opcjonalnie, oddziel przecinkami)</label><input id="prospect-titles" name="titles" maxlength="500" placeholder="CEO, Head of Operations"></div><div><label for="prospect-department">Dział</label><select id="prospect-department" name="department"><option value="">Wszyscy decydenci</option>${[['executive','Zarząd'],['it','IT'],['finance','Finanse'],['sales','Sprzedaż'],['marketing','Marketing'],['hr','HR'],['operations','Operacje'],['procurement','Zakupy'],['product','Produkt']].map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></div></div>
          <div class="row"><div><label for="prospect-company-limit">Maksymalnie firm</label><input id="prospect-company-limit" name="company_limit" type="number" min="1" max="10" value="3" required></div><div><label for="prospect-people-limit">Osób na firmę</label><input id="prospect-people-limit" name="per_company" type="number" min="1" max="3" value="2" required></div></div>
          <label for="prospect-exclusions">Wyklucz domeny klientów i konkurentów</label><input id="prospect-exclusions" name="exclusions" placeholder="klient.pl, konkurent.com"><p class="hint">Pomijamy własną domenę i adresy już obecne w Kontaktach. Wyszukiwanie może zużyć kredyty Hunter oraz OpenAI, jeśli jest podłączone. Wyniki wymagają przeglądu; nie wysyłamy wiadomości.</p>
          <button class="primary" id="prospect-search">Znajdź firmy i osoby</button><p id="prospect-feedback" class="hint" role="status"></p>
        </form></section>
      <section class="panel"><div class="panel-head"><h2>02 / Wyniki i weryfikacja</h2><button class="secondary" id="prospect-refresh">Odśwież wyniki</button></div><label for="prospect-run">Wyszukiwanie</label><select id="prospect-run"></select><div id="prospect-results"></div></section>`;
    $('#prospect-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{const data=Object.fromEntries(new FormData(e.target));data.website=normalizeWebsite(data.website);$('#prospect-website').value=data.website;updateSellerProfile(e.target);await flushSellerProfile();const result=await api('prospecting/search',data);prospectRunId=result.id;prospectSelected.clear();$('#prospect-feedback').textContent='Wyszukiwanie uruchomione. Postęp pojawi się poniżej.';await refresh()})};
    bindRefineControls();
    bindSellingPoints($('#prospect-form'));
    bindSharedProfile($('#prospect-form'));
    $('#prospect-refresh').onclick=e=>run(e.currentTarget,()=>refresh());
    $('#prospect-run').onchange=e=>{prospectRunId=Number(e.target.value);prospectSelected.clear();renderProspecting()};
  }
  $('#prospect-integrations').innerHTML=`${data.hunter?'✓ Hunter podłączony.':'Podłącz Hunter, aby wyszukiwać klientów.'} ${state.integrations.ai?'✓ OpenAI ocenia dopasowanie i pisze wiadomości.':'Bez OpenAI wyniki wymagają ręcznej oceny, a wiadomości korzystają z szablonów.'} <button class="link" data-view="settings">Otwórz Integracje →</button>`;
  const busy=data.runs.some(r=>['searching','verifying','drafting'].includes(r.status));
  $('#prospect-search').disabled=!data.hunter||busy;
  if(!data.runs.some(r=>r.id===prospectRunId))prospectRunId=data.runs[0]?.id;
  $('#prospect-run').innerHTML=data.runs.map(r=>`<option value="${r.id}" ${r.id===prospectRunId?'selected':''}>#${r.id} · ${esc(r.audience.slice(0,90))}</option>`).join('')||'<option>Brak wyszukiwań</option>';
  const selectedRun=data.runs.find(r=>r.id===prospectRunId),root=$('#prospect-results');
  if(!selectedRun){root.innerHTML=empty('Zacznij od opisu odbiorców','Firmy i kontakty zostaną znalezione w Hunter. Nie tworzymy fikcyjnych wyników.');return}
  const rows=data.candidates.filter(p=>p.run_id===selectedRun.id),warnings=JSON.parse(selectedRun.warnings||'[]');
  root.innerHTML=`<div class="panel-head"><p><strong>${esc(prospectStatus[selectedRun.status]||selectedRun.status)}</strong> · ${esc(selectedRun.stage)}</p><span class="badge gray">${rows.length} osób</span></div>${selectedRun.status==='drafting'?`<div class="draft-progress" role="status"><p><span>Gotowe szkice:</span> <strong>${Number(selectedRun.draft_completed)||0} / ${Number(selectedRun.draft_total)||0}</strong></p><progress aria-label="Postęp tworzenia szkiców" max="${Number(selectedRun.draft_total)||1}" value="${Number(selectedRun.draft_completed)||0}"></progress><p class="hint">Generowanie trwa w tle. Możesz przejść do innej zakładki i wrócić do wyników.</p></div>`:''}${selectedRun.error?`<p class="error">${esc(selectedRun.error)}</p>`:''}${warnings.map(w=>`<p class="hint">${esc(w)}</p>`).join('')}
    <p><strong>J\u0119zyk wiadomo\u015bci:</strong> <span data-no-translate>${esc(state.languages[selectedRun.language]?.label||selectedRun.language)}</span></p><details><summary>Oferta i zastosowane filtry wyszukiwarki</summary><p>${esc(selectedRun.offer)}</p><pre class="prospect-filters">${esc(JSON.stringify(JSON.parse(selectedRun.filters||'{}'),null,2))}</pre><p class="hint">Filtry wynikają z interpretacji opisu przez Hunter. Sprawdź, czy odpowiadają Twoim wymaganiom.</p></details>
    ${rows.map(p=>{const eligible=prospectEligible(p),sources=JSON.parse(p.sources),evidence=JSON.parse(p.evidence);return `<article class="prospect-card"><div class="panel-head"><div><h3>${esc(p.name)} · ${esc(p.company)}</h3><p>${esc(p.role)||'Stanowisko nieznane'} · ${esc(p.email)}</p></div><span class="badge ${p.verification_status==='valid'?'':'gray'}">${esc(verificationLabels[p.verification_status]||p.verification_status)}</span></div><p><strong>${{matched:'Dopasowanie według AI',uncertain:'Do ręcznej oceny',rejected:'Odrzucono według AI'}[p.qualification]||'Do oceny'}:</strong> ${esc(p.fit_reason)}</p><p class="hint">Braki: ${esc(p.missing_data)}</p><p><strong>Dlaczego teraz:</strong> ${esc(p.why_now)}</p><details><summary>Źródła i daty</summary><p>${esc(evidence.company_summary)||'Nie odczytano opisu strony firmy.'}</p><p class="hint">Pobrano: ${date(evidence.retrieved)}. ${p.checked_at?'Zapytanie weryfikacji: '+date(p.checked_at)+'. ':''}${p.verified_at?'Weryfikacja dostawcy: '+date(p.verified_at)+'.':''}</p>${sources.map(s=>`<p><a class="link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a>${s.last_seen?` <small>Ostatnio widziano: ${esc(s.last_seen)}</small>`:''}</p>`).join('')}</details><label class="check"><input type="checkbox" data-prospect-id="${p.id}" ${eligible&&!selectedRun.campaign_id&&!busy?'':'disabled'} ${prospectSelected.has(p.id)&&eligible?'checked':''}>Sprawdziłem dopasowanie i wybieram tę osobę do szkiców</label>${!eligible?'<p class="hint">Wybór wymaga aktualnego wyniku „Zweryfikowany”, braku odrzucenia i braku kontaktu w bazie.</p>':''}</article>`}).join('')||empty(busy?'Trwa wyszukiwanie…':'Brak kontaktów dla tych kryteriów','Możesz zmienić opis firm, stanowiska lub dział. Brak wyników nie oznacza błędu połączenia.')}
    <div class="actions prospect-actions"><button class="secondary" data-prospect-action="verify" ${busy||!data.hunter||!rows.length||selectedRun.campaign_id?'disabled':''}>Zweryfikuj adresy email</button><button class="primary" data-prospect-action="draft" ${busy||selectedRun.campaign_id?'disabled':''}>Utwórz szkice dla wybranych</button>${selectedRun.campaign_id?'<button class="primary" data-prospect-action="open">Otwórz kampanię i sprawdź wiadomości →</button>':''}</div><p class="hint">Weryfikacja może zużywać kredyty Hunter. Wyniki accept-all, unknown i pending nie dopuszczają do kampanii. Powstają dwa szkice na osobę: dzień 0 i 3. Wysyłkę uruchamiasz osobno po sprawdzeniu treści.</p>`;
  root.querySelectorAll('[data-prospect-id]').forEach(el=>el.onchange=()=>{const id=Number(el.dataset.prospectId);el.checked?prospectSelected.add(id):prospectSelected.delete(id)});
  root.querySelectorAll('[data-prospect-action]').forEach(button=>button.onclick=()=>runProspectAction(button,selectedRun));
}
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
function refineControls(field){return `<div class="refine-actions" data-refine-controls="${field}"><button type="button" class="secondary" data-refine="${field}">✧ Fine tune with AI</button>${field==='offer'?'<button type="button" class="secondary" id="scan-offer-website">↗ Skanuj stronę i opisz ofertę</button><p class="hint" id="offer-website-source" hidden></p>':''}<button type="button" class="link" data-refine-undo="${field}" hidden>Cofnij zmianę</button><p class="hint" data-refine-status="${field}" role="status"></p><div data-refine-proposal="${field}" hidden><textarea readonly rows="3" data-no-translate aria-label="Propozycja AI"></textarea><button type="button" class="secondary" data-refine-apply="${field}">Zastosuj propozycję</button></div></div>`}
function bindRefineControls(){
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
  if(action==='verify'){await api('prospecting/verify',{id:record.id});await refresh();toast('Sprawdzam adresy. Wyniki będą aktualizowane.');return}
  const ids=[...prospectSelected].filter(id=>state.prospecting.candidates.some(p=>p.id===id&&p.run_id===record.id&&prospectEligible(p)));
  if(!ids.length)throw Error('Wybierz co najmniej jedną zweryfikowaną osobę.');
  $('#prospect-feedback').textContent='Przygotowuję wiadomości. Przy użyciu AI może to potrwać kilka minut.';
  const result=await api('prospecting/draft',{id:record.id,candidate_ids:ids});
  if(result.campaign_id){prospectSelected.clear();selectedCampaign=result.campaign_id;view='campaigns';await refresh();return}
  prospectDraftPending=record.id;
  await refresh();
})}
setInterval(()=>{if(view==='prospecting'&&state?.prospecting?.runs.some(r=>['searching','verifying','drafting'].includes(r.status)))refresh().catch(()=>{})},3000);

refresh().catch(e=>toast(e.message));setInterval(()=>{if(!$('#modal').open&&view!=='settings')refresh().catch(()=>{})},15000);

