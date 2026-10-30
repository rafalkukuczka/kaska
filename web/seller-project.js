const sellerFields=['name','website','offer','audience','pain_points','value_props','proof_points','search_languages','search_areas','signal_interests'];
let sellerBase=null,sellerPending={},sellerSaving=null,sellerSaveTimer;
let sellerSwitchBusy=false;
const sellerDraftKey=id=>'kaska-seller-draft-'+id;
function cacheSellerDraft(){try{const key=sellerDraftKey(sellerBase?.id);if(Object.keys(sellerPending).length)localStorage.setItem(key,JSON.stringify({revision:sellerBase?.revision,fields:sellerPending}));else localStorage.removeItem(key)}catch{}}
function syncSellerProject(){
 const incoming=state.seller_project;if(!incoming)return;
 if(!sellerBase){try{const legacy=localStorage.getItem('campaign-builder-draft');if(legacy!==null){const key='campaign-builder-draft:'+incoming.id;if(localStorage.getItem(key)===null)localStorage.setItem(key,legacy);localStorage.removeItem('campaign-builder-draft')}}catch{}}
 const switched=sellerBase&&incoming.id!==sellerBase.id;
 if(switched){cacheSellerDraft();sellerPending={};clearTimeout(sellerSaveTimer);$('#content')?.replaceChildren();}
 const first=!sellerBase||switched;
 if(first||incoming.revision>=sellerBase.revision)sellerBase=incoming;
 if(first){try{let cached=JSON.parse(localStorage.getItem(sellerDraftKey(incoming.id))||'null');if(!cached&&incoming.id===1)cached=JSON.parse(localStorage.getItem('kaska-seller-draft')||'null');if(cached?.revision===incoming.revision){for(const field of sellerFields)if(typeof cached.fields?.[field]==='string'||(['search_languages','search_areas','signal_interests'].includes(field)&&Array.isArray(cached.fields?.[field])))sellerPending[field]=cached.fields[field];if(Object.keys(sellerPending).length)sellerSaveTimer=setTimeout(()=>flushSellerProject().catch(e=>toast(e.message)),450)}}catch{}}
}
function sellerProject(){syncSellerProject();return {...(sellerBase||{}),...sellerPending}}
function searchLanguagesPicker(){return `<details class="search-language-picker" data-search-language-picker><summary><strong>Szukaj w językach</strong><span data-search-languages-summary></span></summary><fieldset><legend>Języki rozmowy</legend>${Object.entries(state.languages).map(([code,language])=>`<label class="check"><input type="checkbox" name="search_language" value="${code}"><span data-no-translate>${esc(language.label)}</span></label>`).join('')}</fieldset><p class="hint">Brak zaznaczeń oznacza dowolny język. To preferowane języki kontaktu, niezależne od języka wiadomości. Język rozmowy z firmą wymaga potwierdzenia.</p><button class="link" type="button" data-search-languages-clear>Odznacz wszystkie języki</button></details><input type="hidden" name="search_languages" value="[]">`}
function readSearchLanguages(form){try{const value=JSON.parse(form.elements.search_languages?.value||'[]');return Array.isArray(value)?value:[]}catch{return []}}
function searchLanguagesLabel(value){try{const codes=Array.isArray(value)?value:JSON.parse(value||'[]');return codes.length?codes.map(code=>state.languages[code]?.label||code).join(', '):translateUiText('Dowolny język')}catch{return translateUiText('Dowolny język')}}
function bindSearchLanguages(form){
 const picker=form.querySelector('[data-search-language-picker]');if(!picker)return;
 const selected=readSearchLanguages(form),storage=form.elements.search_languages;
 picker.querySelectorAll('[name=search_language]').forEach(input=>input.checked=selected.includes(input.value));
 const label=()=>picker.querySelector('[data-search-languages-summary]').textContent=searchLanguagesLabel(storage.value);
 const update=()=>{storage.value=JSON.stringify([...picker.querySelectorAll('[name=search_language]:checked')].map(input=>input.value));label();storage.dispatchEvent(new Event('input',{bubbles:true}))};
 picker.querySelectorAll('[name=search_language]').forEach(input=>input.onchange=update);
 picker.querySelector('[data-search-languages-clear]').onclick=()=>{picker.querySelectorAll('[name=search_language]').forEach(input=>input.checked=false);update()};label();
}
function sellerSaveStatus(text){document.querySelectorAll('[data-seller-save-status]').forEach(el=>el.textContent=translateUiText(text))}
function updateSellerProject(form){
 if(sellerSwitchBusy||(form.dataset.sellerProjectId&&Number(form.dataset.sellerProjectId)!==state.seller_project?.id))return;
 const current=sellerProject();let changed=false;
 for(const field of sellerFields){const input=form.elements[field];if(!input)continue;const value=field==='signal_interests'?JSON.parse(input.value||'[]'):field==='search_languages'?readSearchLanguages(form):field==='search_areas'?readSearchAreas(form):input.value;if(JSON.stringify(value)!==JSON.stringify(current[field]??(['search_languages','search_areas','signal_interests'].includes(field)?[]:''))){sellerPending[field]=value;changed=true}}
 if(!changed)return;
 cacheSellerDraft();
 sellerSaveStatus('Zapisywanie projektu…');clearTimeout(sellerSaveTimer);
 sellerSaveTimer=setTimeout(()=>flushSellerProject().catch(error=>{sellerSaveStatus('Nie zapisano zmian. Spróbuj ponownie.');toast(error.message)}),450);
}
function flushSellerProject(){
 clearTimeout(sellerSaveTimer);
 if(sellerSaving)return sellerSaving;
 sellerSaving=(async()=>{
   while(Object.keys(sellerPending).length){
     const patch={...sellerPending},base=sellerProject();
     const result=await api('seller-project',{...patch,project_id:base.id,revision:base.revision});
     if(sellerBase?.id!==result.id)break;
     sellerBase=result;state.seller_project=result;
     for(const field of Object.keys(patch))if(JSON.stringify(sellerPending[field])===JSON.stringify(patch[field]))delete sellerPending[field];
     cacheSellerDraft();
   }
   sellerSaveStatus('Projekt zapisany.');
   renderProjectPicker();
   if(view==='discover')renderDiscoverCompanies();
 })().catch(error=>{sellerSaveStatus('Nie zapisano zmian. Spróbuj ponownie.');throw error}).finally(()=>{sellerSaving=null});
 return sellerSaving;
}
function bindSharedProject(form){
 const project=sellerProject();
 form.dataset.sellerProjectId=String(project.id);
 for(const field of sellerFields)if(form.elements[field])form.elements[field].value=['search_languages','search_areas','signal_interests'].includes(field)?JSON.stringify(project[field]||[]):project[field]||'';
 restoreSellingPoints(form);bindProjectInterests(form);bindSearchLanguages(form);bindSearchMap(form);bindWebsiteActions(form);syncWebsiteActions(form);
 form.addEventListener('input',()=>updateSellerProject(form));
 form.addEventListener('change',()=>updateSellerProject(form));
 form.addEventListener('focusout',()=>queueMicrotask(()=>{if(form.isConnected)updateSellerProject(form)}));
 if(!form.querySelector('[data-seller-save-status]'))form.insertAdjacentHTML('afterbegin','<p class="hint" role="status" data-seller-save-status></p>');
}
function projectContextLink(){
 const project=sellerProject();
 return `<div class="project-context"><span><span>Bieżący projekt:</span> <strong data-no-translate>${esc(project.name)}</strong></span><button type="button" class="link" data-view="project">Edytuj projekt →</button></div>`;
}
function renderSellerProject(){
 if($('#seller-project-form'))return;
 $('#content').innerHTML=renderTop('Projekt','Oferta i kryteria odbiorców wspólne dla odkrywania firm i pozyskiwania leadów.')+`<p class="hint">${esc(translateUiText(sellerProject().share_contacts?'Kontakty: współdzielone':'Kontakty: tylko w tym projekcie'))}</p>`+sharedProjectPanel();
 $('#discover-project').open=true;
 bindDiscoverProject();
}
function projectInterestCatalog(){
 const groups=new Map();for(const item of state.project_catalog||[]){if(!groups.has(item.category))groups.set(item.category,[]);groups.get(item.category).push(item)}
 return `<details class="project-interest-catalog"><summary><strong>Katalog sygnałów</strong> · <span data-interest-count>0</span></summary><p class="hint">Wybierz zdarzenia, których Kaśka ma szukać po kliknięciu „Znajdź okazje” w Odkrywaj.</p><input type="hidden" name="signal_interests" value="[]"><div class="project-interest-groups">${[...groups].map(([category,items])=>`<fieldset><legend>${esc(category)}</legend>${items.map(item=>`<label class="check"><input type="checkbox" data-project-interest value="${esc(item.key)}"><span>${esc(item.label)}</span></label>`).join('')}</fieldset>`).join('')}</div></details>`;
}
function bindProjectInterests(form){
 const panel=form.querySelector('.project-interest-catalog');if(!panel)return;
 const storage=form.elements.signal_interests,selected=JSON.parse(storage.value||'[]');
 panel.querySelectorAll('[data-project-interest]').forEach(input=>input.checked=selected.includes(input.value));
 const count=()=>panel.querySelector('[data-interest-count]').textContent=panel.querySelectorAll('[data-project-interest]:checked').length;
 panel.querySelectorAll('[data-project-interest]').forEach(input=>input.onchange=()=>{storage.value=JSON.stringify([...panel.querySelectorAll('[data-project-interest]:checked')].map(input=>input.value));count();storage.dispatchEvent(new Event('input',{bubbles:true}))});count();
}
function sharedProjectPanel(){
 const project=sellerProject();
 return `<details class="panel" id="discover-project" ${project.offer?'':'open'}><summary><strong>Projekt</strong> · <span data-no-translate>${esc(project.website||project.name||'')}</span></summary><form id="seller-project-form"><label for="seller-name">Nazwa projektu</label><input id="seller-name" name="name" required maxlength="100"><input id="prospect-language" type="hidden" value="${esc(state.preferences.message_language)}"><label for="prospect-website">Strona firmy, w imieniu której piszesz</label><input id="prospect-website" name="website" type="text" placeholder="firma.pl" maxlength="2000"><label for="prospect-offer">Oferta</label><textarea id="prospect-offer" name="offer" maxlength="10000" rows="4"></textarea>${refineControls('offer')}${sellingPointsSection('prospect')}<label for="prospect-audience">Opis firm, których szukasz</label><textarea id="prospect-audience" name="audience" maxlength="3000" rows="3"></textarea><div class="audience-ai-tools">${refineControls('audience')}${audienceSuggestionControls()}</div>${searchMapControls()}${searchLanguagesPicker()}${projectInterestCatalog()}<button class="secondary">Zapisz projekt</button></form></details>`;
}
function bindDiscoverProject(){
 const form=$('#seller-project-form');bindSellingPoints(form);bindSharedProject(form);bindRefineControls();
 form.onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{updateSellerProject(form);await flushSellerProject();toast('Projekt zapisany.')})};
}
function editSellerProject(){view='project';render();$('#discover-project').open=true;$('#prospect-offer').focus()}

