const sellerFields=['website','offer','audience','pain_points','value_props','proof_points'];
let sellerBase=null,sellerPending={},sellerSaving=null,sellerSaveTimer;
function cacheSellerDraft(){try{if(Object.keys(sellerPending).length)localStorage.setItem('kaska-seller-draft',JSON.stringify({revision:sellerBase?.revision,fields:sellerPending}));else localStorage.removeItem('kaska-seller-draft')}catch{}}
function syncSellerProfile(){const incoming=state.seller_profile;if(!incoming)return;const first=!sellerBase;if(!sellerBase||incoming.revision>=sellerBase.revision)sellerBase=incoming;if(first){try{const cached=JSON.parse(localStorage.getItem('kaska-seller-draft')||'null');if(cached?.revision===incoming.revision){for(const field of sellerFields)if(typeof cached.fields?.[field]==='string')sellerPending[field]=cached.fields[field];if(Object.keys(sellerPending).length)sellerSaveTimer=setTimeout(()=>flushSellerProfile().catch(e=>toast(e.message)),450)}}catch{}}}
function sellerProfile(){syncSellerProfile();return {...(sellerBase||{}),...sellerPending}}
function sellerSaveStatus(text){document.querySelectorAll('[data-seller-save-status]').forEach(el=>el.textContent=translateUiText(text))}
function updateSellerProfile(form){
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
     const result=await api('seller-profile',{...patch,revision:base.revision});
     sellerBase=result;state.seller_profile=result;
     for(const field of Object.keys(patch))if(sellerPending[field]===patch[field])delete sellerPending[field];
     cacheSellerDraft();
   }
   sellerSaveStatus('Profil zapisany.');
   if(view==='discover')renderDiscoverCompanies();
 })().catch(error=>{sellerSaveStatus('Nie zapisano zmian. Spróbuj ponownie.');throw error}).finally(()=>{sellerSaving=null});
 return sellerSaving;
}
function bindSharedProfile(form){
 const profile=sellerProfile();
 for(const field of sellerFields)if(form.elements[field])form.elements[field].value=profile[field]||'';
 restoreSellingPoints(form);
 form.addEventListener('input',()=>updateSellerProfile(form));
 form.addEventListener('change',()=>updateSellerProfile(form));
 form.addEventListener('focusout',()=>queueMicrotask(()=>{if(form.isConnected)updateSellerProfile(form)}));
 if(!form.querySelector('[data-seller-save-status]'))form.insertAdjacentHTML('afterbegin','<p class="hint">Oferta, problemy i wartości są wspólne dla Discover i Znajdź klientów.</p><p class="hint" role="status" data-seller-save-status></p>');
}
function sharedProfilePanel(){
 const profile=sellerProfile();
 return `<details class="panel" id="discover-profile" ${profile.offer?'':'open'}><summary><strong>Profil</strong> · <span data-no-translate>${esc(profile.website||'')}</span></summary><form id="seller-profile-form"><input id="prospect-language" type="hidden" value="${esc(state.preferences.message_language)}"><label for="prospect-website">Strona firmy, w imieniu której piszesz</label><input id="prospect-website" name="website" type="text" placeholder="firma.pl" maxlength="2000"><label for="prospect-offer">Oferta</label><textarea id="prospect-offer" name="offer" maxlength="10000" rows="4"></textarea>${refineControls('offer')}${sellingPointsSection('prospect')}<label for="prospect-audience">Opis firm, których szukasz</label><textarea id="prospect-audience" name="audience" maxlength="3000" rows="3"></textarea>${refineControls('audience')}<button class="secondary">Zapisz profil</button></form></details>`;
}
function bindDiscoverProfile(){
 const form=$('#seller-profile-form');bindSellingPoints(form);bindSharedProfile(form);bindRefineControls();
 form.onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{updateSellerProfile(form);await flushSellerProfile();toast('Profil zapisany.')})};
}
function editSellerProfile(){view='discover';render();$('#discover-profile').open=true;$('#prospect-offer').focus();$('#discover-profile').scrollIntoView({behavior:'smooth',block:'start'})}
