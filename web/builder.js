let builderEditing=null;
const builderDraftKey=()=>'campaign-builder-draft:'+state.seller_project.id+(builderEditing?':edit:'+builderEditing.campaign.id:'')+
 (state.simulation_generation?':simulation:'+state.simulation_generation:'');
let builderStep=0;
function builderContacts(){return [...new Map([...(builderEditing?.selected_contacts||[]),...state.contacts].map(contact=>[contact.id,contact])).values()]}
const builderStages=['Odbiorcy','Oferta','Sekwencja','Ustawienia'];
function campaignAudience(c){if(c.audience_mode==='tags')return translateUiText('Tagi')+': '+contactTags(c.audience_tags).join('; ');if(c.audience_mode==='group')return translateUiText('Tagi')+': '+c.target_group;if(c.audience_mode==='selected')return `Wybrane kontakty (${JSON.parse(c.contact_ids).length})`;return 'Wszystkie aktywne kontakty'}
function campaignRecipientNotice(c){if(c.audience_mode==='tags')return translateUiText('Odbiorcy według tagów:')+' '+contactTags(c.audience_tags).join('; ')+' · '+translateUiText(c.tag_match==='all'?'Wszystkie wybrane tagi (I)':'Dowolny z wybranych tagów (LUB)');if(c.audience_mode==='group')return translateUiText('Przygotowanie obejmuje aktywne kontakty należące do wybranej grupy w chwili generowania.')+' '+translateUiText('Grupa docelowa')+': '+c.target_group+'.';if(c.audience_mode==='selected')return 'Przygotowanie obejmuje wyłącznie wybrane, nadal aktywne kontakty. Lista jest zapisana w kampanii.';return 'Przygotowanie obejmuje wszystkie aktywne kontakty w bazie w chwili generowania.'}
const companyMaterials=website=>{try{return state.library.materials.filter(m=>!m.simulated&&new URL(m.website).hostname.replace(/^www\./,'')===new URL(website).hostname.replace(/^www\./,''))}catch{return []}};

function showBuilderEditing(){
 $('.builder-top .section-label').textContent=translateUiText('EDYCJA KAMPANII');
 if(!$('.campaign-edit-notice'))$('#campaign-form').insertAdjacentHTML('afterbegin','<p class="notice campaign-edit-notice">Zapis zmian wstrzyma aktywną kampanię. Wysłane kroki pozostają zablokowane. Zmienione oczekujące wiadomości zostaną odświeżone według szablonów. Po zmianie szkicu przygotuj wiadomości ponownie.</p>');
}