function renderProjectPicker(){
 const select=$('#active-project');if(!select||!state?.seller_project)return;
 const project=sellerProject();
 select.innerHTML=(state.seller_projects||[]).map(row=>`<option value="${row.id}" data-no-translate>${esc(row.id===project.id?project.name:row.name)}</option>`).join('');
 select.value=String(project.id);select.disabled=sellerSwitchBusy;
 $('#new-seller-project').disabled=sellerSwitchBusy;
 $('#delete-seller-project').disabled=sellerSwitchBusy;
}
async function chooseSellerProject(path,item,signal){
 if(sellerSwitchBusy)return;
 const deleting=path==='seller-projects/delete',discarded=deleting?{...sellerPending}:null;
 const currentForm=$('#seller-project-form');if(currentForm&&!deleting)updateSellerProject(currentForm);
 if(deleting){clearTimeout(sellerSaveTimer);sellerPending={}}
 sellerSwitchBusy=true;renderProjectPicker();
 document.querySelectorAll('[data-seller-project-id]').forEach(form=>form.inert=true);
 try{
   if(deleting){if(sellerSaving)await sellerSaving.catch(()=>{})}else await flushSellerProject();
   const project=await api(path,item,signal);
   if(deleting){try{localStorage.removeItem(sellerDraftKey(item.project_id));if(item.project_id===1)localStorage.removeItem('kaska-seller-draft')}catch{}}

   clearTimeout(sellerSaveTimer);sellerPending={};sellerBase=null;state.seller_project=project;
   prospectRunId=null;prospectSelected.clear();selectedCampaign=null;contactBulkSelected.clear();
   if(view==='builder')view='discover';
   $('#content').replaceChildren();await refresh();
 }catch(error){if(deleting&&sellerBase?.id===item.project_id){sellerPending={...discarded,...sellerPending};cacheSellerDraft()}throw error}
 finally{sellerSwitchBusy=false;document.querySelectorAll('[data-seller-project-id]').forEach(form=>form.inert=false);renderProjectPicker()}
}

