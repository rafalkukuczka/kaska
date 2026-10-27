const sellerFields=['name','website','offer','audience','pain_points','value_props','proof_points','search_languages'];
let sellerBase=null,sellerPending={},sellerSaving=null,sellerSaveTimer;
let sellerSwitchBusy=false;
const sellerDraftKey=id=>'kaska-seller-draft-'+id;
function cacheSellerDraft(){try{const key=sellerDraftKey(sellerBase?.id);if(Object.keys(sellerPending).length)localStorage.setItem(key,JSON.stringify({revision:sellerBase?.revision,fields:sellerPending}));else localStorage.removeItem(key)}catch{}}
function syncSellerProfile(){
 const incoming=state.seller_profile;if(!incoming)return;
 const switched=sellerBase&&incoming.id!==sellerBase.id;
 if(switched){cacheSellerDraft();sellerPending={};clearTimeout(sellerSaveTimer);$('#content')?.replaceChildren();if(typeof discoverReview!=='undefined')discoverReview.stop=true}
 const first=!sellerBase||switched;
 if(first||incoming.revision>=sellerBase.revision)sellerBase=incoming;
 if(first){try{let cached=JSON.parse(localStorage.getItem(sellerDraftKey(incoming.id))||'null');if(!cached&&incoming.id===1)cached=JSON.parse(localStorage.getItem('kaska-seller-draft')||'null');if(cached?.revision===incoming.revision){for(const field of sellerFields)if(typeof cached.fields?.[field]==='string'||(field==='search_languages'&&Array.isArray(cached.fields?.[field])))sellerPending[field]=cached.fields[field];if(Object.keys(sellerPending).length)sellerSaveTimer=setTimeout(()=>flushSellerProfile().catch(e=>toast(e.message)),450)}}catch{}}
}
function sellerProfile(){syncSellerProfile();return {...(sellerBase||{}),...sellerPending}}
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
function updateSellerProfile(form){
 if(sellerSwitchBusy||(form.dataset.sellerProfileId&&Number(form.dataset.sellerProfileId)!==state.seller_profile?.id))return;
 const current=sellerProfile();let changed=false;
 for(const field of sellerFields){const input=form.elements[field];if(!input)continue;const value=field==='search_languages'?readSearchLanguages(form):input.value;if(JSON.stringify(value)!==JSON.stringify(current[field]??(field==='search_languages'?[]:''))){sellerPending[field]=value;changed=true}}
 if(!changed)return;
 cacheSellerDraft();
 sellerSaveStatus('Zapisywanie profilu…');clearTimeout(sellerSaveTimer);
 sellerSaveTimer=setTimeout(()=>flushSellerProfile().catch(error=>{sellerSaveStatus('Nie zapisano zmian. Spróbuj ponownie.');toast(error.message)}),450);
}
function flushSellerProfile(){
 clearTimeout(sellerSaveTimer);
 if(sellerSaving)return sellerSaving;
 sellerSaving=(async()=>{
   while(Object.keys(sellerPending).length){
     const patch={...sellerPending},base=sellerProfile();
     const result=await api('seller-profile',{...patch,profile_id:base.id,revision:base.revision});
     if(sellerBase?.id!==result.id)break;
     sellerBase=result;state.seller_profile=result;
     for(const field of Object.keys(patch))if(JSON.stringify(sellerPending[field])===JSON.stringify(patch[field]))delete sellerPending[field];
     cacheSellerDraft();
   }
   sellerSaveStatus('Profil zapisany.');
   renderProfilePicker();
   if(view==='discover')renderDiscoverCompanies();
 })().catch(error=>{sellerSaveStatus('Nie zapisano zmian. Spróbuj ponownie.');throw error}).finally(()=>{sellerSaving=null});
 return sellerSaving;
}
function bindSharedProfile(form){
 const profile=sellerProfile();
 form.dataset.sellerProfileId=String(profile.id);
 for(const field of sellerFields)if(form.elements[field])form.elements[field].value=field==='search_languages'?JSON.stringify(profile[field]||[]):profile[field]||'';
 restoreSellingPoints(form);bindSearchLanguages(form);
 form.addEventListener('input',()=>updateSellerProfile(form));
 form.addEventListener('change',()=>updateSellerProfile(form));
 form.addEventListener('focusout',()=>queueMicrotask(()=>{if(form.isConnected)updateSellerProfile(form)}));
 if(!form.querySelector('[data-seller-save-status]'))form.insertAdjacentHTML('afterbegin','<p class="hint">Oferta, problemy i wartości są wspólne dla Discover i Znajdź klientów.</p><p class="hint" role="status" data-seller-save-status></p>');
}
function sharedProfilePanel(){
 const profile=sellerProfile();
 return `<details class="panel" id="discover-profile" ${profile.offer?'':'open'}><summary><strong>Profil</strong> · <span data-no-translate>${esc(profile.website||profile.name||'')}</span></summary><form id="seller-profile-form"><label for="seller-name">Nazwa profilu</label><input id="seller-name" name="name" required maxlength="100"><input id="prospect-language" type="hidden" value="${esc(state.preferences.message_language)}"><label for="prospect-website">Strona firmy, w imieniu której piszesz</label><input id="prospect-website" name="website" type="text" placeholder="firma.pl" maxlength="2000"><label for="prospect-offer">Oferta</label><textarea id="prospect-offer" name="offer" maxlength="10000" rows="4"></textarea>${refineControls('offer')}${sellingPointsSection('prospect')}<label for="prospect-audience">Opis firm, których szukasz</label><textarea id="prospect-audience" name="audience" maxlength="3000" rows="3"></textarea>${refineControls('audience')}${searchLanguagesPicker()}<button class="secondary">Zapisz profil</button></form></details>`;
}
function bindDiscoverProfile(){
 const form=$('#seller-profile-form');bindSellingPoints(form);bindSharedProfile(form);bindRefineControls();
 form.onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{updateSellerProfile(form);await flushSellerProfile();toast('Profil zapisany.')})};
}
function editSellerProfile(){view='discover';render();$('#discover-profile').open=true;$('#prospect-offer').focus();$('#discover-profile').scrollIntoView({behavior:'smooth',block:'start'})}