async function editCampaign(id){
 const campaign=state.campaigns.find(row=>row.id===id);
 if(campaign?.channel==='phone'){
  const epoch=simulationEpoch;
  const data=await fetchPhoneCampaign(id);
  if(campaign.project_id===state.seller_project.id&&epoch===simulationEpoch){
   showPhoneCampaignForm({name:campaign.name,campaign,scripts:data.scripts,variants:data.time_variants,flow:data.flow,edit:true,locked:data.calls.length>0});
  }
  return;
 }
 const data=await api('campaign/edit-data',{id});if(data.campaign.project_id!==state.seller_project.id)return;openCampaignBuilder(data);
}
async function cloneCampaign(id,name){
 const projectId=state.seller_project.id,epoch=simulationEpoch;
 const data=await api('campaign/clone',{id,project_id:projectId,name});
 if(data.campaign.project_id!==state.seller_project.id||epoch!==simulationEpoch)return;
 if(data.campaign.channel==='phone'){
  const phone=await fetchPhoneCampaign(data.campaign.id);
  if(projectId!==state.seller_project.id||epoch!==simulationEpoch)return;
  showPhoneCampaignForm({name:data.campaign.name,campaign:data.campaign,scripts:phone.scripts,
   variants:phone.time_variants,flow:phone.flow,edit:true});
 }else openCampaignBuilder(data);
 await refresh();
 toast(translateUiText('Utworzono kopię kampanii.'));
}
function showNewCampaignDialog(){
 const projectId=state.seller_project.id,epoch=simulationEpoch;
 const campaigns=state.campaigns.filter(campaign=>campaign.project_id===projectId);
 modal(`<h2>Nowa kampania</h2><form id="new-campaign-form">
 <label for="new-campaign-mode">Jak utworzyć kampanię?</label>
 <select id="new-campaign-mode"><option value="blank">Nowa kampania</option><option value="clone" ${campaigns.length?'':'disabled'}>Sklonuj kampanię</option><option value="phone">Kampania telefoniczna</option></select>
 <div data-campaign-clone-source hidden>
  <label for="new-campaign-source">Kampania do sklonowania</label>
  <select id="new-campaign-source">${campaigns.map(campaign=>`<option value="${campaign.id}" data-no-translate>${esc(campaign.name)}</option>`).join('')}</select>
  <p class="hint">Kopia będzie szkicem z tymi samymi ustawieniami, odbiorcami, ofertą, dokumentami i sekwencją.</p>
 </div>
 <label for="new-campaign-name">Nazwa kampanii</label><input id="new-campaign-name" name="name" maxlength="200">
 <div class="actions"><button class="primary">Utwórz kampanię</button><button type="button" class="secondary close">Anuluj</button></div></form>`);
 const form=$('#new-campaign-form'),mode=$('#new-campaign-mode'),source=$('#new-campaign-source'),name=form.elements.name;
 const sourceSection=form.querySelector('[data-campaign-clone-source]'),submit=form.querySelector('.primary');
 let suggestion='';
 const update=()=>{
  const cloning=mode.value==='clone'&&campaigns.length>0;
  const next=cloning?(translateUiText('Kopia')+' '+source.selectedOptions[0].textContent).slice(0,name.maxLength):'';
  if(!name.value.trim()||name.value===suggestion)name.value=next;
  suggestion=next;name.required=cloning;sourceSection.hidden=!cloning;
  submit.textContent=translateUiText(cloning?'Sklonuj kampanię':'Utwórz kampanię');
 };
 mode.onchange=source.onchange=update;
 form.onsubmit=event=>{
  event.preventDefault();
  if(state.seller_project.id!==projectId||simulationEpoch!==epoch){toast('Projekt się zmienił. Otwórz dialog ponownie.');return}
  const enteredName=name.value.trim();
  if(mode.value==='phone'){
   showPhoneCampaignForm({name:enteredName});
   return;
  }
  if(mode.value==='clone'){
   void run(event.submitter,()=>cloneCampaign(Number(source.value),enteredName));
   return;
  }
  newCampaign();
  if(enteredName){
   const field=$('#build-name');
   field.value=enteredName;
   field.dispatchEvent(new Event('input',{bubbles:true}));
  }
 };
 update();
 mode.focus();
 syncLanguages();
}
function openCampaignBuilder(editing=null){
  builderEditing=editing;
  $('#modal').close();$('#modal-content').innerHTML='';
  view='builder';builderStep=0;resetSequence();
  document.querySelectorAll('nav [data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view==='campaigns'));
  $('#breadcrumb').textContent='Przestrzeń robocza / Kreator kampanii';
  const contacts=builderContacts().filter(c=>!c.simulated&&(c.status==='active'||builderEditing?.selected_contacts?.some(selected=>selected.id===c.id)));
  $('#content').innerHTML=`<div class="builder-top"><button class="secondary" data-builder="exit">← Kampanie</button><div><span class="section-label">NOWA KAMPANIA</span><strong id="builder-campaign-title">Nowa kampania</strong></div><div class="builder-progress">${builderStages.map((s,i)=>`<button data-builder-step="${i}" ${i===0?'aria-current="step"':''}><span class="tab-step-number" aria-hidden="true">${i+1}</span>${s}</button>`).join('')}</div><div class="builder-header-actions"><button class="secondary" data-builder="save-draft">Zapisz szkic</button><button class="primary" data-builder="header-next">Zapisz i przejdź dalej</button><button type="button" class="primary" data-builder="launch" hidden>Uruchom kampanię</button></div></div>
  <div class="builder-layout"><section class="builder-assistant"><div class="assistant-mini-toolbar"><span>↶</span><strong>Kaśka</strong><span>✧</span></div><div class="assistant-art"><img src="/assets/kaska.png" alt="Kaśka — ruda asystentka w okrągłych okularach" width="600" height="400"></div><div class="assistant-intro"><img src="/assets/kaska.png" alt="" width="32" height="32"><p>Cześć, jestem Kaśka.<br>Jak mogę Ci dziś pomóc w tworzeniu kampanii?</p></div><p id="builder-help">Zacznij od osób, z którymi chcesz porozmawiać. Możesz wybrać kontakty albo użyć sygnałów sprzedażowych.</p><div class="assistant-shortcuts"><button type="button" data-builder="website-shortcut">Stw\u00f3rz ofert\u0119 z naszej strony</button><button type="button" data-builder="materials-shortcut">Zbuduj ofert\u0119 z historii sukcesu</button></div><div class="assistant-note">Twoja kampania, krok po kroku.<br>Wiadomości sprawdzisz przed wysyłką.</div></section>
  <form id="campaign-form" class="builder-form">
    <div class="actions builder-small-actions builder-project-import"><button type="button" class="secondary" data-builder="import-project">Importuj z projektu</button><span class="hint" data-no-translate>${esc(sellerProject().name||'')}</span></div>
    <section data-stage="0"><span class="section-label">01 / ODBIORCY</span><h1>Z kim chcesz porozmawiać?</h1><p class="muted">Oferta i grupa docelowa są ustalane osobno dla każdej kampanii.</p><label for="build-name">Nazwa kampanii</label><input id="build-name" name="name" required placeholder="np. Wprowadzenie nowej usługi"><label for="build-audience">Opis grupy docelowej</label><input id="build-audience" name="audience" placeholder="Stanowiska, firmy, potrzeby…"><label for="build-mode">Sposób doboru odbiorców</label><select id="build-mode" name="audience_mode"><option value="tags" ${(state.contact_tags||[]).length?'selected':''}>Według tagów</option><option value="all" ${!(state.contact_tags||[]).length?'selected':''}>Wszystkie aktywne kontakty w bazie</option><option value="selected">Wybrane kontakty</option></select><p id="builder-recipient-hint" class="builder-recipient-count" role="status"><span>Kontakty do obsłużenia:</span> <strong data-recipient-count>0</strong></p><div id="builder-target-tags" hidden><fieldset class="campaign-tag-picker"><legend>Tagi odbiorców</legend>${(state.contact_tags||[]).map(tag=>`<label class="check"><input type="checkbox" name="audience_tags" value="${esc(tag)}"><span data-no-translate>${esc(tag)}</span></label>`).join('')||'<p class="hint">Najpierw dodaj tagi do kontaktów.</p>'}</fieldset><label for="build-tag-match">Sposób dopasowania tagów</label><select id="build-tag-match" name="tag_match"><option value="any">Dowolny z wybranych tagów (LUB)</option><option value="all">Wszystkie wybrane tagi (I)</option></select><p class="hint">Kontakt bierze udział w kampanii tylko raz, nawet gdy pasuje do kilku tagów.</p></div><div id="builder-recipients" class="recipient-picker" hidden>${contacts.map(c=>`<label class="check"><input type="checkbox" name="contact_ids" value="${c.id}"><span><strong>${esc(c.name)}</strong><small>${esc(c.company)} · ${esc(c.email)}</small></span></label>`).join('')||'<p class="hint">Najpierw dodaj kontakty w zakładce Kontakty.</p>'}</div></section>
    <section data-stage="1" hidden><span class="section-label">02 / OFERTA</span><h1>Co wyróżnia Twoją ofertę?</h1><p class="muted">Zaimportuj ofertę projektu lub przygotuj własną ofertę dla tej kampanii.</p><label for="company-url">Strona firmy, w imieniu której piszesz</label><input id="company-url" name="website" type="text" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="firma.pl"><div class="actions builder-small-actions"><button type="button" class="secondary" data-builder="discover">↗ Pobierz ofertę i materiały</button></div><p id="research-status" class="hint">Brak domyślnej firmy. Każda domena ma oddzielną bibliotekę materiałów.</p>${offerSourceControls(true)}<label for="build-offer">Co oferujesz i jaką korzyść daje to klientowi?</label><textarea id="build-offer" name="offer" rows="5" required placeholder="Opisz konkretny produkt lub usługę."></textarea>${refineControls('offer')}${sellingPointsSection('builder')}<label for="build-cta">Wezwanie do działania</label><input id="build-cta" name="cta" placeholder="np. Umów rozmowę"><label for="build-cta-url">Link do następnego kroku (opcjonalnie)</label><input id="build-cta-url" name="cta_url" type="url" placeholder="https://twoja-firma.pl/kontakt"><label for="build-material-mode">Materiał dla odbiorcy</label><select id="build-material-mode" name="material_mode"><option value="none">Bez dodatkowego materiału</option><option value="auto">Dobierz ze strony według kontekstu odbiorcy</option><option value="manual">Wybiorę artykuł lub case study</option><option value="document" disabled>Wyślę dokument jako załącznik</option></select><input type="hidden" name="attachment_ref"><div id="builder-material-list"></div><div id="builder-attachment-upload" hidden><label for="builder-attachment-file">Dodaj plik jako załącznik</label><input type="file" id="builder-attachment-file" accept=".pdf,.docx,.txt,.md" aria-describedby="builder-attachment-hint builder-attachment-status"><p class="hint" id="builder-attachment-hint">PDF, DOCX, TXT lub MD. Maksymalnie 6 MB na plik.</p><p class="hint" id="builder-attachment-status" role="status"></p></div><p class="hint" id="builder-attachment-channel-hint" hidden>Załączniki są dostępne dla kampanii e-mail.</p><p class="hint">Automatyczny dobór korzysta z podobieństwa słów w stanowisku, notatkach, grupie docelowej. Bez dopasowania nie dodaje linku. Wybór ręczny dołącza jeden z wybranych materiałów.</p></section>
    <section data-stage="2" hidden><span class="section-label">03 / SEKWENCJA</span><h1>Każda wiadomość ma swój moment.</h1><p class="muted">Ustaw kroki, odstępy i treść. Odpowiedź lub rezygnacja zatrzyma dalszą wysyłkę.</p><div id="sequence-map" class="sequence-map"></div><div class="flow-start">○ Aktywny odbiorca z adresem email</div><div id="steps"></div><button type="button" class="secondary" data-builder="add-step">+ Dodaj follow-up</button><p class="hint">Dni liczone od uruchomienia kampanii. Zmienne: {{name}}, {{company}}, {{offer}}, {{signal_title}}, {{material_title}}, {{material_url}}, {{cta}}. Edycja szablonu nie wysyła wiadomości.</p></section>
    <section data-stage="3" hidden><span class="section-label">04 / USTAWIENIA</span><h1>Sprawdź, zanim ruszysz.</h1><p class="muted">Zapisz kampanię jako szkic, przygotuj wiadomości i sprawdź je przed wysyłką.</p><label for="build-channel">Kanał wysyłki</label><select id="build-channel" name="channel"><option value="email">E-mail · kolejka SMTP</option><option value="linkedin">LinkedIn · kolejka do ręcznej wysyłki</option></select><p class="hint">Wiadomości LinkedIn pojawią się w panelu rozszerzenia PKEY. Wyślij je ręcznie w LinkedIn, a potem oznacz jako wysłane.</p><div id="builder-summary"></div><div class="builder-checks"><p>✓ Zatrzymanie sekwencji po odpowiedzi i rezygnacji</p><p>✓ Sprawdzenie wiadomości przed wysyłką</p><p>${state.integrations.smtp?'✓ Poczta wychodząca jest skonfigurowana':'○ Poczta wymaga podłączenia w Integracjach'}</p></div><button class="primary" type="submit">Zapisz szkic kampanii</button></section>
    <div class="builder-footer"><button type="button" class="secondary" data-builder="prev">Wstecz</button><span id="builder-stage-count">Krok 1 z 4</span><button type="button" class="primary" data-builder="next">Zapisz i przejdź dalej →</button></div>
  </form><section class="builder-preview"><div class="builder-pitch-visual" aria-hidden="true"><div class="cradle"><i></i><i></i><i></i><i></i><i></i></div></div><div class="preview-heading"><span class="section-label">PODGLĄD DLA ODBIORCY</span><span class="badge gray">Szkic</span></div><label for="preview-contact">Kontakt</label><select id="preview-contact">${builderPreviewContactOptions(contacts)}</select><label for="preview-step">Krok sekwencji</label><select id="preview-step"><option value="0">Pierwsza wiadomość</option></select><button class="secondary" data-builder="preview">↻ Odśwież podgląd</button><div id="builder-preview-content"><div class="preview-art"><span>✉</span></div><h2>Dobry kontekst.<br>Lepsza rozmowa.</h2><p>Uzupełnij ofertę i sekwencję, aby zobaczyć wiadomość dla konkretnej osoby.</p></div><p class="hint">Podgląd personalizuje szablon. Generowanie przez AI, jeśli podłączone, następuje podczas przygotowania wiadomości.</p></section></div>`;
  mountManualInteractionBuilder();
  bindSellingPoints($('#campaign-form'));bindWebsiteActions($('#campaign-form'));
  addStep();decorateBuilderSteps();
  if(editing){const c=editing.campaign;restoreBuilder({...c,steps:editing.steps,contact_ids:JSON.parse(c.contact_ids),material_ids:JSON.parse(c.material_ids),audience_tags:JSON.parse(c.audience_tags),conditions:JSON.parse(c.conditions)});showBuilderEditing()}
  try{const draft=JSON.parse(localStorage.getItem(builderDraftKey())||'null');if(draft&&(!editing||draft.revision===editing.campaign.revision))restoreBuilder(draft)}catch{}
  $('#campaign-form').oninput=()=>{persistBuilder();updateRecipientHint();renderSequenceMap();$('#builder-campaign-title').textContent=$('#build-name').value||'Nowa kampania'};
  $('#campaign-form').addEventListener('focusin',e=>{const row=e.target.closest('#steps .step');if(row){builderSelectedStep=[...document.querySelectorAll('#steps .step')].indexOf(row);renderSequenceMap()}});
  $('#campaign-form').addEventListener('invalid',e=>{const section=e.target.closest('[data-stage]');if(section)showBuilderStage(Number(section.dataset.stage))},true);
  $('#build-mode').onchange=()=>{updateRecipientHint();persistBuilder()};
  $('#builder-target-tags').onchange=()=>{updateRecipientHint();persistBuilder()};
  $('#build-material-mode').onchange=()=>{renderBuilderMaterials();persistBuilder()};
  $('#build-channel').addEventListener('change',()=>{renderBuilderMaterials();persistBuilder()});
  $('#company-url').onchange=()=>{renderBuilderMaterials();persistBuilder()};
  $('#build-language').dataset.previousLanguage=$('#build-language').value;
  $('#build-language').onchange=changeBuilderLanguage;
  $('#build-language-reset').onclick=()=>{
   const select=$('#build-language'),language=projectMessageLanguage();
   if(select.value===language)return;
   select.value=language;
   changeBuilderLanguage();
  };
  const form=$('#campaign-form');
  form.dataset.projectId=String(editing?.campaign.project_id??state.seller_project.id);
  if(!editing&&!form.elements.offer_draft_key.value)form.elements.offer_draft_key.value=crypto.randomUUID();
  bindOfferSources(form,true);
  bindTextRefinement(form.elements.offer,()=>form.elements.language.value,
   'Oferta dopracowana przez AI. Sprawdź ją przed przygotowaniem wiadomości.');
  const saveButton=$('[data-builder=save-draft]');
  const launchButton=$('[data-builder=launch]');
  const prepareButton=form.querySelector('button[type=submit]');
  saveButton.setAttribute('form',form.id);
  saveButton.type='submit';
  saveButton.textContent=translateUiText('Zapisz kampanię');
  prepareButton.textContent=translateUiText('Przygotuj wiadomości');
  let saving=false;
  form.onsubmit=e=>{
   e.preventDefault();
   if(saving)return;
   if(form.offerSourcesBusy()){toast('Poczekaj na zakończenie pracy ze źródłami oferty.');return}
   const prepare=builderStep===3&&e.submitter===prepareButton;
   if(hasUnappliedManualScenario()){
    if(builderStep!==3)showBuilderStage(3);
    $('#manual-scenario-title').focus();
    toast('Najpierw zastosuj zmiany scenariusza lub anuluj edycję.');
    return;
   }
   saving=true;
   const headerButton=$('[data-builder=header-next]');
   const buttons=[saveButton,prepareButton,headerButton,launchButton];
   buttons.forEach(button=>button.disabled=true);
   form.inert=true;
   run(null,async()=>{
    try{
     const data=builderData(),edited=builderEditing?.campaign,draftKey=builderDraftKey();
     data.offer_sources=JSON.parse(data.offer_sources||'[]');
     data.project_id=Number(form.dataset.projectId);
     const result=await api(edited?'campaign/update':'campaigns',edited?{...data,id:edited.id,project_id:edited.project_id,revision:edited.revision}:data);
     if(edited&&monitoringSimulation){const runs=fetchedSimulation().deliveryRuns;if(runs?.[edited.id]){delete runs[edited.id];saveSimulationResults()}}
     if(!form.isConnected||view!=='builder')return;
     try{localStorage.removeItem(draftKey)}catch{}
     if(edited){
      edited.revision=result.revision;
      edited.status=result.status;
      edited.channel=data.channel;
      builderEditing.has_queued_messages=result.has_queued_messages;
      updateBuilderLaunchButton();
     }else{
      builderEditing={campaign:{id:result.id,project_id:result.project_id,revision:result.revision},selected_contacts:[]};
      showBuilderEditing();
      renderBuilderMaterials();
     }
     await refresh();
     if(!prepare){
      toast('Zapisano kampanię.');
      return;
     }
     if(!form.isConnected||view!=='builder'||state.seller_project.id!==data.project_id)return;
     toast(translateUiText('Przygotowuję wiadomości. Przy użyciu AI może to potrwać kilka minut.'));
     try{await api('campaign/prepare',{id:result.id})}
     catch(error){throw Error(translateUiText('Kampania została zapisana. Przygotowanie wiadomości:')+' '+error.message)}
     if(!form.isConnected||view!=='builder'||state.seller_project.id!==data.project_id)return;
     const workspace=campaignWorkspace(result.id);
     workspace.tab='messages';
     workspace.awaitReview=false;
     try{sessionStorage.removeItem(campaignReviewKey(workspace))}catch{}
     builderEditing=null;view='campaigns';selectedCampaign=result.id;
     await refresh();
     toast(translateUiText('Wiadomości gotowe do sprawdzenia'));
    }finally{
     saving=false;form.inert=false;buttons.forEach(button=>button.disabled=false);
    }
   });
  };
  launchButton.onclick=()=>void run(launchButton,async()=>{
   if(!builderEditing?.has_queued_messages)return;
   const {id,channel}=builderEditing.campaign;
   await showCampaignPreflight(id,'start',{onStart:()=>{
    if(!form.isConnected||view!=='builder')return;
    persistBuilder();
    campaignWorkspace(id).tab=!monitoringSimulation&&channel==='manual'?'manual-queue':'messages';
    builderEditing=null;view='campaigns';selectedCampaign=id;
   }});
  });
  $('#builder-campaign-title').textContent=$('#build-name').value||'Nowa kampania';
  updateRecipientHint();renderBuilderMaterials();showBuilderStage(0);
}

async function assistantPitch(mode){
  if(builderAssistantBusy)throw Error('Trwa już operacja. Zaczekaj na zakończenie.');
  showBuilderStage(1);
  const form=$('#campaign-form'),url=$('#company-url'),website=normalizeWebsite(url.value),language=$('#build-language').value;
  if(!website){url.focus();$('#builder-help').textContent='Wpisz stronę firmy i ponownie wybierz sposób tworzenia oferty.';return}
  builderAssistantBusy=true;
  url.value=website;
  const buttons=[...document.querySelectorAll('.assistant-shortcuts button')];buttons.forEach(button=>button.disabled=true);
  $('#builder-help').textContent=mode==='stories'?'Czytam historie sukcesu i przygotowuję ofertę…':'Czytam stronę i przygotowuję ofertę…';
  let proof='',sources=[],offer='';
  try{
    if(mode==='stories'){
      if(!state.integrations.ai)throw Error('Podłącz OpenAI w Integracjach, aby skorzystać z historii sukcesu.');
      const evidence=await api('ai/proof-points',{website,stories_only:true});
      if(!evidence.proof_points)throw Error('W odczytanych historiach nie znaleziono konkretnych dowodów.');
      proof=evidence.proof_points;sources=[...new Set(evidence.sources.map(source=>source.url))];
      const result=await api('ai/refine',{field:'offer',text:proof,language});offer=result.text;
    }else{
      const result=await api('research',{url:website,language});offer=result.offer;sources=[result.source];
    }
    if(!form.isConnected||$('#campaign-form')!==form)return;
    $('#modal-content').innerHTML=`<h2>Sprawdź propozycję oferty</h2><p>Twoja obecna oferta zmieni się dopiero po zastosowaniu propozycji.</p><form id="assistant-pitch-form"><label for="assistant-pitch-text">Oferta</label><textarea id="assistant-pitch-text" name="offer" rows="8" maxlength="10000" required>${esc(offer)}</textarea>${proof?`<label for="assistant-pitch-proof">Proof points</label><textarea id="assistant-pitch-proof" name="proof_points" rows="5" readonly>${esc(proof)}</textarea>`:''}<div class="proof-sources">${sources.map(source=>`<p><a href="${esc(source)}" target="_blank" rel="noopener noreferrer">${esc(source)}</a></p>`).join('')}</div><p class="hint">Sprawdź fakty przed wysyłką. Wyniki opisane w case study nie są gwarancją dla kolejnego klienta.</p><button class="primary">Zastosuj ofertę</button></form>`;
    $('#modal').showModal();$('#builder-help').textContent='Oferta gotowa do sprawdzenia.';
    $('#assistant-pitch-form').onsubmit=event=>{event.preventDefault();
      if(!form.isConnected||$('#campaign-form')!==form){$('#modal').close();return}
      $('#build-offer').value=$('#assistant-pitch-text').value;
      form.refreshOfferSources();
      if(proof){form.elements.proof_points.value=proof;form.querySelector('[data-point-editor="proof_points"]').refreshPoints()}
      const status=$('#research-status');status.replaceChildren();
      const label=document.createElement('span');label.textContent='Źródła oferty: ';status.append(label);
      for(const source of sources){const link=document.createElement('a');link.href=source;link.textContent=source;link.target='_blank';link.rel='noopener noreferrer';status.append(link,document.createTextNode(' '))}
      persistBuilder();$('#modal').close();$('#builder-help').textContent='Oferta zastosowana. Możesz dopracować ją w edytorze.';
    };
  }catch(error){if(form.isConnected)$('#builder-help').textContent='Nie udało się przygotować oferty. Twoje dane pozostają bez zmian.';throw error}
  finally{builderAssistantBusy=false;buttons.forEach(button=>button.disabled=false);if($('#campaign-form'))renderAssistantButtons()}
}

function applyProjectCampaignOffer(form,project){
 for(const field of ['website','offer','audience','pain_points','value_props','proof_points'])form.elements[field].value=project[field]||'';
 const sources=(project.offer_sources||[]).filter(source=>source==='website'?(form.elements.offer_website.value.trim()||project.website):state.offer_document_count);
 if(project.offer?.trim())sources.push('offer');
 if(JSON.parse(form.elements.offer_sources.value||'[]').includes('campaign_documents'))sources.push('campaign_documents');
 form.elements.offer_sources.value=JSON.stringify(sources);
 form.refreshOfferSources();
 restoreSellingPoints(form);
}

function importCampaignProject(){
 const form=$('#campaign-form'),project=sellerProject();
 if(!form.isConnected||Number(form.dataset.projectId)!==project.id)throw Error('Otwórz kreator w projekcie tej kampanii.');
 applyProjectCampaignOffer(form,project);
 renderBuilderMaterials();updateRecipientHint();persistBuilder();
 $('#research-status').textContent=translateUiText('Dane zaimportowane z projektu. Możesz je zmienić dla tej kampanii.');
 toast(translateUiText('Dane zaimportowane z projektu. Możesz je zmienić dla tej kampanii.'));
}

function builderData(){
 const f=$('#campaign-form');const data=Object.fromEntries(new FormData(f));
 try{data.website=normalizeWebsite(data.website)}catch{}
 data.contact_ids=[...f.querySelectorAll('[name=contact_ids]:checked')].map(e=>Number(e.value));
 data.audience_tags=[...f.querySelectorAll('[name=audience_tags]:checked')].map(e=>e.value);
 data.material_ids=[...f.querySelectorAll('[name=material_ids]:checked')].map(e=>Number(e.value));
 data.conditions=builderConditions;data.assistant_note=$('#assistant-step-note')?.value||'';
 if(builderEditing)data.revision=builderEditing.campaign.revision;
 data.steps=[...f.querySelectorAll('.step')].map(s=>({delay_days:Number(s.querySelector('[name=delay]').value),subject:s.querySelector('[name=subject]').value,body:s.querySelector('[name=body]').value}));
 return data;
}
function persistBuilder(){syncWebsiteActions($('#campaign-form'));try{localStorage.setItem(builderDraftKey(),JSON.stringify(builderData()))}catch{}}
function restoreBuilder(draft){
 if(Array.isArray(draft.conditions))builderConditions=draft.conditions;
 const f=$('#campaign-form');if(draft.audience_mode==='group')draft={...draft,audience_mode:'tags',audience_tags:contactTags(draft.target_group)};for(const [key,value] of Object.entries(draft)){const el=f.elements[key];if(el&&typeof value==='string'&&'value'in el)el.value=value}
 for(const el of f.querySelectorAll('[name=audience_tags]'))el.checked=(draft.audience_tags||[]).includes(el.value);
 for(const el of f.querySelectorAll('[name=contact_ids]'))el.checked=(draft.contact_ids||[]).includes(Number(el.value));
 if(draft.steps?.length){$('#steps').innerHTML='';for(const step of draft.steps.slice(0,6)){addStep();const row=$('#steps').lastElementChild;row.querySelector('[name=delay]').value=step.delay_days;row.querySelector('[name=subject]').value=step.subject;row.querySelector('[name=body]').value=step.body}decorateBuilderSteps()}
 renderAssistantButtons();if($('#assistant-step-note'))$('#assistant-step-note').value=draft.assistant_note||'';
 restoreSellingPoints(f);
 renderBuilderMaterials(draft.material_ids||[]);
}
function renderBuilderMaterials(selected){
 const root=$('#builder-material-list'),form=$('#campaign-form');
 if(!root)return;
 const modeField=form.elements.material_mode,attachment=form.elements.attachment_ref;
 const documents=Object.entries(form.attachmentDocuments||{}).flatMap(([scope,rows])=>
  rows.filter(row=>row.attachable).map(row=>({...row,scope,reference:scope+':'+row.digest})));
 const available=form.elements.channel.value==='email',option=modeField.querySelector('[value=document]');
 option.disabled=!available;
 form.querySelector('#builder-attachment-channel-hint').hidden=available;
 form.querySelector('#builder-attachment-upload').hidden=!available||modeField.value!=='document';
 if(!available&&modeField.value==='document')modeField.value='none';
 if(modeField.value==='document'){
  root.innerHTML=`<div class="builder-materials">
   <label for="builder-attachment">Dokument do wysłania</label>
   <select id="builder-attachment" required>
    <option value="">${documents.length?'Wybierz dokument…':'Dodaj plik poniżej'}</option>
    ${documents.map(row=>`<option value="${esc(row.reference)}" data-no-translate ${attachment.value===row.reference?'selected':''}>${esc(row.name)} · ${esc(translateUiText(row.scope==='project'?'Dokument projektu':'Dokument kampanii'))}</option>`).join('')}
   </select>
   <div data-builder-attachment-link></div>
   <p class="hint">Załącznik trafi do pierwszego e-maila każdego odbiorcy.</p>
  </div>`;
  const showLink=()=>{
   const document=documents.find(row=>row.reference===attachment.value);
   const scope={project_id:Number(form.dataset.projectId)};
   if(document?.scope==='campaign'){
    if(builderEditing)scope.campaign_id=builderEditing.campaign.id;
    else scope.draft_key=form.elements.offer_draft_key.value;
   }
   root.querySelector('[data-builder-attachment-link]').innerHTML=document?offerDocumentLink(document.name,{...scope,id:document.id}):'';
  };
  root.querySelector('select').onchange=event=>{attachment.value=event.target.value;showLink();persistBuilder()};
  showLink();
  syncLanguages();
  return;
 }
 selected=selected||[...document.querySelectorAll('[name=material_ids]:checked')].map(e=>Number(e.value));
 const mode=$('#build-material-mode').value,rows=companyMaterials($('#company-url').value).filter(m=>m.enabled);
 root.innerHTML=mode==='none'?'':`<div class="builder-materials">${rows.map(m=>`<label class="check"><input type="checkbox" name="material_ids" value="${m.id}" ${selected.includes(m.id)?'checked':''} ${mode==='auto'?'disabled':''}><span><strong>${esc(m.title)}</strong><small>${esc(m.url)}</small></span></label>`).join('')||'<p class="hint">Brak materiałów tej firmy. Kliknij „Pobierz ofertę i materiały” albo dodaj podstronę w Bibliotece.</p>'}</div>`;
}
function selectedCampaignTags(){return [...document.querySelectorAll('[name=audience_tags]:checked')].map(input=>input.value)}
function campaignContactMatchesTags(contact,tags,match){const own=contactTags(contact).map(tag=>tag.toLocaleLowerCase()),wanted=tags.map(tag=>tag.toLocaleLowerCase());return !!wanted.length&&(match==='all'?wanted.every(tag=>own.includes(tag)):wanted.some(tag=>own.includes(tag)))}
function builderPreviewContactOptions(contacts){
 if(!contacts.length)return '<option value="">'+translateUiText('Brak aktywnych kontaktów')+'</option>';
 const normalize=value=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase();
 const labels=contacts.map(contact=>{
  const name=(contact.name||'').trim(),company=(contact.company||'').trim();
  return name&&company&&normalize(name)!==normalize(company)?name+' · '+company:name||company||contact.email;
 });
 const counts=new Map();
 for(const label of labels){
  const key=normalize(label);
  counts.set(key,(counts.get(key)||0)+1);
 }
 return contacts.map((contact,index)=>{
  const label=labels[index];
  const text=counts.get(normalize(label))>1&&contact.email?label+' · '+contact.email:label;
  return `<option value="${contact.id}" data-no-translate>${esc(text)}</option>`;
 }).join('');
}
function updateRecipientHint(){
 if(!$('#build-mode'))return;
 const mode=$('#build-mode').value,tags=selectedCampaignTags(),match=$('#build-tag-match').value;
 $('#builder-target-tags').hidden=mode!=='tags';
 $('#builder-target-tags').querySelectorAll('input,select').forEach(input=>input.disabled=mode!=='tags');
 $('#build-mode').setCustomValidity(mode==='tags'&&!tags.length?translateUiText('Wybierz co najmniej jeden tag odbiorców.'):'');
 $('#builder-recipients').hidden=mode!=='selected';
 const selected=new Set([...document.querySelectorAll('[name=contact_ids]:checked')].map(input=>Number(input.value)));
 const contacts=builderContacts().filter(c=>c.status==='active'&&!c.simulated&&(mode!=='tags'||campaignContactMatchesTags(c,tags,match))&&(mode!=='selected'||selected.has(c.id)));
 const count=$('#builder-recipient-hint [data-recipient-count]');
 if(count.textContent!==String(contacts.length))count.textContent=contacts.length;
 const preview=$('#preview-contact'),previous=preview.value;
 preview.innerHTML=builderPreviewContactOptions(contacts);
 if(contacts.some(c=>String(c.id)===previous))preview.value=previous;
}
function decorateBuilderSteps(){
 const steps=[...document.querySelectorAll('#steps .step')];
 steps.forEach((s,i)=>{s.querySelector('h3').textContent=`✉ Email · krok ${i+1}`;if(!s.querySelector('[data-builder=remove-step]'))s.insertAdjacentHTML('beforeend','<button type="button" class="link" data-builder="remove-step">Usuń krok</button>')});
 steps.forEach(step=>{if(!step.querySelector('[data-builder=step-preview]'))step.querySelector('[data-builder=remove-step]').insertAdjacentHTML('beforebegin','<button type="button" class="secondary step-preview-button" data-builder="step-preview">Podgląd</button>')});
 if(builderEditing?.protected_position!==null&&builderEditing?.protected_position!==undefined)steps.forEach((step,index)=>{if(index<=builderEditing.protected_position){step.querySelectorAll('input,textarea,[data-builder=remove-step]').forEach(input=>input.disabled=true);step.dataset.sentStep='true'}});
 renderSequenceMap();
 const value=$('#preview-step')?.value||0;if($('#preview-step')){$('#preview-step').innerHTML=steps.map((_,i)=>`<option value="${i}">Wiadomość ${i+1}</option>`).join('');$('#preview-step').value=Math.min(Number(value),steps.length-1)}
}
async function previewBuilderStep(step){
 const form=$('#campaign-form'),projectId=state.seller_project.id,index=[...form.querySelectorAll('.step')].indexOf(step);
 if(index<0)return;
 const data=builderData(),selected=new Set(data.contact_ids),manual=data.channel==='manual';
 const options=[...$('#preview-contact').options].filter(option=>option.value&&(data.audience_mode!=='selected'||selected.has(Number(option.value))));
 const scenarios=manual&&!hasManualScenarioInEditor()?manualScenarioDrafts:[];
 const simulationControls=manual?`<section id="manual-send-simulation">
  ${scenarios.length>1?`<label for="manual-simulation-scenario">Scenariusz</label><select id="manual-simulation-scenario">${scenarios.map((scenario,i)=>`<option value="${i}" data-no-translate>${esc(scenario.domain)}</option>`).join('')}</select>`:''}
  <button type="button" class="secondary" data-step-preview-simulate disabled>${manualSendSimulationLabel}</button>
  </section>`:'';
 $('#modal-content').innerHTML=`<section data-step-preview><h2><span>Podgląd wiadomości</span> · ${index+1}</h2><label for="step-preview-contact">Kontakt</label><select id="step-preview-contact">${options.map(option=>`<option value="${esc(option.value)}" ${option.value===$('#preview-contact').value?'selected':''} data-no-translate>${esc(option.textContent)}</option>`).join('')}</select><button type="button" class="secondary" data-step-preview-refresh>Odśwież podgląd</button><p class="hint" data-step-preview-status role="status"></p><div data-step-preview-message></div>${simulationControls}</section>`;
 $('#modal').showModal();
 const host=$('[data-step-preview]'),contact=host.querySelector('select'),status=host.querySelector('[data-step-preview-status]'),message=host.querySelector('[data-step-preview-message]');
 const refreshButton=host.querySelector('[data-step-preview-refresh]'),simulateButton=host.querySelector('[data-step-preview-simulate]');
 const scenarioPicker=host.querySelector('#manual-simulation-scenario');
 let request=0,preview=null,sendingSimulation=false;
 if(!options.length){contact.disabled=true;refreshButton.disabled=true;status.textContent=translateUiText('Brak aktywnych kontaktów');return}
 const sendSimulation=async()=>{
  if(!preview||sendingSimulation)return;
  sendingSimulation=true;
  simulateButton.disabled=true;
  try{
   const scenario=hasManualScenarioInEditor()?readManualScenarioForm():scenarios[Number(scenarioPicker?.value??0)];
   if(!scenario)throw Error('Dodaj scenariusz w ustawieniach kampanii.');
   await sendManualSendSimulation(scenario,preview.recipient,preview.body,preview.variables);
   toast('Rozszerzenie uruchomiło symulację.');
  }catch(error){toast(error.message)}
  finally{sendingSimulation=false;simulateButton.disabled=!preview}
 };
 if(simulateButton)simulateButton.onclick=sendSimulation;
 const load=async()=>{
  const token=++request;status.textContent=translateUiText('Wczytuję podgląd…');message.replaceChildren();
  preview=null;
  if(simulateButton)simulateButton.disabled=true;
  try{
   if(!step.isConnected||$('#campaign-form')!==form||state.seller_project.id!==projectId)return;
   const current=builderData(),position=[...form.querySelectorAll('.step')].indexOf(step),recipient=builderContacts().find(item=>String(item.id)===contact.value);
   const result=await api('campaign/preview',{...current,preview_contact_id:contact.value,preview_step:position});
   if(!host.isConnected||!$('#modal').open||request!==token)return;
   status.textContent='';
   message.innerHTML=`<div class="mail-preview"><div><span>Temat</span><strong data-no-translate>${esc(result.subject)}</strong></div><p data-no-translate>${esc(result.body)}</p></div>${result.material?`<div class="preview-material"><strong data-no-translate>${esc(result.material.title)}</strong><small data-no-translate>${esc(result.material.url)}</small></div>`:''}`;
   if(recipient){preview={recipient,body:result.body,variables:result.manual_variables};if(simulateButton)simulateButton.disabled=sendingSimulation}
   syncLanguages();
  }catch(error){if(host.isConnected&&request===token)status.textContent=error.message}
 };
 contact.onchange=load;refreshButton.onclick=event=>run(event.currentTarget,load);await load();
}
function updateBuilderLaunchButton(){
 const campaign=builderEditing?.campaign;
 const button=$('[data-builder=launch]');
 button.hidden=builderStep!==3||!builderEditing?.has_queued_messages||
  (campaign.status==='active'&&(monitoringSimulation||campaign.channel==='email'));
}

function showBuilderStage(stage){
 builderStep=Math.max(0,Math.min(3,stage));renderAssistantButtons();renderSequenceMap();$('.builder-preview').dataset.stageIndex=builderStep;document.querySelectorAll('[data-stage]').forEach(s=>s.hidden=Number(s.dataset.stage)!==builderStep);
 $('.builder-preview').hidden=builderStep<2;$('.builder-layout').dataset.stageIndex=builderStep;
 document.querySelectorAll('[data-builder-step]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.builderStep)===builderStep);b.setAttribute('aria-current',Number(b.dataset.builderStep)===builderStep?'step':'false')});
 $('#builder-stage-count').textContent=`Krok ${builderStep+1} z 4`;document.querySelector('[data-builder=prev]').disabled=builderStep===0;document.querySelector('[data-builder=next]').hidden=builderStep===3;
 document.querySelector('[data-builder=header-next]').textContent=translateUiText(builderStep===3?'Przygotuj wiadomości':'Zapisz i przejdź dalej');
 updateBuilderLaunchButton();
 $('#builder-help').textContent=['Wybierz osoby, do których pasuje oferta. Każda kampania ma własną listę odbiorców.','Strona firmy może być źródłem oferty, argumentów i materiałów. Sprawdź pobraną treść przed wysyłką.','Zaplanuj pierwszy kontakt i kolejne wiadomości. Po prawej sprawdzisz wynik dla wybranego odbiorcy.','Zapisz kampanię lub przygotuj wiadomości. Gdy wiadomości są gotowe, możesz uruchomić kampanię z tego ekranu.'][builderStep];
 if(builderStep===3){const d=builderData();$('#builder-summary').innerHTML=`<dl class="builder-summary"><dt>Kampania</dt><dd>${esc(d.name)||'Brak nazwy'}</dd><dt>Strona nadawcy</dt><dd>${esc(d.website)||'Oferta wpisana ręcznie'}</dd><dt>Odbiorcy</dt><dd>${d.audience_mode==='tags'?esc(translateUiText('Tagi')+': '+d.audience_tags.join('; ')+' · '+translateUiText(d.tag_match==='all'?'Wszystkie wybrane tagi (I)':'Dowolny z wybranych tagów (LUB)')):d.audience_mode==='selected'?d.contact_ids.length+' wybranych kontaktów':'Wszystkie aktywne kontakty'}</dd><dt>Sekwencja</dt><dd>${d.steps.length} wiadomości · dni ${d.steps.map(s=>s.delay_days).join(', ')}</dd><dt>Materiały</dt><dd>${{none:'Bez materiałów',auto:'Dobór według kontekstu',manual:'Ręczny wybór',document:esc($('#builder-attachment')?.selectedOptions[0]?.textContent||translateUiText('Dokument do wysłania'))}[d.material_mode]}</dd></dl>`}
}

function renderLibrary(){
 $('#content').innerHTML=renderTop('Biblioteka firmy','Oferta i materiały z dowolnej strony. Każda domena ma własny zestaw.',`<button class="primary" data-library="import">+ Dodaj stronę firmy</button>`)+`<section class="panel"><h2>Projekty firm</h2>${state.library.projects.map(p=>`<article class="signal-card"><div class="panel-head"><strong>${esc(p.name)}</strong><span class="badge gray">${new URL(p.website).hostname}</span></div><p>${esc(p.offer)}</p><p class="hint">${esc(p.website)} · odczyt ${date(p.updated)}</p></article>`).join('')||empty('Zacznij od własnej strony','Nie ma domyślnych klientów ani materiałów. Podaj domenę firmy, dla której przygotowujesz kampanię.')}</section><section class="panel"><div class="panel-head"><h2>Materiały do wiadomości</h2><button class="secondary" data-library="add">+ Dodaj podstronę</button></div>${state.library.materials.map(m=>`<article class="signal-card"><div class="panel-head"><strong>${esc(m.title)}</strong><span class="badge ${m.enabled?'':'gray'}">${m.enabled?'Dostępny':'Wyłączony'}</span></div><p>${esc(m.summary)}</p><p class="hint">${esc(m.website)} · ${esc(m.kind)}</p><div class="actions"><a class="link" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">Otwórz materiał ↗</a><button class="link" data-library="toggle" ${m.simulated?'disabled':''} data-id="${m.id}" data-enabled="${m.enabled?0:1}">${m.enabled?'Wyłącz':'Włącz'}</button></div></article>`).join('')||empty('Artykuły, usługi, case studies','Pobierz treści firmy albo dodaj konkretną podstronę. Wiadomości zawierają linki do istniejących materiałów.')}</section>`;
}

document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.builderStep!==undefined){showBuilderStage(Number(b.dataset.builderStep));return}
 const action=b.dataset.builder;
 if(action==='save-draft')return;
 if(action==='header-next'&&builderStep===3){
  const form=$('#campaign-form');form.requestSubmit(form.querySelector('button[type=submit]'));return;
 }
 if(action)run(b,async()=>{
  if(action==='exit'){persistBuilder();selectedCampaign=builderEditing?.campaign.id||null;builderEditing=null;view='campaigns';render()}
  if(action==='next'||action==='header-next')showBuilderStage(builderStep+1);
  if(action==='prev')showBuilderStage(builderStep-1);
  if(action==='import-project')importCampaignProject();
  if(action==='step-preview')await previewBuilderStep(b.closest('.step'));
  if(action==='manual-simulation'){
   const position=Number($('#preview-step').value),contactId=$('#preview-contact').value;
   const fromEditor=hasManualScenarioInEditor();
   if(!fromEditor&&manualScenarioDrafts.length>1){await previewBuilderStep($('#steps').children[position]);return}
   const scenario=fromEditor?readManualScenarioForm():manualScenarioDrafts[0];
   if(!scenario)throw Error('Dodaj scenariusz w ustawieniach kampanii.');
   const recipient=builderContacts().find(item=>String(item.id)===contactId);
   if(!recipient)throw Error('Dodaj aktywny kontakt do podglądu');
   const result=await api('campaign/preview',{...builderData(),preview_contact_id:contactId,preview_step:position});
   await sendManualSendSimulation(scenario,recipient,result.body,result.manual_variables);
   toast('Rozszerzenie uruchomiło symulację.');
  }
  if(action==='website-shortcut')await assistantPitch('website');
  if(action==='materials-shortcut')await assistantPitch('stories');
  if(action==='preview-shortcut'){showBuilderStage(2);$('#preview-contact').focus()}
  if(action==='add-step'){addStep();decorateBuilderSteps();persistBuilder()}
  if(action==='remove-step'){const steps=[...document.querySelectorAll('#steps .step')];if(steps.length===1)throw Error('Sekwencja musi mieć co najmniej jeden krok');const index=steps.indexOf(b.closest('.step'));for(const condition of builderConditions)if(condition.before_step>index)condition.before_step--;sequenceInsertAt=null;b.closest('.step').remove();decorateBuilderSteps();persistBuilder()}
  if(action==='discover'){const website=$('#company-url').value;if(!website)throw Error('Podaj stronę firmy');$('#research-status').textContent='Odczytuję stronę i podstrony…';const result=await api('library/discover',{website});$('#company-url').value=result.website;$('#build-offer').value=result.offer;$('#campaign-form').refreshOfferSources();await refresh();renderBuilderMaterials();$('#research-status').textContent=`Odczytano ${result.added} stron. Nieudane odczyty: ${result.errors.length}. Sprawdź ofertę i materiały przed wysyłką.`;persistBuilder()}
  if(action==='improve-step')await assistantStep('improve');
  if(action==='first-touch')await assistantStep('first_touch');
  if(action==='preview'){const d=builderData();d.preview_contact_id=$('#preview-contact').value;d.preview_step=Number($('#preview-step').value);if(!d.preview_contact_id)throw Error('Dodaj aktywny kontakt do podglądu');const r=await api('campaign/preview',d);$('#builder-preview-content').innerHTML=`<div class="mail-preview"><div><span>Temat</span><strong>${esc(r.subject)}</strong></div><p>${esc(r.body)}</p></div>${r.material?`<div class="preview-material"><span class="section-label">WYBRANY MATERIAŁ</span><strong>${esc(r.material.title)}</strong><small>${esc(r.material.url)}</small></div>`:'<p class="hint">Bez dodatkowego materiału dla tego kontaktu.</p>'}`}
 });
 const lib=b.dataset.library;if(lib)run(b,async()=>{
  if(lib==='toggle'){await api('library/status',{id:Number(b.dataset.id),enabled:b.dataset.enabled==='1'});await refresh()}
  if(lib==='import'||lib==='add'){modal(`<h2>${lib==='import'?'Dodaj stronę firmy':'Dodaj podstronę do biblioteki'}</h2><form id="library-form"><label for="lib-website">Strona firmy</label><input id="lib-website" name="website" type="text" inputmode="url" autocapitalize="none" spellcheck="false" required placeholder="firma.pl">${lib==='add'?'<label for="lib-url">Artykuł, usługa lub case study w tej domenie</label><input id="lib-url" name="url" type="text" inputmode="url" autocapitalize="none" spellcheck="false" required>':''}<p class="hint">Pobieramy wyłącznie publiczny HTML. Nie zmieniamy strony ani nie wysyłamy wiadomości.</p><button class="primary">${lib==='import'?'Pobierz ofertę i materiały':'Dodaj materiał'}</button></form>`);$('#library-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{const r=await api(lib==='import'?'library/discover':'library/add',Object.fromEntries(new FormData(e.target)));$('#modal').close();await refresh();toast(lib==='import'?`Odczytano ${r.added} stron. Błędy: ${r.errors.length}.`:'Materiał dodany')})}}
 });
});
