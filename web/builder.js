const builderDraftKey=()=>'campaign-builder-draft:'+state.seller_project.id;
let builderStep=0;
const builderStages=['Odbiorcy','Oferta','Sekwencja','Ustawienia'];
function campaignAudience(c){if(state.signals.rules.some(r=>r.campaign_id===c.id)||c.audience_mode==='signals')return 'Odbiorcy z sygnałów sprzedażowych';if(c.audience_mode==='tags')return translateUiText('Tagi')+': '+contactTags(c.audience_tags).join('; ');if(c.audience_mode==='group')return translateUiText('Tagi')+': '+c.target_group;if(c.audience_mode==='selected')return `Wybrane kontakty (${JSON.parse(c.contact_ids).length})`;return 'Wszystkie aktywne kontakty'}
function campaignRecipientNotice(c){if(state.signals.rules.some(r=>r.campaign_id===c.id))return 'Kampania z regułą sygnałów: odbiorcy pochodzą z zaakceptowanych zdarzeń spełniających regułę. Nowe dopasowania są dołączane automatycznie.';if(c.audience_mode==='signals')return 'Ta kampania czeka na regułę sygnałów. Dodaj regułę w zakładce Sygnały; przygotowanie nie obejmie całej bazy.';if(c.audience_mode==='tags')return translateUiText('Odbiorcy według tagów:')+' '+contactTags(c.audience_tags).join('; ')+' · '+translateUiText(c.tag_match==='all'?'Wszystkie wybrane tagi (I)':'Dowolny z wybranych tagów (LUB)');if(c.audience_mode==='group')return translateUiText('Przygotowanie obejmuje aktywne kontakty należące do wybranej grupy w chwili generowania.')+' '+translateUiText('Grupa docelowa')+': '+c.target_group+'.';if(c.audience_mode==='selected')return 'Przygotowanie obejmuje wyłącznie wybrane, nadal aktywne kontakty. Lista jest zapisana w kampanii.';return 'Przygotowanie obejmuje wszystkie aktywne kontakty w bazie w chwili generowania.'}
const companyMaterials=website=>{try{return state.library.materials.filter(m=>!m.simulated&&new URL(m.website).hostname.replace(/^www\./,'')===new URL(website).hostname.replace(/^www\./,''))}catch{return []}};

