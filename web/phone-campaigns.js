const phoneOutcomeLabels={answered:'Rozmowa odbyta',no_answer:'Nie odebrano'};
const phoneWarsawClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

function phoneScriptForTime(body,variant,clock){
 if(!variant)return body;
 const {start,end,otherwise}=variant;
 const inRange=start<end?(clock>=start&&clock<end):(clock>=start||clock<end);
 return inRange?body:otherwise;
}

function phoneWhatsAppUrl(number){
 const compact=number.trim().replace(/[ ()./\-]/g,'');
 const digits=compact.startsWith('+')?compact.slice(1):compact.startsWith('00')?compact.slice(2):'';
 return /^[1-9][0-9]{6,14}$/.test(digits)?'https://wa.me/'+digits:'';
}

function phoneWhatsAppLabel(text='WhatsApp'){
 return `<svg class="phone-whatsapp-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
  <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
  <path d="M8.4 7.3h.8c.3 0 .5.2.6.5l.8 1.8c.1.3 0 .5-.2.7l-.5.6c.7 1.5 1.8 2.5 3.2 3.2l.7-.8c.2-.2.5-.3.7-.2l1.8.9c.3.2.4.4.4.6-.1 1.1-.8 1.8-1.9 1.9-2.8 0-6.2-3.1-7.3-5.6-.6-1.4-.2-2.9.9-3.6Z" fill="currentColor"/>
 </svg><span>${esc(text)}</span>`;
}

function phoneWhatsAppAction(person){
 const label=phoneWhatsAppLabel();
 if(monitoringSimulation)return `<button type="button" class="secondary phone-whatsapp-link" disabled>${label}</button>`;
 const url=phoneWhatsAppUrl(person.dial);
 return url?`<a class="link phone-whatsapp-link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`:
  `<button type="button" class="link phone-whatsapp-link" data-phone-whatsapp="${esc(person.phone)}" data-contact-id="${person.id}">${label}</button>`;
}

document.addEventListener('click',event=>{
 const button=event.target.closest('[data-phone-whatsapp]');
 if(!button||monitoringSimulation)return;
 const projectId=state.seller_project.id,epoch=simulationEpoch;
 const original=button.dataset.phoneWhatsapp;
 modal(`<h2>WhatsApp</h2><form id="phone-whatsapp-form"><label for="phone-whatsapp-number">Numer w formacie międzynarodowym</label>
  <input type="tel" id="phone-whatsapp-number" value="${esc(original)}" maxlength="45" autocomplete="off" required>
  <p class="hint">Uzupełnij numer o kod kraju, zaczynając od +.</p>
  <p class="error" role="alert" data-phone-whatsapp-error></p>
  <div class="actions"><button class="secondary phone-whatsapp-link" type="submit" disabled>${phoneWhatsAppLabel('Zapisz i otwórz WhatsApp')}</button>
   <a id="phone-whatsapp-open" class="link phone-whatsapp-link" target="_blank" rel="noopener noreferrer" hidden>${phoneWhatsAppLabel('Otwórz WhatsApp')}</a>
   <button type="button" class="secondary close">Anuluj</button></div></form>`);
 const form=$('#phone-whatsapp-form'),input=$('#phone-whatsapp-number'),link=$('#phone-whatsapp-open');
 const save=form.querySelector('[type=submit]'),error=form.querySelector('[data-phone-whatsapp-error]');
 input.oninput=()=>{save.disabled=!phoneWhatsAppUrl(input.value);error.textContent=''};
 form.onsubmit=async event=>{
  event.preventDefault();
  const url=phoneWhatsAppUrl(input.value);
  if(!url||save.disabled)return;
  if(epoch!==simulationEpoch||projectId!==state.seller_project.id){
   error.textContent=translateUiText('Aktywny projekt się zmienił. Otwórz formularz ponownie.');
   return;
  }
  save.disabled=input.disabled=true;
  error.textContent='';
  const popup=window.open('about:blank','_blank');
  if(popup)popup.opener=null;
  try{
   await api('contact/phone',{id:Number(button.dataset.contactId),project_id:projectId,
    phone:'+'+url.slice('https://wa.me/'.length),expected_phone:original});
  }catch(failure){
   popup?.close();
   save.disabled=input.disabled=false;
   if(form.isConnected)error.textContent=translateUiText(failure.message);
   return;
  }
  button.dispatchEvent(new Event('phone-number-saved',{bubbles:true}));
  void refresh().catch(()=>{});
  if(popup&&!popup.closed){
   popup.location.replace(url);
   if(form.isConnected&&$('#modal').open)$('#modal').close();
  }else if(form.isConnected){
   link.href=url;
   link.hidden=false;
   save.hidden=true;
   link.focus();
  }
 };
 input.oninput();
 input.focus();
 input.setSelectionRange(0,0);
 syncLanguages();
});

