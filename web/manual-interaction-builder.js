let manualScenarioDrafts=[];
let manualScenarioEditing=-1;
const manualSendSimulationLabel='Wyślij symulację';
const defaultManualAgentMaxRequests=50;
const defaultManualAgentPageWait=120;
const maxManualAgentPageWait=Math.floor((2**31-1)/1000);

function manualScenarioDomain(value){
 const input=value.trim().toLowerCase();
 let hostname=input;
 if(/^https?:\/\//.test(input)){
  let url;
  try{url=new URL(input)}catch{throw Error('Podaj poprawną domenę strony.');}
  if(url.username||url.password)throw Error('Podaj poprawną domenę strony.');
  hostname=url.hostname;
 }
 const domain=hostname.replace(/^www\./,'');
 if(!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain)||domain.includes('..')){
  throw Error('Podaj poprawną domenę strony.');
 }
 return domain;
}

function hasManualScenarioInEditor(){
 return manualScenarioEditing>=0||Boolean($('#manual-actions')?.value.trim())||
  ($('#manual-mode')?.value==='agent'&&Boolean($('#manual-instructions')?.value.trim()));
}

function manualScenarioFieldValues(){
 return [...['domain','start-url','mode','instructions','actions','max-requests','page-wait'].map(key=>$('#manual-'+key).value),$('#manual-dry-run').checked];
}

function hasUnappliedManualScenario(){
 const editor=$('#manual-scenario-form');
 return $('#build-channel').value==='manual'&&editor&&!editor.hidden&&
  editor.dataset.initialValues!==JSON.stringify(manualScenarioFieldValues());
}

function readManualScenarioForm(){
 const domain=manualScenarioDomain($('#manual-domain').value);
 let startUrl;
 try{startUrl=new URL($('#manual-start-url').value.trim())}catch{throw Error('Podaj poprawny adres początkowy HTTPS.');}
 if(startUrl.protocol!=='https:'||startUrl.username||startUrl.password)throw Error('Podaj poprawny adres początkowy HTTPS.');
 if(startUrl.hostname.replace(/^www\./,'')!==domain)throw Error('Adres początkowy musi należeć do podanej domeny.');
 const instructions=$('#manual-instructions').value.trim();
 if(instructions.length<5)throw Error('Opisz, co ma zrobić scenariusz (minimum 5 znaków).');
 const dry_run=$('#manual-dry-run').checked;
 if($('#manual-mode').value==='agent'){
  const agent_max_requests=$('#manual-max-requests').valueAsNumber;
  if(!Number.isSafeInteger(agent_max_requests)||agent_max_requests<1)throw Error('Limit wywołań agenta musi być dodatnią liczbą całkowitą.');
  const agent_page_wait_seconds=$('#manual-page-wait').valueAsNumber;
  if(!Number.isSafeInteger(agent_page_wait_seconds)||agent_page_wait_seconds<1||agent_page_wait_seconds>maxManualAgentPageWait)throw Error('Podaj prawidłowy czas oczekiwania na stronę w pełnych sekundach.');
  return {domain,start_url:startUrl.href,instructions,mode:'agent',actions:[],dry_run,agent_max_requests,agent_page_wait_seconds};
 }
 let actions;
 try{actions=JSON.parse($('#manual-actions').value)}catch{throw Error('Podaj kroki scenariusza w poprawnym JSON.');}
 if(!Array.isArray(actions)||!actions.length)throw Error('Dodaj kroki scenariusza.');
 return {domain,start_url:startUrl.href,instructions,actions,dry_run};
}

function manualScenarioEditorActions(domain,actions){
 if(domain!=='linkedin.com')return actions;
 const includeCompany=items=>items.map(action=>{
  if(action.type==='fill'&&/search|typeahead/i.test(action.selector)&&/^\{\{(?:contact_name|name)\}\}$/.test(action.value?.trim())){
   return {...action,value:action.value.trim()+' {{company}}'};
  }
  if(action.type==='ifVisible'||action.type==='ifNotVisible'){
   return {...action,then:includeCompany(action.then||[]),else:includeCompany(action.else||[])};
  }
  return action;
 });
 return includeCompany(actions);
}