function openCampaignBuilder(){
  $('#modal').close();$('#modal-content').innerHTML='';
  view='builder';builderStep=0;resetSequence();
  document.querySelectorAll('nav [data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view==='campaigns'));
  $('#breadcrumb').textContent='Przestrzeń robocza / Kreator kampanii';
  const contacts=state.contacts.filter(c=>c.status==='active'&&!c.simulated);
  $('#content').innerHTML=`<div class="builder-top"><button class="secondary" data-builder="exit">← Kampanie</button><div><span class="section-label">NOWA KAMPANIA</span><strong id="builder-campaign-title">Nowa kampania</strong></div><div class="builder-progress">${builderStages.map((s,i)=>`<button data-builder-step="${i}" ${i===0?'aria-current="step"':''}><span>${i+1}</span>${s}</button>`).join('')}</div><div class="builder-header-actions"><button class="secondary" data-builder="save-draft">Zapisz szkic</button><button class="primary" data-builder="header-next">Zapisz i przejdź dalej</button></div></div>
  <div class="builder-layout"><section class="builder-assistant"><div class="assistant-mini-toolbar"><span>↶</span><strong>Kaśka</strong><span>✧</span></div><div class="assistant-art"><img src="/assets/kaska.png" alt="Kaśka — ruda asystentka w okrągłych okularach" width="600" height="400"></div><div class="assistant-intro"><img src="/assets/kaska.png" alt="" width="32" height="32"><p>Cześć, jestem Kaśka.<br>Jak mogę Ci dziś pomóc w tworzeniu kampanii?</p></div><p id="builder-help">Zacznij od osób, z którymi chcesz porozmawiać. Możesz wybrać kontakty albo użyć sygnałów sprzedażowych.</p><div class="assistant-shortcuts"><button type="button" data-builder="website-shortcut">Stw\u00f3rz ofert\u0119 z naszej strony</button><button type="button" data-builder="materials-shortcut">Zbuduj ofert\u0119 z historii sukcesu</button></div><div class="assistant-note">Twoja kampania, krok po kroku.<br>Wiadomości sprawdzisz przed wysyłką.</div></section>
  <form id="campaign-form" class="builder-form">
    <div class="actions builder-small-actions"><button type="button" class="secondary" data-builder="import-project">Importuj z projektu</button><span class="hint" data-no-translate>${esc(sellerProject().name||'')}</span></div>
    <section data-stage="0"><span class="section-label">01 / ODBIORCY</span><h1>Z kim chcesz porozmawiać?</h1><p class="muted">Oferta i grupa docelowa są ustalane osobno dla każdej kampanii.</p><label for="build-name">Nazwa kampanii</label><input id="build-name" name="name" required placeholder="np. Wprowadzenie nowej usługi"><label for="build-audience">Opis grupy docelowej</label><input id="build-audience" name="audience" placeholder="Stanowiska, firmy, potrzeby…"><label for="build-mode">Sposób doboru odbiorców</label><select id="build-mode" name="audience_mode"><option value="tags" ${(state.contact_tags||[]).length?'selected':''}>Według tagów</option><option value="all" ${!(state.contact_tags||[]).length?'selected':''}>Wszystkie aktywne kontakty w bazie</option><option value="selected">Wybrane kontakty</option><option value="signals">Na podstawie sygnałów sprzedażowych</option></select><div id="builder-target-tags" hidden><fieldset class="campaign-tag-picker"><legend>Tagi odbiorców</legend>${(state.contact_tags||[]).map(tag=>`<label class="check"><input type="checkbox" name="audience_tags" value="${esc(tag)}"><span data-no-translate>${esc(tag)}</span></label>`).join('')||'<p class="hint">Najpierw dodaj tagi do kontaktów.</p>'}</fieldset><label for="build-tag-match">Sposób dopasowania tagów</label><select id="build-tag-match" name="tag_match"><option value="any">Dowolny z wybranych tagów (LUB)</option><option value="all">Wszystkie wybrane tagi (I)</option></select><p class="hint">Kontakt bierze udział w kampanii tylko raz, nawet gdy pasuje do kilku tagów.</p></div><div id="builder-recipients" class="recipient-picker" hidden>${contacts.map(c=>`<label class="check"><input type="checkbox" name="contact_ids" value="${c.id}"><span><strong>${esc(c.name)}</strong><small>${esc(c.company)} · ${esc(c.email)}</small></span></label>`).join('')||'<p class="hint">Najpierw dodaj kontakty w zakładce Kontakty.</p>'}</div><p id="builder-recipient-hint" class="hint"></p></section>
    <section data-stage="1" hidden><span class="section-label">02 / OFERTA</span><h1>Co wyróżnia Twoją ofertę?</h1><p class="muted">Podaj stronę dowolnej firmy albo opisz ofertę własnymi słowami.</p><label for="company-url">Strona firmy, w imieniu której piszesz</label><input id="company-url" name="website" type="text" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="firma.pl"><div class="actions builder-small-actions"><button type="button" class="secondary" data-builder="discover">↗ Pobierz ofertę i materiały</button><select id="project-picker" aria-label="Zapisany projekt firmy"><option value="">Wybierz zapisany projekt…</option>${state.library.projects.map(p=>`<option value="${esc(p.website)}">${esc(p.name)}</option>`).join('')}</select></div><p id="research-status" class="hint">Brak domyślnej firmy. Każda domena ma oddzielną bibliotekę materiałów.</p><label for="build-offer">Co oferujesz i jaką korzyść daje to klientowi?</label><textarea id="build-offer" name="offer" rows="5" required placeholder="Opisz konkretny produkt lub usługę."></textarea>${sellingPointsSection('builder')}<div class="row"><div><label for="build-language">Język wiadomości</label><select id="build-language" name="language">${messageLanguageOptions(state.preferences.message_language)}</select></div><div><label for="build-cta">Wezwanie do działania</label><input id="build-cta" name="cta" placeholder="np. Umów rozmowę"></div></div><label for="build-cta-url">Link do następnego kroku (opcjonalnie)</label><input id="build-cta-url" name="cta_url" type="url" placeholder="https://twoja-firma.pl/kontakt"><label for="build-material-mode">Materiał dla odbiorcy</label><select id="build-material-mode" name="material_mode"><option value="none">Bez dodatkowego materiału</option><option value="auto">Dobierz ze strony według kontekstu odbiorcy</option><option value="manual">Wybiorę artykuł lub case study</option></select><div id="builder-material-list"></div><p class="hint">Automatyczny dobór korzysta z podobieństwa słów w stanowisku, notatkach, grupie docelowej i sygnale. Bez dopasowania nie dodaje linku. Wybór ręczny dołącza jeden z wybranych materiałów.</p></section>
    <section data-stage="2" hidden><span class="section-label">03 / SEKWENCJA</span><h1>Każda wiadomość ma swój moment.</h1><p class="muted">Ustaw kroki, odstępy i treść. Odpowiedź lub rezygnacja zatrzyma dalszą wysyłkę.</p><div id="sequence-map" class="sequence-map"></div><div class="flow-start">○ Aktywny odbiorca z adresem email</div><div id="steps"></div><button type="button" class="secondary" data-builder="add-step">+ Dodaj follow-up</button><p class="hint">Dni liczone od uruchomienia kampanii. Zmienne: {{name}}, {{company}}, {{offer}}, {{signal_title}}, {{material_title}}, {{material_url}}, {{cta}}. Edycja szablonu nie wysyła wiadomości.</p></section>
    <section data-stage="3" hidden><span class="section-label">04 / USTAWIENIA</span><h1>Sprawdź, zanim ruszysz.</h1><p class="muted">Zapisz kampanię jako szkic, przygotuj wiadomości i sprawdź je przed uruchomieniem wysyłki.</p><div id="builder-summary"></div><div class="builder-checks"><p>✓ Zatrzymanie sekwencji po odpowiedzi i rezygnacji</p><p>✓ Limity i odstępy wysyłki w istniejącej kolejce</p><p>${state.integrations.smtp?'✓ Poczta wychodząca jest skonfigurowana':'○ Poczta wymaga podłączenia w Integracjach'}</p></div><button class="primary" type="submit">Zapisz szkic kampanii</button></section>
    <div class="builder-footer"><button type="button" class="secondary" data-builder="prev">Wstecz</button><span id="builder-stage-count">Krok 1 z 4</span><button type="button" class="primary" data-builder="next">Zapisz i przejdź dalej →</button></div>
  </form><section class="builder-preview"><div class="builder-pitch-visual" aria-hidden="true"><div class="cradle"><i></i><i></i><i></i><i></i><i></i></div></div><div class="preview-heading"><span class="section-label">PODGLĄD DLA ODBIORCY</span><span class="badge gray">Szkic</span></div><label for="preview-contact">Kontakt</label><select id="preview-contact">${contacts.map(c=>`<option value="${c.id}">${esc(c.name)} · ${esc(c.company)}</option>`).join('')||'<option value="">Brak aktywnych kontaktów</option>'}</select><label for="preview-step">Krok sekwencji</label><select id="preview-step"><option value="0">Pierwsza wiadomość</option></select><button class="secondary" data-builder="preview">↻ Odśwież podgląd</button><div id="builder-preview-content"><div class="preview-art"><span>✉</span></div><h2>Dobry kontekst.<br>Lepsza rozmowa.</h2><p>Uzupełnij ofertę i sekwencję, aby zobaczyć wiadomość dla konkretnej osoby.</p></div><p class="hint">Podgląd personalizuje szablon. Generowanie przez AI, jeśli podłączone, następuje podczas przygotowania wiadomości.</p></section></div>`;
  bindSellingPoints($('#campaign-form'));bindWebsiteActions($('#campaign-form'));
  addStep();decorateBuilderSteps();
  try{const draft=JSON.parse(localStorage.getItem(builderDraftKey())||'null');if(draft)restoreBuilder(draft)}catch{}
  $('#campaign-form').oninput=()=>{persistBuilder();updateRecipientHint();renderSequenceMap();$('#builder-campaign-title').textContent=$('#build-name').value||'Nowa kampania'};
  $('#campaign-form').addEventListener('focusin',e=>{const row=e.target.closest('#steps .step');if(row){builderSelectedStep=[...document.querySelectorAll('#steps .step')].indexOf(row);renderSequenceMap()}});
  $('#campaign-form').addEventListener('invalid',e=>{const section=e.target.closest('[data-stage]');if(section)showBuilderStage(Number(section.dataset.stage))},true);
  $('#build-mode').onchange=()=>{updateRecipientHint();persistBuilder()};
  $('#builder-target-tags').onchange=()=>{updateRecipientHint();persistBuilder()};
  $('#build-material-mode').onchange=()=>{renderBuilderMaterials();persistBuilder()};
  $('#company-url').onchange=()=>{renderBuilderMaterials();persistBuilder()};
  $('#build-language').dataset.previousLanguage=$('#build-language').value;
  $('#build-language').onchange=changeBuilderLanguage;
  $('#project-picker').onchange=e=>{const p=state.library.projects.find(p=>p.website===e.target.value);if(p){$('#company-url').value=p.website;$('#build-offer').value=p.offer;renderBuilderMaterials();persistBuilder()}};
  $('#campaign-form').onsubmit=e=>{e.preventDefault();if(builderStep!==3){showBuilderStage(builderStep+1);return}run(e.submitter,async()=>{const data=builderData();await api('campaigns',data);localStorage.removeItem(builderDraftKey());view='campaigns';selectedCampaign=null;await refresh();toast('Kampania zapisana jako szkic. Przygotuj i sprawdź wiadomości.')})};
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
      if(proof){form.elements.proof_points.value=proof;form.querySelector('[data-point-editor="proof_points"]').refreshPoints()}
      const status=$('#research-status');status.replaceChildren();
      const label=document.createElement('span');label.textContent='Źródła oferty: ';status.append(label);
      for(const source of sources){const link=document.createElement('a');link.href=source;link.textContent=source;link.target='_blank';link.rel='noopener noreferrer';status.append(link,document.createTextNode(' '))}
      persistBuilder();$('#modal').close();$('#builder-help').textContent='Oferta zastosowana. Możesz dopracować ją w edytorze.';
    };
  }catch(error){if(form.isConnected)$('#builder-help').textContent='Nie udało się przygotować oferty. Twoje dane pozostają bez zmian.';throw error}
  finally{builderAssistantBusy=false;buttons.forEach(button=>button.disabled=false);if($('#campaign-form'))renderAssistantButtons()}
}