async function fetchPhoneCampaign(id){
 const response=await fetch('/api/phone-campaign?'+new URLSearchParams({id}));
 const data=await response.json();
 if(!response.ok)throw Error(data.error);
 return data;
}

const phoneOfferFields=['offer','audience','website','offer_website','offer_sources','offer_draft_key','language',
 'cta','cta_url','pain_points','value_props','proof_points'];

function phoneOfferEditor(){
 return `<span class="section-label">02 / OFERTA</span><h1>Co wyróżnia Twoją ofertę?</h1>
  <p class="muted">Zaimportuj ofertę projektu lub przygotuj własną ofertę dla tej kampanii.</p>
  <button type="button" class="secondary" data-phone-import-offer>Importuj z projektu</button>
  <label for="company-url">Strona firmy, w imieniu której piszesz</label>
  <input id="company-url" name="website" type="text" inputmode="url" placeholder="firma.pl" maxlength="2000">
  <label for="phone-offer-audience">Opis grupy docelowej</label><input id="phone-offer-audience" name="audience" maxlength="3000">
  ${offerSourceControls(true,'Język oferty')}
  <label for="phone-offer">Co oferujesz i jaką korzyść daje to klientowi?</label>
  <textarea id="phone-offer" name="offer" rows="5" maxlength="10000" placeholder="Opisz konkretny produkt lub usługę."></textarea>
  ${refineControls('offer')}${sellingPointsSection('phone')}
  <label for="phone-offer-cta">Wezwanie do działania</label><input id="phone-offer-cta" name="cta" maxlength="300" placeholder="np. Umów rozmowę">
  <label for="phone-offer-cta-url">Link do następnego kroku (opcjonalnie)</label>
  <input id="phone-offer-cta-url" name="cta_url" type="url" maxlength="2000" placeholder="https://twoja-firma.pl/kontakt">`;
}

function bindPhoneOffer(form,campaign,edit,projectId){
 form.dataset.projectId=String(projectId);
 for(const field of phoneOfferFields){
  const value=campaign?.[field];
  if(typeof value==='string'&&field!=='offer_draft_key')form.elements[field].value=value;
 }
 if(!edit)form.elements.offer_draft_key.value=crypto.randomUUID();
 if(!form.elements.language.value)form.elements.language.value=projectMessageLanguage();
 bindSellingPoints(form);
 bindOfferSources(form,true,{campaignId:edit?campaign.id:null,attachments:false});
 bindTextRefinement(form.elements.offer,()=>form.elements.language.value,
  'Oferta dopracowana przez AI. Sprawdź ją przed rozmową.');
 form.querySelector('#build-language-reset').onclick=()=>{form.elements.language.value=projectMessageLanguage()};
 form.querySelector('[data-phone-import-offer]').onclick=()=>{
  const project=sellerProject();
  if(project.id!==projectId){toast(translateUiText('Projekt się zmienił. Otwórz dialog ponownie.'));return}
  applyProjectCampaignOffer(form,project);
  toast(translateUiText('Dane zaimportowane z projektu. Możesz je zmienić dla tej kampanii.'));
 };
}