function sendManualSendSimulation(scenario,contact,body,variables){
 const origin=location.origin,id=crypto.randomUUID();
 const simulation={
  scenario,
  contact:{name:contact.name??'',email:contact.email??'',company:contact.company??'',role:contact.role??''},
  body,variables,csrf:scenario.mode==='agent'?state.csrf:undefined
 };
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive)};
  const receive=event=>{
   if(event.source!==window||event.origin!==origin||event.data?.type!=='KATIE_MANUAL_SIMULATION_RESPONSE'||event.data.id!==id)return;
   cleanup();
   if(event.data.response?.ok===true)resolve();
   else reject(Error(event.data.response?.error||'Rozszerzenie nie przyjęło symulacji.'));
  };
  const timer=setTimeout(()=>{
   cleanup();
   reject(Error('Brak odpowiedzi z rozszerzenia Kaśka Outreach. Sprawdź, czy jest włączone, i odśwież kartę Kaśki.'));
  },5000);
  window.addEventListener('message',receive);
  window.postMessage({type:'KATIE_MANUAL_SIMULATION_REQUEST',id,simulation},origin);
 });
}

function mountManualInteractionBuilder(){
 const form=$('#campaign-form');if(!form||form.dataset.manualMounted)return;
 form.dataset.manualMounted='true';
 const channel=$('#build-channel');
 const variableNames=state.manual_interaction_variables||['contact_name','email','company','role','message','username','password'];
 const knownVariables=new Set(variableNames);
 const option=document.createElement('option');option.value='manual';option.textContent='Manual interaction · rozszerzenie Katie Outreach';channel.append(option);
 const previewButton=document.createElement('button');
 previewButton.type='button';previewButton.className='secondary';previewButton.dataset.builder='manual-simulation';
 previewButton.textContent=manualSendSimulationLabel;
 document.querySelector('.builder-preview [data-builder="preview"]').after(previewButton);
 const stage=form.querySelector('[data-stage="3"]');
 const section=document.createElement('section');
 section.className='manual-interaction-editor';
 section.innerHTML=`
  <h2>Scenariusze na stronach</h2>
  <input type="hidden" name="manual_scenarios" value="[]">
  <div class="manual-scenario-list"></div>
  <button type="button" class="secondary" data-manual-action="add" aria-controls="manual-scenario-form" aria-expanded="false">+ Nowy scenariusz</button>
  <section id="manual-scenario-form" class="manual-scenario-form" aria-labelledby="manual-scenario-title" hidden>
   <h3 id="manual-scenario-title" tabindex="-1"></h3>
   <p class="manual-scenario-site" id="manual-scenario-site" data-no-translate hidden></p>
   <label for="manual-domain">Domena strony</label>
   <input id="manual-domain" placeholder="portal.example.com" autocomplete="off" spellcheck="false">
   <label for="manual-start-url">Adres strony, od której zacznie rozszerzenie</label>
   <input id="manual-start-url" placeholder="https://portal.example.com/" inputmode="url" spellcheck="false">
   <label for="manual-mode">Sposób wykonania</label>
   <select id="manual-mode" aria-describedby="manual-mode-hint">
    <option value="steps">Zapisane kroki</option>
    <option value="agent">Agent AI</option>
   </select>
   <p class="hint" id="manual-mode-hint"></p>
   <div class="manual-run-settings">
    <label class="check manual-dry-run"><input id="manual-dry-run" type="checkbox" checked aria-describedby="manual-dry-run-hint"> Próba (dry run)</label>
    <div id="manual-agent-settings" hidden>
     <div>
      <label for="manual-max-requests">Limit wywołań agenta</label>
      <input id="manual-max-requests" type="number" min="1" step="1" value="${defaultManualAgentMaxRequests}">
     </div>
     <div>
      <label for="manual-page-wait">Czas oczekiwania na stronę (s)</label>
      <input id="manual-page-wait" type="number" min="1" max="${maxManualAgentPageWait}" step="1" value="${defaultManualAgentPageWait}">
     </div>
    </div>
   </div>
   <p class="hint" id="manual-dry-run-hint">Próba przygotowuje wiadomość, pomija wysłanie i zostawia zadanie w kolejce.</p>
   <label for="manual-instructions">Co ma zrobić scenariusz?</label>
   <textarea id="manual-instructions" rows="4" maxlength="6000" placeholder="Otwórz wyszukiwanie. Znajdź kontakt po imieniu, nazwisku i firmie. Otwórz formularz wiadomości i uzupełnij temat oraz treść."></textarea>
   <div id="manual-steps-editor">
    <div class="manual-steps-heading">
     <label for="manual-actions">Kroki do wykonania (JSON)</label>
     <button type="button" class="secondary" data-manual-action="generate">Wygeneruj kroki z AI</button>
    </div>
    <textarea id="manual-actions" rows="8" spellcheck="false" aria-describedby="manual-mode-hint"></textarea>
    <details><summary>Podgląd JavaScript</summary><pre id="manual-js-preview" class="manual-js-preview"></pre></details>
   </div>
   <details class="manual-scenario-variables">
    <summary>Dostępne zmienne</summary>
    <p class="hint" data-no-translate>${variableNames.map(name=>esc('{{'+name+'}}')).join(', ')}</p>
    <p class="hint" id="manual-credentials-hint">Przy zapisanych krokach rozszerzenie prosi o dane logowania podczas uruchamiania i nie zapisuje ich w kampanii.</p>
   </details>
   <div class="actions manual-scenario-save">
    <button type="button" class="primary" data-manual-action="save"></button>
    <button type="button" class="secondary" data-manual-action="cancel">Anuluj</button>
   </div>
   <p class="hint">Po zastosowaniu scenariusza zapisz kampanię.</p>
  </section>`;
 stage.append(section);
 const list=section.querySelector('.manual-scenario-list');
 const editor=$('#manual-scenario-form');
 const add=section.querySelector('[data-manual-action="add"]');
 const save=section.querySelector('[data-manual-action="save"]');
 const generate=section.querySelector('[data-manual-action="generate"]');
 const generateLabel='Wygeneruj kroki z AI';
 let editorRevision=0;
 const syncMode=()=>{
  const agent=$('#manual-mode').value==='agent';
  $('#manual-steps-editor').hidden=agent;
  $('#manual-agent-settings').hidden=!agent;
  $('#manual-max-requests').disabled=!agent;
  $('#manual-page-wait').disabled=!agent;
  $('#manual-credentials-hint').hidden=agent;
  $('#manual-mode-hint').textContent=agent
   ?'Agent wybiera kolejne działania według opisu i widocznych kontrolek. Symulacja zatrzymuje się przed wysłaniem wiadomości.'
   :'Rozszerzenie wykonuje kroki zapisane w JSON. Wygeneruj je z opisu lub wpisz samodzielnie.';
 };
 $('#manual-mode').addEventListener('change',syncMode);
 const sync=()=>{const hidden=form.elements.manual_scenarios;try{manualScenarioDrafts=JSON.parse(hidden.value||'[]');if(!Array.isArray(manualScenarioDrafts))manualScenarioDrafts=[]}catch{manualScenarioDrafts=[]}renderManualScenarioList()};
 manualScenarioEditing=-1;
 const showActions=(domain,actions)=>{
  $('#manual-actions').value=JSON.stringify(manualScenarioEditorActions(domain,actions),null,2);
  renderManualJavaScript();
 };
 const syncChannel=()=>{section.hidden=previewButton.hidden=channel.value!=='manual'};
 channel.addEventListener('input',syncChannel);
 channel.addEventListener('change',syncChannel);
 generate.onclick=async ()=>{
  const revision=editorRevision;
  const values=JSON.stringify(manualScenarioFieldValues());
  try{
   const domain=manualScenarioDomain($('#manual-domain').value),instructions=$('#manual-instructions').value.trim();
   if(!instructions)throw Error('Opisz kroki scenariusza.');
   generate.disabled=true;generate.textContent='AI przygotowuje kroki…';
   const result=await api('ai/manual-interaction',{domain,instructions,message_example:$('#steps .step [name=body]')?.value||''});
   if(!editor.isConnected||revision!==editorRevision||values!==JSON.stringify(manualScenarioFieldValues()))return;
   showActions(domain,JSON.parse(result.actions));toast('Kroki i podgląd JavaScript gotowe do sprawdzenia.');
  }
  catch(error){if(editor.isConnected&&revision===editorRevision)toast(error instanceof Error?error.message:'Nie udało się wygenerować kroków.')}
  finally{if(revision===editorRevision){generate.disabled=false;generate.textContent=generateLabel}}
 };
 save.onclick=()=>{
  try{
   const scenario=readManualScenarioForm();
   const index=manualScenarioEditing<0?manualScenarioDrafts.length:manualScenarioEditing;
   manualScenarioDrafts[index]=scenario;
   form.elements.manual_scenarios.value=JSON.stringify(manualScenarioDrafts);
   closeEditor();
   list.querySelector(`[data-scenario-action="edit"][data-index="${index}"]`)?.focus();
   persistBuilder();
   toast('Scenariusz zastosowany. Zapisz kampanię, aby zachować zmiany.');
  }catch(error){toast(error.message||'Nie można zapisać scenariusza.');}
 };
 add.onclick=()=>openEditor(-1);
 section.querySelector('[data-manual-action="cancel"]').onclick=()=>{
  const index=manualScenarioEditing;
  closeEditor();
  const trigger=index<0?add:list.querySelector(`[data-scenario-action="edit"][data-index="${index}"]`);
  trigger?.focus();
 };
 $('#manual-actions').addEventListener('input',renderManualJavaScript);
 $('#manual-dry-run').addEventListener('change',renderManualJavaScript);
 list.addEventListener('click',e=>{
  const button=e.target.closest('[data-scenario-action]');
  if(!button||!editor.hidden)return;
  const index=Number(button.dataset.index);
  if(button.dataset.scenarioAction==='edit'){
   openEditor(index,button);
   return;
  }
  manualScenarioDrafts.splice(index,1);
  form.elements.manual_scenarios.value=JSON.stringify(manualScenarioDrafts);
  renderManualScenarioList();
  persistBuilder();
  const next=list.querySelectorAll('[data-scenario-action="edit"]');
  (next[index]||next[index-1]||add).focus();
 });
 function renderManualScenarioList(){
  list.innerHTML=manualScenarioDrafts.map((item,index)=>`
   <article class="signal-card">
    <div class="panel-head"><strong data-no-translate>${esc(item.domain)}</strong><span><span>${item.mode==='agent'?'Agent AI':'Zapisane kroki'}</span> · <span>${item.dry_run===false?'Wysyłka':'Próba'}</span></span></div>
    <p class="hint" data-no-translate>${esc(item.start_url)}</p>
    <div class="actions">
     <button type="button" class="secondary" data-scenario-action="edit" data-index="${index}" aria-controls="manual-scenario-form" aria-expanded="false">Edytuj</button>
     <button type="button" class="link danger" data-scenario-action="remove" data-index="${index}">Usuń</button>
    </div>
   </article>`).join('')||'<p class="hint">Nie ma jeszcze scenariuszy w tej kampanii.</p>';
 }
 function openEditor(index,trigger=add){
  const item=manualScenarioDrafts[index];
  manualScenarioEditing=index;
  $('#manual-scenario-title').textContent=item?'Edycja scenariusza':'Nowy scenariusz';
  const site=$('#manual-scenario-site');
  site.textContent=item?.domain||'';
  site.hidden=!item;
  $('#manual-domain').value=item?.domain||'';
  $('#manual-start-url').value=item?.start_url||'';
  $('#manual-instructions').value=item?.instructions||'';
  $('#manual-mode').value=item?.mode||'steps';
  $('#manual-dry-run').checked=item?.dry_run!==false;
  $('#manual-max-requests').value=item?.agent_max_requests??defaultManualAgentMaxRequests;
  $('#manual-page-wait').value=item?.agent_page_wait_seconds??defaultManualAgentPageWait;
  $('#manual-actions').value=item?JSON.stringify(item.actions||[],null,2):'';
  renderManualJavaScript();
  save.textContent=item?'Zastosuj zmiany':'Dodaj do kampanii';
  syncMode();
  editor.dataset.initialValues=JSON.stringify(manualScenarioFieldValues());
  const card=trigger.closest('article');
  if(card)card.after(editor);
  editor.hidden=false;
  list.querySelectorAll('[data-scenario-action]').forEach(button=>{button.disabled=true});
  add.hidden=true;
  add.disabled=true;
  trigger.setAttribute('aria-expanded','true');
  $('#manual-scenario-title').focus();
 }
 function closeEditor(){
  editorRevision++;
  manualScenarioEditing=-1;
  editor.hidden=true;
  add.after(editor);
  add.hidden=false;
  add.disabled=false;
  add.setAttribute('aria-expanded','false');
  for(const key of ['domain','start-url','instructions','actions'])$('#manual-'+key).value='';
  $('#manual-mode').value='steps';
  $('#manual-max-requests').value=defaultManualAgentMaxRequests;
  $('#manual-page-wait').value=defaultManualAgentPageWait;
  syncMode();
  generate.disabled=false;
  generate.textContent=generateLabel;
  editor.querySelectorAll('details').forEach(details=>{details.open=false});
  renderManualJavaScript();
  renderManualScenarioList();
 }
 function renderManualJavaScript(){
  let actions=[];try{actions=JSON.parse($('#manual-actions').value||'[]')}catch{}
  const quote=value=>JSON.stringify(String(value??''));
  const valueCode=value=>{
   const raw=String(value??''),tokens=[...raw.matchAll(/\{\{([a-z_]+)\}\}/g)].filter(token=>knownVariables.has(token[1]));
   if(!tokens.length)return quote(raw);
   const parts=[];
   let cursor=0;
   for(const token of tokens){
    const key=token[1];
    if(token.index>cursor)parts.push(quote(raw.slice(cursor,token.index)));
    parts.push(key==='username'||key==='password'?`(await page.secret(${quote(key)}))`:`variables.${key}`);
    cursor=token.index+token[0].length;
   }
   if(cursor<raw.length)parts.push(quote(raw.slice(cursor)));
   return parts.join(' + ');
  };
  const lines=(items,depth)=>{const pad='  '.repeat(depth);return (Array.isArray(items)?items:[]).flatMap(action=>{
   if(!action||typeof action!=='object')return [];
   if(action.type==='fill')return [`${pad}await page.fill(${quote(action.selector)}, ${valueCode(action.value)});`];
   if(action.type==='pressEnter')return [`${pad}await page.press(${quote(action.selector)}, "Enter");`];
   if(action.type==='click'||action.type==='send')return [`${pad}${action.type==='send'?'if (!dryRun) ':''}await page.click(${quote(action.selector)}${action.text===undefined?'':`, { text: ${valueCode(action.text)} }`});`];
   if(action.type==='waitFor')return [`${pad}await page.waitFor(${quote(action.selector)}, { timeout: ${Number(action.timeout_ms)||10000}${action.text===undefined?'':`, text: ${valueCode(action.text)}`} });`];
   if(action.type==='assertVisible')return [`${pad}await page.assertVisible(${quote(action.selector)});`];
   if(action.type==='confirm')return [`${pad}await page.confirm(${quote(action.prompt)});`];
   if(action.type==='ifVisible'||action.type==='ifNotVisible')return [`${pad}if (${action.type==='ifNotVisible'?'!':''}await page.isVisible(${quote(action.selector)})) {`,...lines(action.then,depth+1),`${pad}}${action.else?.length?' else {':''}`,...(action.else?.length?lines(action.else,depth+1):[]),...(action.else?.length?[`${pad}}`]:[])];
   return [`${pad}// Nieznany krok: ${String(action.type||'')}`];
  })};
  const code=`async function run({ page, variables, dryRun = ${$('#manual-dry-run').checked} }) {\n${lines(actions,1).join('\n')}\n}`;
  const output=$('#manual-js-preview');if(output)output.textContent=code;
 }
 const previousRestore=window.restoreBuilder;
 if(typeof previousRestore==='function'){
  window.restoreBuilder=function(draft){previousRestore(draft);if(!form.isConnected)return;let scenarios=draft.manual_scenarios||[];try{if(typeof scenarios==='string')scenarios=JSON.parse(scenarios)}catch{scenarios=[]}manualScenarioDrafts=Array.isArray(scenarios)?scenarios:[];form.elements.manual_scenarios.value=JSON.stringify(manualScenarioDrafts);closeEditor();syncChannel()};
 }
 sync();syncChannel();syncMode();
}