function importCampaignProject(){
 const form=$('#campaign-form'),project=sellerProject();
 for(const field of ['website','offer','audience','pain_points','value_props','proof_points'])form.elements[field].value=project[field]||'';
 restoreSellingPoints(form);
 $('#project-picker').value='';
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
 if(!$('#builder-material-list'))return;
 selected=selected||[...document.querySelectorAll('[name=material_ids]:checked')].map(e=>Number(e.value));
 const mode=$('#build-material-mode').value,rows=companyMaterials($('#company-url').value).filter(m=>m.enabled);
 $('#builder-material-list').innerHTML=mode==='none'?'':`<div class="builder-materials">${rows.map(m=>`<label class="check"><input type="checkbox" name="material_ids" value="${m.id}" ${selected.includes(m.id)?'checked':''} ${mode==='auto'?'disabled':''}><span><strong>${esc(m.title)}</strong><small>${esc(m.url)}</small></span></label>`).join('')||'<p class="hint">Brak materiałów tej firmy. Kliknij „Pobierz ofertę i materiały” albo dodaj podstronę w Bibliotece.</p>'}</div>`;
}
function selectedCampaignTags(){return [...document.querySelectorAll('[name=audience_tags]:checked')].map(input=>input.value)}
function campaignContactMatchesTags(contact,tags,match){const own=contactTags(contact).map(tag=>tag.toLocaleLowerCase()),wanted=tags.map(tag=>tag.toLocaleLowerCase());return !!wanted.length&&(match==='all'?wanted.every(tag=>own.includes(tag)):wanted.some(tag=>own.includes(tag)))}
function updateRecipientHint(){
 if(!$('#build-mode'))return;
 const mode=$('#build-mode').value,tags=selectedCampaignTags(),match=$('#build-tag-match').value;
 $('#builder-target-tags').hidden=mode!=='tags';
 $('#builder-target-tags').querySelectorAll('input,select').forEach(input=>input.disabled=mode!=='tags');
 $('#build-mode').setCustomValidity(mode==='tags'&&!tags.length?translateUiText('Wybierz co najmniej jeden tag odbiorców.'):'');
 $('#builder-recipients').hidden=mode!=='selected';
 const contacts=state.contacts.filter(c=>c.status==='active'&&!c.simulated&&(mode!=='tags'||campaignContactMatchesTags(c,tags,match)));
 $('#builder-recipient-hint').textContent=mode==='tags'?translateUiText('Aktywne kontakty pasujące do tagów:')+' '+contacts.length:mode==='signals'?'Po zapisaniu szkicu ustaw regułę w zakładce Sygnały. Przygotowanie nie obejmie całej bazy.':mode==='selected'?`Wybrano ${document.querySelectorAll('[name=contact_ids]:checked').length} aktywnych kontaktów.`:`Do przygotowania zostaną użyte aktywne kontakty z bazy: ${contacts.length}.`;
 const preview=$('#preview-contact'),previous=preview.value;
 preview.innerHTML=contacts.map(c=>`<option value="${c.id}">${esc(c.name)} · ${esc(c.company)}</option>`).join('')||'<option value="">'+translateUiText('Brak aktywnych kontaktów')+'</option>';
 if(contacts.some(c=>String(c.id)===previous))preview.value=previous;
}
function decorateBuilderSteps(){
 const steps=[...document.querySelectorAll('#steps .step')];
 steps.forEach((s,i)=>{s.querySelector('h3').textContent=`✉ Email · krok ${i+1}`;if(!s.querySelector('[data-builder=remove-step]'))s.insertAdjacentHTML('beforeend','<button type="button" class="link" data-builder="remove-step">Usuń krok</button>')});
 renderSequenceMap();
 const value=$('#preview-step')?.value||0;if($('#preview-step')){$('#preview-step').innerHTML=steps.map((_,i)=>`<option value="${i}">Wiadomość ${i+1}</option>`).join('');$('#preview-step').value=Math.min(Number(value),steps.length-1)}
}
function showBuilderStage(stage){
 builderStep=Math.max(0,Math.min(3,stage));renderAssistantButtons();renderSequenceMap();$('.builder-preview').dataset.stageIndex=builderStep;document.querySelectorAll('[data-stage]').forEach(s=>s.hidden=Number(s.dataset.stage)!==builderStep);
 document.querySelectorAll('[data-builder-step]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.builderStep)===builderStep);b.setAttribute('aria-current',Number(b.dataset.builderStep)===builderStep?'step':'false')});
 $('#builder-stage-count').textContent=`Krok ${builderStep+1} z 4`;document.querySelector('[data-builder=prev]').disabled=builderStep===0;document.querySelector('[data-builder=next]').hidden=builderStep===3;
 document.querySelector('[data-builder=header-next]').textContent=builderStep===3?'Zapisz kampanię':'Zapisz i przejdź dalej';
 $('#builder-help').textContent=['Wybierz osoby, do których pasuje oferta. Każda kampania ma własną listę odbiorców.','Strona firmy może być źródłem oferty, argumentów i materiałów. Sprawdź pobraną treść przed wysyłką.','Zaplanuj pierwszy kontakt i kolejne wiadomości. Po prawej sprawdzisz wynik dla wybranego odbiorcy.','Zapisz szkic. Samo zapisanie nie uruchamia wysyłki; kolejkę uruchomisz w widoku kampanii.'][builderStep];
 if(builderStep===3){const d=builderData();$('#builder-summary').innerHTML=`<dl class="builder-summary"><dt>Kampania</dt><dd>${esc(d.name)||'Brak nazwy'}</dd><dt>Strona nadawcy</dt><dd>${esc(d.website)||'Oferta wpisana ręcznie'}</dd><dt>Odbiorcy</dt><dd>${d.audience_mode==='tags'?esc(translateUiText('Tagi')+': '+d.audience_tags.join('; ')+' · '+translateUiText(d.tag_match==='all'?'Wszystkie wybrane tagi (I)':'Dowolny z wybranych tagów (LUB)')):d.audience_mode==='signals'?'Reguła sygnałów do skonfigurowania':d.audience_mode==='selected'?d.contact_ids.length+' wybranych kontaktów':'Wszystkie aktywne kontakty'}</dd><dt>Sekwencja</dt><dd>${d.steps.length} wiadomości · dni ${d.steps.map(s=>s.delay_days).join(', ')}</dd><dt>Materiały</dt><dd>${{none:'Bez materiałów',auto:'Dobór według kontekstu',manual:'Ręczny wybór'}[d.material_mode]}</dd></dl>`}
}

function renderLibrary(){
 $('#content').innerHTML=renderTop('Biblioteka firmy','Oferta i materiały z dowolnej strony. Każda domena ma własny zestaw.',`<button class="primary" data-library="import">+ Dodaj stronę firmy</button>`)+`<section class="panel"><h2>Projekty firm</h2>${state.library.projects.map(p=>`<article class="signal-card"><div class="panel-head"><strong>${esc(p.name)}</strong><span class="badge gray">${new URL(p.website).hostname}</span></div><p>${esc(p.offer)}</p><p class="hint">${esc(p.website)} · odczyt ${date(p.updated)}</p></article>`).join('')||empty('Zacznij od własnej strony','Nie ma domyślnych klientów ani materiałów. Podaj domenę firmy, dla której przygotowujesz kampanię.')}</section><section class="panel"><div class="panel-head"><h2>Materiały do wiadomości</h2><button class="secondary" data-library="add">+ Dodaj podstronę</button></div>${state.library.materials.map(m=>`<article class="signal-card"><div class="panel-head"><strong>${esc(m.title)}</strong><span class="badge ${m.enabled?'':'gray'}">${m.enabled?'Dostępny':'Wyłączony'}</span></div><p>${esc(m.summary)}</p><p class="hint">${esc(m.website)} · ${esc(m.kind)}</p><div class="actions"><a class="link" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">Otwórz materiał ↗</a><button class="link" data-library="toggle" ${m.simulated?'disabled':''} data-id="${m.id}" data-enabled="${m.enabled?0:1}">${m.enabled?'Wyłącz':'Włącz'}</button></div></article>`).join('')||empty('Artykuły, usługi, case studies','Pobierz treści firmy albo dodaj konkretną podstronę. Wiadomości zawierają linki do istniejących materiałów.')}</section>`;
}

document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.builderStep!==undefined){showBuilderStage(Number(b.dataset.builderStep));return}
 const action=b.dataset.builder;if(action)run(b,async()=>{
  if(action==='exit'){persistBuilder();view='campaigns';render()}
  if(action==='next'||action==='header-next'){if(builderStep===3)$('#campaign-form').requestSubmit();else showBuilderStage(builderStep+1)}
  if(action==='save-draft'){showBuilderStage(3);$('#campaign-form').requestSubmit()}
  if(action==='prev')showBuilderStage(builderStep-1);
  if(action==='import-project')importCampaignProject();
  if(action==='website-shortcut')await assistantPitch('website');
  if(action==='materials-shortcut')await assistantPitch('stories');
  if(action==='preview-shortcut'){showBuilderStage(2);$('#preview-contact').focus()}
  if(action==='add-step'){addStep();decorateBuilderSteps();persistBuilder()}
  if(action==='remove-step'){if(document.querySelectorAll('#steps .step').length===1)throw Error('Sekwencja musi mieć co najmniej jeden krok');b.closest('.step').remove();decorateBuilderSteps();persistBuilder()}
  if(action==='discover'){const website=$('#company-url').value;if(!website)throw Error('Podaj stronę firmy');$('#research-status').textContent='Odczytuję stronę i podstrony…';const result=await api('library/discover',{website});$('#company-url').value=result.website;$('#build-offer').value=result.offer;await refresh();renderBuilderMaterials();$('#research-status').textContent=`Odczytano ${result.added} stron. Nieudane odczyty: ${result.errors.length}. Sprawdź ofertę i materiały przed wysyłką.`;persistBuilder()}
  if(action==='improve-step')await assistantStep('improve');
  if(action==='first-touch')await assistantStep('first_touch');
  if(action==='preview'){const d=builderData();d.preview_contact_id=$('#preview-contact').value;d.preview_step=Number($('#preview-step').value);if(!d.preview_contact_id)throw Error('Dodaj aktywny kontakt do podglądu');const r=await api('campaign/preview',d);$('#builder-preview-content').innerHTML=`<div class="mail-preview"><div><span>Temat</span><strong>${esc(r.subject)}</strong></div><p>${esc(r.body)}</p></div>${r.material?`<div class="preview-material"><span class="section-label">WYBRANY MATERIAŁ</span><strong>${esc(r.material.title)}</strong><small>${esc(r.material.url)}</small></div>`:'<p class="hint">Bez dodatkowego materiału dla tego kontaktu.</p>'}`}
 });
 const lib=b.dataset.library;if(lib)run(b,async()=>{
  if(lib==='toggle'){await api('library/status',{id:Number(b.dataset.id),enabled:b.dataset.enabled==='1'});await refresh()}
  if(lib==='import'||lib==='add'){modal(`<h2>${lib==='import'?'Dodaj stronę firmy':'Dodaj podstronę do biblioteki'}</h2><form id="library-form"><label for="lib-website">Strona firmy</label><input id="lib-website" name="website" type="text" inputmode="url" autocapitalize="none" spellcheck="false" required placeholder="firma.pl">${lib==='add'?'<label for="lib-url">Artykuł, usługa lub case study w tej domenie</label><input id="lib-url" name="url" type="text" inputmode="url" autocapitalize="none" spellcheck="false" required>':''}<p class="hint">Pobieramy wyłącznie publiczny HTML. Nie zmieniamy strony ani nie wysyłamy wiadomości.</p><button class="primary">${lib==='import'?'Pobierz ofertę i materiały':'Dodaj materiał'}</button></form>`);$('#library-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{const r=await api(lib==='import'?'library/discover':'library/add',Object.fromEntries(new FormData(e.target)));$('#modal').close();await refresh();toast(lib==='import'?`Odczytano ${r.added} stron. Błędy: ${r.errors.length}.`:'Materiał dodany')})}}
 });
});