function showPhoneCampaignForm({name='',campaign=null,scripts=[''],variants=[],flow=null,edit=false,locked=false}={}){
 const projectId=state.seller_project.id,epoch=simulationEpoch;
 const selected=contactTags(campaign?.audience_tags||'');
 const tags=[...new Set([...(state.contact_tags||[]),...selected])];
 const stages=['Odbiorcy','Oferta','Sekwencja','Połączenia'];
 $('#modal').close();
 $('#modal-content').replaceChildren();
 view='builder';
 document.querySelectorAll('nav [data-view]').forEach(button=>button.classList.toggle('selected',button.dataset.view==='campaigns'));
 $('#breadcrumb').textContent=translateUiText('Przestrzeń robocza / Kreator kampanii');
 $('#content').innerHTML=`<div class="builder-top phone-builder-top"><button type="button" class="secondary" data-phone-builder-exit>← Kampanie</button>
  <div><span class="section-label">${edit?'EDYCJA KAMPANII':'NOWA KAMPANIA'}</span><strong>Kampania telefoniczna</strong></div>
  <div class="builder-progress">${stages.map((label,index)=>`<button type="button" data-phone-builder-step="${index}">
   <span aria-hidden="true">${index+1}</span>${label}</button>`).join('')}</div>
  <div class="builder-header-actions"><button type="submit" class="primary" form="phone-campaign-form" data-phone-save-top>Dalej →</button></div>
  <p class="error" role="alert" data-phone-form-error hidden></p></div>
  <div class="builder-layout phone-builder-layout">
  <section class="builder-assistant"><div class="assistant-art"><img src="/assets/kaska.png" alt="Kaśka" width="600" height="400"></div>
   <p data-phone-builder-help></p></section>
  <form id="phone-campaign-form" class="builder-form" novalidate>
  <section data-phone-stage="0"><h1>Z kim chcesz porozmawiać?</h1>
  <label for="phone-campaign-name">Nazwa kampanii</label><input id="phone-campaign-name" name="name" value="${esc(name)}" maxlength="200" required>
  <label for="phone-audience-mode">Sposób doboru odbiorców</label>
  <select id="phone-audience-mode" name="audience_mode"><option value="all">Wszystkie aktywne kontakty</option><option value="tags">Według tagów</option></select>
  <p class="builder-recipient-count" role="status"><span>Kontakty do obsłużenia:</span> <strong data-phone-recipient-count>…</strong></p>
  <p class="hint" data-phone-count-error hidden></p>
  <p class="hint">Do kolejki trafią tylko aktywne kontakty z numerem telefonu.</p>
  <div data-phone-tags hidden>
   <fieldset class="campaign-tag-picker"><legend>Tagi odbiorców</legend>${tags.map(tag=>`<label class="check">
    <input type="checkbox" name="audience_tags" value="${esc(tag)}" ${selected.includes(tag)?'checked':''}><span data-no-translate>${esc(tag)}</span></label>`).join('')||'<p class="hint">Najpierw dodaj tagi do kontaktów.</p>'}</fieldset>
   <label for="phone-tag-match">Sposób dopasowania tagów</label><select id="phone-tag-match" name="tag_match">
    <option value="any">Dowolny z wybranych tagów (LUB)</option><option value="all">Wszystkie wybrane tagi (I)</option></select>
  </div>
  </section>
  <section data-phone-stage="1" hidden>${phoneOfferEditor()}</section>
  <section data-phone-stage="2" hidden><h1>Sekwencja rozmów</h1>
   ${locked?'<p class="hint">Nową strukturę zastosujesz do kontaktów, które jeszcze nie rozpoczęły rozmów.</p>':''}
  <div data-phone-flow-editor></div>
  </section>
  <section data-phone-stage="3" hidden><h1>Połączenia</h1>
   <p class="hint">Kontakty pasujące do wybranych odbiorców i warunków wejścia.</p>
   <div data-phone-connections></div></section>
  <div class="builder-footer"><button type="button" class="secondary" data-phone-builder-prev>Wstecz</button>
   <span data-phone-builder-progress></span>
   <button type="button" class="primary" data-phone-builder-next>Dalej →</button>
   <button type="submit" class="primary" hidden>Zapisz kampanię</button></div></form></div>`;
 const form=$('#phone-campaign-form'),mode=form.elements.audience_mode;
 const error=$('[data-phone-form-error]'),topSave=$('[data-phone-save-top]');
 const setError=message=>{error.textContent=translateUiText(message);error.hidden=!message};
 const previous=form.querySelector('[data-phone-builder-prev]'),next=form.querySelector('[data-phone-builder-next]');
 const save=form.querySelector('[type=submit]'),indicators=[...document.querySelectorAll('[data-phone-builder-step]')];
 const sections=[...form.querySelectorAll('[data-phone-stage]')];
 const rules=JSON.parse(campaign?.conditions||'[]');
 const graph=flow?structuredClone(flow):legacyPhoneFlow(scripts,variants,rules);
 const flowEditor=form.querySelector('[data-phone-flow-editor]');
 const openFlowNode=renderPhoneFlowEditor(flowEditor,graph,()=>form.elements.offer.value);
 let stage=0,saving=false,connectionsRequest=0;
 const audiencePayload=data=>({id:edit?campaign.id:undefined,project_id:projectId,
  audience_mode:data.get('audience_mode'),tag_match:data.get('tag_match'),
  audience_tags:data.getAll('audience_tags'),flow:graph});
 const count=form.querySelector('[data-phone-recipient-count]'),countError=form.querySelector('[data-phone-count-error]');
 let countRequest;
 async function updateRecipientCount(){
  countRequest?.abort();
  countError.hidden=true;
  const payload=audiencePayload(new FormData(form));
  if(payload.audience_mode==='tags'&&!payload.audience_tags.length){count.textContent='0';return}
  const request=new AbortController();
  countRequest=request;
  count.textContent='…';
  try{
   const {recipients}=await api('phone-campaign/recipients',payload,request.signal);
   if(form.isConnected&&!request.signal.aborted){
    count.textContent=recipients.length.toLocaleString(uiLanguage==='en'?'en-GB':'pl-PL');
   }
  }catch{
   if(form.isConnected&&!request.signal.aborted){
    count.textContent='—';
    countError.textContent=translateUiText('Nie udało się policzyć odbiorców.');
    countError.hidden=false;
   }
  }
 }
 async function loadConnections(){
  const request=++connectionsRequest,root=form.querySelector('[data-phone-connections]');
  root.innerHTML=`<p class="hint" role="status">${esc(translateUiText('Wczytywanie kontaktów…'))}</p>`;
  try{
   const {recipients}=await api('phone-campaign/recipients',audiencePayload(new FormData(form)));
   if(!form.isConnected||stage!==3||request!==connectionsRequest)return;
   root.innerHTML=recipients.length?`<div class="table-wrap"><table><thead><tr><th>Kontakt</th><th>Telefon</th><th>WhatsApp</th></tr></thead>
    <tbody>${recipients.map(person=>`<tr><td data-no-translate><strong>${esc(person.name)}</strong><small>${esc(person.company)}</small></td>
     <td data-no-translate>${esc(person.phone)}</td><td>${phoneWhatsAppAction(person)}</td></tr>`).join('')}</tbody></table></div>`:
    '<p class="hint">Brak kontaktów do obdzwonienia.</p>';
   syncLanguages();
  }catch(failure){
   if(form.isConnected&&stage===3&&request===connectionsRequest)root.innerHTML=
    `<p class="error" role="alert">${esc(translateUiText(failure.message))}</p><button type="button" class="secondary" data-phone-connections-retry>Odśwież</button>`;
   root.querySelector('[data-phone-connections-retry]')?.addEventListener('click',loadConnections);
  }
 }
 form.addEventListener('phone-number-saved',()=>{if(stage===3)void loadConnections()});
 const showStage=index=>{
  stage=index;
  setError('');
  sections.forEach((section,position)=>{section.hidden=position!==stage});
  indicators.forEach((button,position)=>{
   button.classList.toggle('selected',position===stage);
   if(position===stage)button.setAttribute('aria-current','step');
   else button.removeAttribute('aria-current');
  });
  previous.disabled=stage===0;
  next.hidden=stage>=2;
  save.hidden=stage<2;
  topSave.textContent=translateUiText(stage<2?'Dalej →':'Zapisz kampanię');
  form.querySelector('[data-phone-builder-progress]').textContent=translateUiText(`Krok ${stage+1} z 4`);
  $('[data-phone-builder-help]').textContent=translateUiText(['Wybierz kontakty do kampanii telefonicznej.',
   'Przygotuj ofertę i argumenty do rozmowy.','Przygotuj skrypt każdego kroku rozmowy.',
   'Sprawdź odbiorców i otwórz rozmowę w WhatsApp.'][stage]);
  if(stage===0)void updateRecipientCount();
  if(stage===3)void loadConnections();
 };
 const validAudience=()=>{
  if(!form.elements.name.value.trim()){
   showStage(0);
   setError('Podaj nazwę kampanii.');
   form.elements.name.focus();
   return false;
  }
  if(mode.value==='tags'&&!form.querySelector('[name=audience_tags]:checked')){
   showStage(0);
   setError('Wybierz co najmniej jeden tag.');
   return false;
  }
  return true;
 };
 const advance=()=>{if(validAudience())showStage(stage+1)};
 next.onclick=advance;
 previous.onclick=()=>showStage(stage-1);
 indicators[0].onclick=()=>showStage(0);
 indicators.slice(1).forEach((button,index)=>button.onclick=()=>{if(validAudience())showStage(index+1)});
 $('[data-phone-builder-exit]').onclick=()=>{
  view='campaigns';
  selectedCampaign=edit?campaign.id:null;
  render();
  syncLanguages();
 };
 mode.value=campaign?.audience_mode||'all';
 form.elements.tag_match.value=campaign?.tag_match||'any';
 bindPhoneOffer(form,campaign,edit,projectId);
 const showTags=()=>{form.querySelector('[data-phone-tags]').hidden=mode.value!=='tags'};
 mode.onchange=()=>{showTags();void updateRecipientCount()};
 form.querySelector('[data-phone-tags]').onchange=()=>void updateRecipientCount();
 showTags();
 showStage(0);
 form.onsubmit=event=>{
  event.preventDefault();
  if(saving)return;
  if(stage<2){advance();return}
  if(!validAudience())return;
  if(form.offerSourcesBusy()){setError('Poczekaj na zakończenie pracy ze źródłami oferty.');return}
  if(flowEditor.querySelector('[data-refine]:disabled')){
   setError('Poczekaj, aż AI dopracuje skrypt.');
   return;
  }
  const blank=graph.nodes.find(node=>node.kind==='script'&&!node.text.trim());
  if(blank){
   showStage(2);
   openFlowNode(blank.id);
   setError('Uzupełnij skrypt każdego kroku rozmowy.');
   return;
  }
  const invalidTime=graph.nodes.find(node=>node.kind==='condition'&&node.rules.some(rule=>
   rule.field==='call_time'&&(!rule.start||!rule.end||rule.start===rule.end)));
  if(invalidTime){
   showStage(2);
   openFlowNode(invalidTime.id);
   setError('Ustaw dwie różne godziny w warunku godziny rozmowy.');
   return;
  }
  void run(save,async()=>{
   if(projectId!==state.seller_project.id||epoch!==simulationEpoch){
    setError('Projekt się zmienił. Otwórz dialog ponownie.');
    return;
   }
   saving=topSave.disabled=true;
   setError('');
   const data=new FormData(form);
   try{
    const {id}=await api('phone-campaign/save',{...audiencePayload(data),name:data.get('name'),
     ...Object.fromEntries(phoneOfferFields.map(field=>[field,data.get(field)])),
     revision:edit?campaign.revision:undefined});
    if(!form.isConnected||projectId!==state.seller_project.id||epoch!==simulationEpoch)return;
    selectedCampaign=id;
    view='campaigns';
    await refresh();
   }catch(failure){setError(failure.message)}
   finally{saving=topSave.disabled=false}
  });
 };
 form.elements.name.focus();
 syncLanguages();
}

