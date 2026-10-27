const sellerFields=['name','website','offer','audience','pain_points','value_props','proof_points'];
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
 if(first){try{let cached=JSON.parse(localStorage.getItem(sellerDraftKey(incoming.id))||'null');if(!cached&&incoming.id===1)cached=JSON.parse(localStorage.getItem('kaska-seller-draft')||'null');if(cached?.revision===incoming.revision){for(const field of sellerFields)if(typeof cached.fields?.[field]==='string')sellerPending[field]=cached.fields[field];if(Object.keys(sellerPending).length)sellerSaveTimer=setTimeout(()=>flushSellerProfile().catch(e=>toast(e.message)),450)}}catch{}}
}
function sellerProfile(){syncSellerProfile();return {...(sellerBase||{}),...sellerPending}}
function sellerSaveStatus(text){document.querySelectorAll('[data-seller-save-status]').forEach(el=>el.textContent=translateUiText(text))}
function updateSellerProfile(form){
 if(sellerSwitchBusy||(form.dataset.sellerProfileId&&Number(form.dataset.sellerProfileId)!==state.seller_profile?.id))return;
 const current=sellerProfile();let changed=false;
 for(const field of sellerFields){const input=form.elements[field];if(input&&input.value!==(current[field]||'')){sellerPending[field]=input.value;changed=true}}
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
     for(const field of Object.keys(patch))if(sellerPending[field]===patch[field])delete sellerPending[field];
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
 for(const field of sellerFields)if(form.elements[field])form.elements[field].value=profile[field]||'';
 restoreSellingPoints(form);
 form.addEventListener('input',()=>updateSellerProfile(form));
 form.addEventListener('change',()=>updateSellerProfile(form));
 form.addEventListener('focusout',()=>queueMicrotask(()=>{if(form.isConnected)updateSellerProfile(form)}));
 if(!form.querySelector('[data-seller-save-status]'))form.insertAdjacentHTML('afterbegin','<p class="hint">Oferta, problemy i wartości są wspólne dla Discover i Znajdź klientów.</p><p class="hint" role="status" data-seller-save-status></p>');
}
function sharedProfilePanel(){
 const profile=sellerProfile();
 return `<details class="panel" id="discover-profile" ${profile.offer?'':'open'}><summary><strong>Profil</strong> · <span data-no-translate>${esc(profile.website||profile.name||'')}</span></summary><form id="seller-profile-form"><label for="seller-name">Nazwa profilu</label><input id="seller-name" name="name" required maxlength="100"><input id="prospect-language" type="hidden" value="${esc(state.preferences.message_language)}"><label for="prospect-website">Strona firmy, w imieniu której piszesz</label><input id="prospect-website" name="website" type="text" placeholder="firma.pl" maxlength="2000"><label for="prospect-offer">Oferta</label><textarea id="prospect-offer" name="offer" maxlength="10000" rows="4"></textarea>${refineControls('offer')}${sellingPointsSection('prospect')}<label for="prospect-audience">Opis firm, których szukasz</label><textarea id="prospect-audience" name="audience" maxlength="3000" rows="3"></textarea>${refineControls('audience')}<button class="secondary">Zapisz profil</button></form></details>`;
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
}
async function chooseSellerProfile(path,item){
 if(sellerSwitchBusy)return;
 const currentForm=$('#prospect-form')||$('#seller-profile-form');if(currentForm)updateSellerProfile(currentForm);
 sellerSwitchBusy=true;renderProfilePicker();
 document.querySelectorAll('[data-seller-profile-id]').forEach(form=>form.inert=true);
 try{
   await flushSellerProfile();const profile=await api(path,item);
   if(typeof discoverReview!=='undefined'){discoverReview.stop=true;discoverReview={running:false,stop:false,completed:0,total:0}}
   clearTimeout(sellerSaveTimer);sellerPending={};sellerBase=null;state.seller_profile=profile;
   prospectRunId=null;prospectSelected.clear();signalFilter.monitor=null;
   if(view==='builder')view='discover';
   $('#content').replaceChildren();await refresh();
 }finally{sellerSwitchBusy=false;document.querySelectorAll('[data-seller-profile-id]').forEach(form=>form.inert=false);renderProfilePicker()}
}
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
