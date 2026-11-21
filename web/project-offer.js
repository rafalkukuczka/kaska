function projectOfferPanel(){
 return `<label for="prospect-website">Strona firmy, w imieniu której piszesz</label>
  <input id="prospect-website" name="website" type="text" placeholder="firma.pl" maxlength="2000">
  <fieldset class="project-offer-sources"><legend>Źródła oferty</legend>
    <label class="check"><input type="checkbox" value="website" data-offer-source> <span>Strona firmy</span></label>
    <label class="check"><input type="checkbox" value="documents" data-offer-source> <span>Dokumenty projektu</span></label>
    <input type="hidden" name="offer_sources">
  </fieldset>
  <label for="offer-document-files">Dodaj dokumenty do oferty</label>
  <input type="file" id="offer-document-files" accept=".pdf,.docx,.txt,.md" multiple aria-describedby="offer-document-hint">
  <p class="hint" id="offer-document-hint">PDF, DOCX, TXT lub MD. Do 10 plików, maksymalnie 6 MB na plik.</p>
  <ul class="project-offer-documents" data-offer-documents></ul>
  <div class="actions"><button type="button" class="secondary" id="generate-project-offer" disabled>Przygotuj ofertę</button></div>
  <p class="hint">Przy podłączonej integracji OpenAI analizuje fragmenty wybranych źródeł.</p>
  <p class="hint" data-offer-status role="status"></p>
  <section data-offer-draft hidden>
    <label for="offer-draft-text">Propozycja oferty</label><textarea id="offer-draft-text" rows="5" readonly data-no-translate></textarea>
    <small class="hint" data-offer-used-sources></small>
    <div class="actions"><button type="button" class="secondary" data-apply-offer-draft>Zastosuj propozycję oferty</button></div>
  </section>
  <label for="prospect-offer">Oferta</label>
  <textarea id="prospect-offer" name="offer" maxlength="10000" rows="4"></textarea>
  ${refineControls('offer')}${sellingPointsSection('prospect')}`;
}

function bindProjectOffer(form){
 const panel=form.querySelector('#project-panel-offer');
 const files=panel.querySelector('#offer-document-files'), list=panel.querySelector('[data-offer-documents]');
 const status=panel.querySelector('[data-offer-status]'), generate=panel.querySelector('#generate-project-offer');
 const draft=panel.querySelector('[data-offer-draft]'), text=panel.querySelector('#offer-draft-text');
 const used=panel.querySelector('[data-offer-used-sources]'), sources=[...panel.querySelectorAll('[data-offer-source]')];
 const storage=form.elements.offer_sources, projectId=state.seller_project.id, epoch=simulationEpoch;
 const current=()=>panel.isConnected&&epoch===simulationEpoch&&state.seller_project.id===projectId;
 const selected=()=>sources.filter(input=>input.checked).map(input=>input.value);
 let documents=[],busy=false,listVersion=0;
 for(const input of sources)input.checked=JSON.parse(storage.value).includes(input.value);
 form.projectProofSources=()=>selected().filter(source=>source==='website'?form.elements.website.value.trim():documents.length);
 const controls=()=>{
  const wanted=selected();
  generate.disabled=busy||!wanted.length||(wanted.includes('website')&&!form.elements.website.value.trim())||
   (wanted.includes('documents')&&!documents.length);
  files.disabled=busy;
  for(const button of list.querySelectorAll('button'))button.disabled=busy;
  syncWebsiteActions(form);
 };
 const message=value=>{status.textContent=translateUiText(value)};
 const show=rows=>{
  listVersion++;
  documents=rows;
  state.offer_document_count=rows.length;
  list.innerHTML=rows.map(row=>`<li><span data-no-translate>${esc(row.name)}</span>
   <button type="button" class="link" data-remove-offer-document="${row.id}">Usuń</button></li>`).join('');
  controls();
 };
 const updateSources=()=>{
  storage.value=JSON.stringify(selected());
  updateSellerProject(form);
  controls();
 };
 for(const input of sources)input.addEventListener('change',updateSources);
 form.elements.website.addEventListener('input',controls);
 void (async()=>{
  const version=listVersion;
  try{
   const res=await fetch('/api/offer/documents?'+new URLSearchParams({project_id:projectId}),{cache:'no-store'});
   const data=await res.json();
   if(!res.ok)throw Error(data.error);
   if(current()&&version===listVersion)show(data.documents);
  }catch(error){if(current()&&version===listVersion)message(error.message)}
 })();
 async function transform(action){
  if(!current()||busy)return;
  busy=true;controls();
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
    const result=await api('offer/documents',{project_id:projectId,name:file.name,content});
    if(!current())return;
    show(result.documents);
    sources.find(input=>input.value==='documents').checked=true;
    if(!form.elements.website.value.trim())sources.find(input=>input.value==='website').checked=false;
    updateSources();
   }
   message('Dokumenty gotowe do analizy.');
  });
 };
 list.onclick=event=>{
  const button=event.target.closest('[data-remove-offer-document]');
  if(!button)return;
  void transform(async()=>{
   const data=await api('offer/documents/remove',{project_id:projectId,id:Number(button.dataset.removeOfferDocument)});
   if(current()){show(data.documents);draft.hidden=true;message('Usunięto dokument.')}
  });
 };
 generate.onclick=()=>void transform(async()=>{
  const selection=selected(),website=selection.includes('website')?normalizeWebsite(form.elements.website.value):'';
  const language=projectMessageLanguage();
  draft.hidden=true;
  message('Przygotowuję ofertę z wybranych źródeł…');
  const result=await api('offer/generate',{project_id:projectId,sources:selection,website,language,existing_offer:form.elements.offer.value});
  if(!current())return;
  text.value=result.offer;draft.hidden=false;
  used.textContent=[result.website,...result.documents].filter(Boolean).join(' · ');
  message(result.website_simulated?'W symulacji strona nie jest pobierana. Sprawdź dostępny tekst.':
   result.ai?'Oferta gotowa do sprawdzenia.':'Zebrano fragmenty źródeł. Sprawdź i dopracuj ofertę.');
 });
 panel.querySelector('[data-apply-offer-draft]').onclick=()=>{
  if(!current()||!text.value.trim())return;
  form.elements.offer.value=text.value;
  form.elements.offer.dispatchEvent(new Event('input',{bubbles:true}));
  draft.hidden=true;message('Zastosowano propozycję oferty.');
 };
 controls();
}