function renderPhoneCampaign(campaign){
 const existing=$('#phone-campaign');
 const scope=JSON.stringify([campaign.id,campaign.revision,simulationEpoch]);
 if(existing?.dataset.scope===scope){void loadPhoneCampaign(existing,campaign);return}
 $('#content').innerHTML=`<button type="button" class="link" data-action="back">← Wszystkie kampanie</button>`+
  renderTop(esc(campaign.name),translateUiText('Kampania telefoniczna'),`<div class="actions">
   <button type="button" class="secondary" data-action="edit-campaign" data-id="${campaign.id}">Edytuj kampanię</button>
   <button type="button" class="link danger" data-action="delete-campaign" data-id="${campaign.id}">Usuń kampanię</button></div>`)+
  renderPhoneOfferDetails(campaign)+
  '<section id="phone-campaign" class="panel"><p class="hint" role="status">Wczytywanie kolejki rozmów…</p></section>';
 const root=$('#phone-campaign');
 root.dataset.scope=scope;
 $('#content .topline h1').dataset.noTranslate='';
 root.onclick=event=>{
  const button=event.target.closest('[data-phone-outcome]');
  if(!button)return;
  void run(button,async()=>{
   for(const sibling of button.closest('.actions').querySelectorAll('button'))sibling.disabled=true;
   try{
    await api('phone-campaign/record',{id:campaign.id,project_id:campaign.project_id,contact_id:Number(button.dataset.contactId),
     position:Number(button.dataset.position),outcome:button.dataset.phoneOutcome,revision:Number(button.dataset.revision),
     flow_id:button.dataset.flowId?Number(button.dataset.flowId):undefined});
   }finally{
    await loadPhoneCampaign(root,campaign);
    if(button.isConnected)for(const sibling of button.closest('.actions').querySelectorAll('button'))sibling.disabled=false;
   }
  });
 };
 void loadPhoneCampaign(root,campaign);
}

