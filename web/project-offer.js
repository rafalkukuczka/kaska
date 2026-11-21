function projectOfferPanel(){
 return `<label for="prospect-website">Strona firmy, w imieniu której piszesz</label>
  <input id="prospect-website" name="website" type="text" placeholder="firma.pl" maxlength="2000">
  ${offerSourceControls()}
  <label for="prospect-offer">Oferta</label>
  <textarea id="prospect-offer" name="offer" maxlength="10000" rows="4"></textarea>
  ${refineControls('offer')}${sellingPointsSection('prospect')}`;
}

function offerSourceControls(campaign=false){
 return `<div data-offer-controls>
  ${campaign?`<label for="campaign-offer-website">Osobna strona oferty kampanii</label>
  <input id="campaign-offer-website" name="offer_website" type="text" inputmode="url" maxlength="2000" placeholder="Użyj strony firmy wpisanej powyżej">
  <input type="hidden" name="offer_draft_key">`:''}
  <fieldset class="project-offer-sources"><legend>Źródła oferty</legend>
    ${campaign?`<label class="check"><input type="checkbox" value="offer" data-offer-source> <span>Bieżący opis oferty</span></label>`:''}
    <label class="check"><input type="checkbox" value="website" data-offer-source> <span>Strona firmy</span></label>
    <label class="check"><input type="checkbox" value="documents" data-offer-source> <span>Dokumenty projektu</span></label>
    ${campaign?`<label class="check"><input type="checkbox" value="campaign_documents" data-offer-source> <span>Dokumenty kampanii</span></label>`:''}
    <input type="hidden" name="offer_sources" value="[]">
  </fieldset>
  <label for="offer-document-files">${campaign?'Dodaj dokumenty kampanii':'Dodaj dokumenty do oferty'}</label>
  <input type="file" id="offer-document-files" accept=".pdf,.docx,.txt,.md" multiple aria-describedby="offer-document-hint">
  <p class="hint" id="offer-document-hint">PDF, DOCX, TXT lub MD. Do 10 plików, maksymalnie 6 MB na plik.</p>
  <ul class="project-offer-documents" data-offer-documents></ul>
  <div class="actions"><button type="button" class="secondary" id="${campaign?'generate-campaign-offer':'generate-project-offer'}" data-generate-offer disabled>Przygotuj ofertę</button></div>
  <p class="hint">Przy podłączonej integracji OpenAI analizuje fragmenty wybranych źródeł.</p>
  <p class="hint" data-offer-status role="status"></p>
  <section data-offer-draft hidden>
    <label for="offer-draft-text">Propozycja oferty</label><textarea id="offer-draft-text" rows="5" readonly data-no-translate></textarea>
    <small class="hint" data-offer-used-sources></small>
    <div class="actions"><button type="button" class="secondary" data-apply-offer-draft>Zastosuj propozycję oferty</button></div>
  </section></div>`;
}

function bindProjectOffer(form){
 bindOfferSources(form);
}