function deleteSellerProjectForm(){
 const project=sellerProject(),last=(state.seller_projects||[]).length===1;
 modal(`<h2>Usunąć projekt?</h2><p data-no-translate><strong>${esc(project.name)}</strong></p><p>Projekt zniknie z listy. Jego aktywne kampanie zostaną wstrzymane. Historia pozostanie zachowana.</p>${last?'<p class="hint">To ostatni projekt. Po usunięciu utworzymy nowy pusty projekt.</p>':''}<p class="hint" role="status" data-project-delete-status></p><div class="actions"><button type="button" class="secondary close">Anuluj</button><button type="button" class="primary danger" data-project-delete-confirm>Usuń projekt</button></div>`);
 $('[data-project-delete-confirm]').onclick=e=>run(e.currentTarget,async()=>{
   const status=$('[data-project-delete-status]'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   status.textContent=translateUiText('Usuwam projekt…');
   try{await chooseSellerProject('seller-projects/delete',{project_id:project.id},controller.signal);$('#modal').close();toast('Projekt usunięty.')}
   catch(error){const message=error.name==='AbortError'?'Przekroczono czas oczekiwania. Odśwież listę projektów.':error.message;if(status.isConnected)status.textContent=message;throw Error(message)}
   finally{clearTimeout(timer)}
 });
}
document.addEventListener('click',e=>{if(e.target.closest('#delete-seller-project'))deleteSellerProjectForm()});
document.addEventListener('change',e=>{
 if(e.target.id!=='active-project')return;
 chooseSellerProject('seller-projects/select',{project_id:Number(e.target.value)}).catch(error=>{toast(error.message);renderProjectPicker()});
});
document.addEventListener('click',e=>{
 if(!e.target.closest('#new-seller-project'))return;
 modal(`<h2>Nowy projekt</h2><form id="new-seller-project-form"><label for="new-project-name">Nazwa projektu</label><input id="new-project-name" name="name" required maxlength="100" placeholder="np. Moja firma"><label class="check"><input type="checkbox" name="share_contacts"> <span>Współdziel kontakty</span></label><p class="hint">Zaznacz, aby korzystać ze wspólnej puli kontaktów. Bez zaznaczenia projekt ma własne kontakty. Kampanie zawsze należą do jednego projektu.</p><div class="actions"><button class="primary">Utwórz projekt</button><button type="button" class="secondary close">Anuluj</button></div></form>`);
 $('#new-project-name').focus();
 $('#new-seller-project-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{await chooseSellerProject('seller-projects/create',{name:e.target.elements.name.value,share_contacts:e.target.elements.share_contacts.checked});$('#modal').close();editSellerProject();toast('Utworzono projekt.')})};
});