function renderPhoneOfferDetails(campaign){
 const sections=[['offer','Oferta'],['audience','Opis grupy docelowej'],['pain_points','Problemy odbiorców'],
  ['value_props','Propozycje wartości'],['proof_points','Proof points'],['cta','Wezwanie do działania']];
 const actual=sections.filter(([field])=>campaign[field]);
 if(!actual.length&&!campaign.cta_url)return '';
 return `<details class="panel"><summary>Oferta</summary>${actual.map(([field,title])=>
  `<h3>${title}</h3><p class="message" data-no-translate>${esc(campaign[field])}</p>`).join('')}
  ${campaign.cta_url?`<p>${sourceLink(campaign.cta_url,translateUiText('Link do następnego kroku'))}</p>`:''}</details>`;
}

async function loadPhoneCampaign(root,campaign){
 const version=(root.requestVersion||0)+1;
 root.requestVersion=version;
 try{
  const data=await fetchPhoneCampaign(campaign.id);
  if(!root.isConnected||version!==root.requestVersion)return;
  const clock=phoneWarsawClock.format(new Date());
  const activeScripts=data.scripts.map((body,index)=>phoneScriptForTime(body,data.time_variants?.[index],clock));
  const activeQueue=data.queue.map(person=>person.flow_id?{...person,
   script:phoneScriptForTime(person.script,person.time_variant,clock)}:person);
  const markup=JSON.stringify([data,activeScripts,activeQueue]);
  if(markup===root.lastData)return;
  const expanded=new Set([...root.querySelectorAll('details[open]')].map(item=>item.dataset.phoneDetails));
  root.innerHTML=phoneCampaignMarkup({...data,queue:activeQueue},expanded,activeScripts);
  root.lastData=markup;
  syncLanguages();
 }catch(error){
  if(root.isConnected&&version===root.requestVersion){
   root.lastData=null;
   root.innerHTML=`<p class="error" role="alert">${esc(translateUiText(error.message))}</p>`;
  }
 }
}