function renderProfilePicker(){
 const select=$('#active-profile');if(!select||!state?.seller_profile)return;
 const profile=sellerProfile();
 select.innerHTML=(state.seller_profiles||[]).map(row=>`<option value="${row.id}" data-no-translate>${esc(row.id===profile.id?profile.name:row.name)}</option>`).join('');
 select.value=String(profile.id);select.disabled=sellerSwitchBusy;
 $('#new-seller-profile').disabled=sellerSwitchBusy;
 $('#delete-seller-profile').disabled=sellerSwitchBusy;
}
async function chooseSellerProfile(path,item,signal){
 if(sellerSwitchBusy)return;
 const deleting=path==='seller-profiles/delete',discarded=deleting?{...sellerPending}:null;
 const currentForm=$('#prospect-form')||$('#seller-profile-form');if(currentForm&&!deleting)updateSellerProfile(currentForm);
 if(deleting){clearTimeout(sellerSaveTimer);sellerPending={}}
 sellerSwitchBusy=true;renderProfilePicker();
 document.querySelectorAll('[data-seller-profile-id]').forEach(form=>form.inert=true);
 try{
   if(deleting){if(sellerSaving)await sellerSaving.catch(()=>{})}else await flushSellerProfile();
   const profile=await api(path,item,signal);
   if(deleting){try{localStorage.removeItem(sellerDraftKey(item.profile_id));if(item.profile_id===1)localStorage.removeItem('kaska-seller-draft')}catch{}}
   if(typeof discoverReview!=='undefined'){discoverReview.stop=true;discoverReview={running:false,stop:false,completed:0,total:0}}
   clearTimeout(sellerSaveTimer);sellerPending={};sellerBase=null;state.seller_profile=profile;
   prospectRunId=null;prospectSelected.clear();signalFilter.monitor=null;
   if(view==='builder')view='discover';
   $('#content').replaceChildren();await refresh();
 }catch(error){if(deleting&&sellerBase?.id===item.profile_id){sellerPending={...discarded,...sellerPending};cacheSellerDraft()}throw error}
 finally{sellerSwitchBusy=false;document.querySelectorAll('[data-seller-profile-id]').forEach(form=>form.inert=false);renderProfilePicker()}
}

function deleteSellerProfileForm(){
 const profile=sellerProfile(),last=(state.seller_profiles||[]).length===1;
 modal(`<h2>Usunąć profil?</h2><p data-no-translate><strong>${esc(profile.name)}</strong></p><p>Profil zniknie z listy, a jego monitoringi zostaną zatrzymane. Kontakty i dotychczasowe kampanie pozostaną zachowane.</p>${last?'<p class="hint">To ostatni profil. Po usunięciu utworzymy nowy pusty profil.</p>':''}<p class="hint" role="status" data-profile-delete-status></p><div class="actions"><button type="button" class="secondary close">Anuluj</button><button type="button" class="primary danger" data-profile-delete-confirm>Usuń profil</button></div>`);
 $('[data-profile-delete-confirm]').onclick=e=>run(e.currentTarget,async()=>{
   const status=$('[data-profile-delete-status]'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   status.textContent=translateUiText('Usuwam profil…');
   try{await chooseSellerProfile('seller-profiles/delete',{profile_id:profile.id},controller.signal);$('#modal').close();toast('Profil usunięty.')}
   catch(error){const message=error.name==='AbortError'?'Przekroczono czas oczekiwania. Odśwież listę profili.':error.message;if(status.isConnected)status.textContent=message;throw Error(message)}
   finally{clearTimeout(timer)}
 });
}
document.addEventListener('click',e=>{if(e.target.closest('#delete-seller-profile'))deleteSellerProfileForm()});
document.addEventListener('change',e=>{
 if(e.target.id!=='active-profile')return;
 chooseSellerProfile('seller-profiles/select',{profile_id:Number(e.target.value)}).catch(error=>{toast(error.message);renderProfilePicker()});
});
document.addEventListener('click',e=>{
 if(!e.target.closest('#new-seller-profile'))return;
 modal(`<h2>Nowy profil</h2><form id="new-seller-profile-form"><label for="new-profile-name">Nazwa profilu</label><input id="new-profile-name" name="name" required maxlength="100" placeholder="np. Moja firma"><p class="hint">Każdy profil ma własną ofertę, problemy, wartości i monitoringi Discover.</p><div class="actions"><button class="primary">Utwórz profil</button><button type="button" class="secondary close">Anuluj</button></div></form>`);
 $('#new-profile-name').focus();
 $('#new-seller-profile-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{await chooseSellerProfile('seller-profiles/create',{name:e.target.elements.name.value});$('#modal').close();toast('Utworzono profil.')})};
});