function bindOfferSources(form,campaign=false){
 const panel=form.querySelector('[data-offer-controls]');
 const files=panel.querySelector('#offer-document-files'), list=panel.querySelector('[data-offer-documents]');
 const status=panel.querySelector('[data-offer-status]'), generate=panel.querySelector('[data-generate-offer]');
 const draft=panel.querySelector('[data-offer-draft]'), text=panel.querySelector('#offer-draft-text');
 const used=panel.querySelector('[data-offer-used-sources]'), sources=[...panel.querySelectorAll('[data-offer-source]')];
 const storage=form.elements.offer_sources, projectId=campaign?Number(form.dataset.projectId):state.seller_project.id, epoch=simulationEpoch;
 const current=()=>panel.isConnected&&epoch===simulationEpoch&&state.seller_project.id===projectId;
 const scope=()=>({project_id:projectId,...(campaign?(builderEditing?{campaign_id:builderEditing.campaign.id}:{draft_key:form.elements.offer_draft_key.value}):{})});
 const websiteValue=()=>form.elements.offer_website?.value.trim()||form.elements.website.value.trim();
 const selected=()=>sources.filter(input=>input.checked).map(input=>input.value);
 let documents=[],busy=false,listVersion=0;
 if(campaign)form.attachmentDocuments={project:[],campaign:[]};
 const controls=()=>{
  const wanted=selected();
  generate.disabled=!!busy||!wanted.length||(wanted.includes('website')&&!websiteValue())||
   (wanted.includes('offer')&&!form.elements.offer.value.trim())||
   (wanted.includes('documents')&&!(campaign?state.offer_document_count:documents.length))||
   (wanted.includes('campaign_documents')&&!documents.length);
  files.disabled=!!busy;
  for(const button of list.querySelectorAll('button'))button.disabled=!!busy;
  syncWebsiteActions(form);
 };
 form.refreshOfferSources=()=>{
  for(const input of sources)input.checked=JSON.parse(storage.value||'[]').includes(input.value);
  controls();
 };
 if(campaign)form.offerSourcesBusy=()=>busy==='documents';
 else form.projectProofSources=()=>selected().filter(source=>source==='website'?websiteValue():documents.length);
 const message=value=>{status.textContent=translateUiText(value)};
 const show=rows=>{
  listVersion++;
  documents=rows;
  if(campaign){form.attachmentDocuments.campaign=rows;renderBuilderMaterials()}
  else state.offer_document_count=rows.length;
  list.innerHTML=rows.map(row=>`<li>${row.attachable?offerDocumentLink(row.name,{...scope(),id:row.id}):`<span data-no-translate>${esc(row.name)}</span>`}
   ${row.attachable===0?'<small class="hint">Dodaj oryginalny plik ponownie, aby użyć go jako załącznika.</small>':''}
   <button type="button" class="link" data-remove-offer-document="${row.id}">Usuń</button></li>`).join('');
  controls();
 };
 const updateSources=()=>{
  storage.value=JSON.stringify(selected());
  if(campaign)persistBuilder();else updateSellerProject(form);
  controls();
 };
 for(const input of sources)input.addEventListener('change',updateSources);
 form.elements.website.addEventListener('input',controls);
 form.elements.offer_website?.addEventListener('input',controls);
 form.elements.offer.addEventListener('input',controls);
 void (async()=>{
  const version=listVersion;
  try{
   const res=await fetch('/api/offer/documents?'+new URLSearchParams(scope()),{cache:'no-store'});
   const data=await res.json();
   if(!res.ok)throw Error(data.error);
   if(current()&&version===listVersion)show(data.documents);
  }catch(error){if(current()&&version===listVersion)message(error.message)}
 })();
 if(campaign)void (async()=>{
  try{
   const response=await fetch('/api/offer/documents?'+new URLSearchParams({project_id:projectId}),{cache:'no-store'});
   const data=await response.json();
   if(!response.ok)throw Error(data.error);
   if(current()){form.attachmentDocuments.project=data.documents;renderBuilderMaterials()}
  }catch(error){if(current())message(error.message)}
 })();
 async function transform(action,kind){
  if(!current()||busy)return;
  busy=kind;controls();
  try{await action()}
  catch(error){if(current())message(error.message)}
  finally{busy=false;if(current())controls()}
 }
 files.onchange=()=>{
  const incoming=[...files.files];files.value='';
  if(!incoming.length)return;
  void transform(async()=>{
   if(incoming.some(file=>file.size>6*1024*1024))throw Error('Dokument może mieć maksymalnie 6 MB.');
   message('Odczytuję dokumenty…');
   for(const file of incoming){
    const content=await new Promise((resolve,reject)=>{
     const reader=new FileReader();
     reader.onload=()=>resolve(String(reader.result).split(',')[1]);
     reader.onerror=()=>reject(Error('Nie udało się odczytać pliku.'));
     reader.readAsDataURL(file);
    });
    if(!current())return;
    const result=await api('offer/documents',{...scope(),name:file.name,content});
    if(!current())return;
    show(result.documents);
    sources.find(input=>input.value===(campaign?'campaign_documents':'documents')).checked=true;
    if(!websiteValue())sources.find(input=>input.value==='website').checked=false;
    updateSources();
   }
   message('Dokumenty gotowe do analizy.');
  },'documents');
 };
 list.onclick=event=>{
  const button=event.target.closest('[data-remove-offer-document]');
  if(!button)return;
  void transform(async()=>{
   const data=await api('offer/documents/remove',{...scope(),id:Number(button.dataset.removeOfferDocument)});
   if(current()){show(data.documents);draft.hidden=true;message('Usunięto dokument.')}
  },'documents');
 };
 generate.onclick=()=>void transform(async()=>{
  const selection=selected(),website=selection.includes('website')?normalizeWebsite(websiteValue()):'';
  const language=campaign?form.elements.language.value:projectMessageLanguage();
  draft.hidden=true;
  message('Przygotowuję ofertę z wybranych źródeł…');
  const context=campaign?{name:form.elements.name.value,audience:form.elements.audience.value,
   audience_tags:form.elements.audience_mode.value==='tags'?selectedCampaignTags().join('; '):''}:{};
  const result=await api('offer/generate',{...scope(),...context,sources:selection,website,language,existing_offer:form.elements.offer.value});
  if(!current())return;
  text.value=result.offer;draft.hidden=false;
  used.textContent=[selection.includes('offer')?translateUiText('Bieżący opis oferty'):'',result.website,...result.documents].filter(Boolean).join(' · ');
  message(result.website_simulated?'W symulacji strona nie jest pobierana. Sprawdź dostępny tekst.':
   result.ai?'Oferta gotowa do sprawdzenia.':'Zebrano fragmenty źródeł. Sprawdź i dopracuj ofertę.');
 },'generation');
 panel.querySelector('[data-apply-offer-draft]').onclick=()=>{
  if(!current()||!text.value.trim())return;
  form.elements.offer.value=text.value;
  form.elements.offer.dispatchEvent(new Event('input',{bubbles:true}));
  draft.hidden=true;message('Zastosowano propozycję oferty.');
 };
 form.refreshOfferSources();
}

function offerDocumentLink(name,scope){
 return `<a class="link" data-no-translate href="/api/offer/documents/file?${esc(new URLSearchParams(scope).toString())}" target="_blank" rel="noopener">${esc(name)}</a>`;
}