function phoneCampaignMarkup({scripts,time_variants=[],conditions=[],flow,queue,calls,revision,paused},expanded,activeScripts){
 const open=key=>expanded.has(key)?'open':'';
 const script=(body,key)=>`<details data-phone-details="${key}" ${open(key)}><summary>Skrypt rozmowy</summary>
  <p class="message" data-no-translate>${esc(body)}</p></details>`;
 const label=(outcome,person)=>`<button type="button" class="secondary" data-phone-outcome="${outcome}"
  data-contact-id="${person.id}" data-position="${person.position}" data-revision="${revision}"
  data-flow-id="${person.flow_id??''}">${phoneOutcomeLabels[outcome]}</button>`;
 const rules=position=>{
  const matching=conditions.filter(rule=>rule.before_step===position);
  return matching.length?`<ul class="hint">${matching.map(rule=>`<li><span>${esc(conditionFields[rule.field])}</span> ·
   <span>${esc(conditionOps[rule.operator])}</span> <span data-no-translate>${esc(rule.value)}</span></li>`).join('')}</ul>`:'';
 };
 return `<div class="panel-head"><h2>Kolejka rozmów</h2><span class="badge gray">${queue.length}</span></div>
  <p class="hint">${flow?'Wynik rozmowy wybiera dalszą ścieżkę zapisaną w sekwencji.':
   'Po rozmowie zapisz wynik. Gdy kontakt nie odbierze, kolejka przejdzie dalej, jeśli warunki kolejnego kroku są spełnione.'}</p>
  ${paused?'<p class="notice">Kolejka jest wstrzymana. Sprawdź odbiorców w edycji kampanii i zapisz zmiany.</p>':
  queue.length?`<div class="table-wrap"><table><thead><tr><th>Kontakt</th><th>Telefon</th><th>Krok</th><th>Wynik rozmowy</th></tr></thead>
  <tbody>${queue.map(person=>`<tr><td data-no-translate><strong>${esc(person.name)}</strong><small>${esc(person.company)}</small></td>
   <td><span data-no-translate>${monitoringSimulation?esc(person.phone):`<a class="link" href="tel:${esc(person.dial)}">${esc(person.phone)}</a>`}</span>
    <small>${phoneWhatsAppAction(person)}</small></td>
   <td><span>${person.position+1} / ${person.steps??scripts.length}</span>${script(person.script??activeScripts[person.position],
    person.flow_id?'person-'+person.id:'person-'+person.id+'-'+person.position)}</td>
   <td><div class="actions">${label('answered',person)}${label('no_answer',person)}</div></td></tr>`).join('')}</tbody></table></div>`:
    '<p class="hint">Brak kontaktów do obdzwonienia.</p>'}
  <details data-phone-details="sequence" ${open('sequence')}><summary>Sekwencja rozmów</summary>
   ${flow?phoneFlowOverview(flow):rules(undefined)+'<ol>'+scripts.map((body,position)=>{
    const variant=time_variants[position];
    return `<li>${rules(position)}${variant?`<p class="hint"><span>Pora dnia</span> · ${esc(variant.start)}–${esc(variant.end)}</p>
     <p class="hint">Skrypt w wybranych godzinach</p>`:''}
     <p class="message" data-no-translate>${esc(body)}</p>${variant?`<p class="hint">Skrypt poza wybranymi godzinami</p>
      <p class="message" data-no-translate>${esc(variant.otherwise)}</p>`:''}</li>`;
   }).join('')+'</ol>'}</details>
  <details data-phone-details="history" ${open('history')}><summary>Historia rozmów · ${calls.length}</summary>
   ${calls.length?`<div class="table-wrap"><table><thead><tr><th>Kontakt</th><th>Krok</th><th>Wynik rozmowy</th><th>Data i godzina</th></tr></thead>
    <tbody>${calls.map(call=>`<tr><td data-no-translate>${esc(call.name)}</td><td>${call.position+1}</td>
     <td>${esc(phoneOutcomeLabels[call.outcome])}</td><td data-no-translate>${deliveryTime(call.created)}</td></tr>`).join('')}</tbody></table></div>`:
    '<p class="hint">Brak zapisanych rozmów.</p>'}</details>`;
}
