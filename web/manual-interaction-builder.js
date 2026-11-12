let manualScenarioDrafts=[];
let manualScenarioEditing=-1;
const manualSendSimulationLabel='Wyślij symulację';

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

function readManualScenarioForm(){
 const domain=manualScenarioDomain($('#manual-domain').value);
 let startUrl;
 try{startUrl=new URL($('#manual-start-url').value.trim())}catch{throw Error('Podaj poprawny adres początkowy HTTPS.');}
 if(startUrl.protocol!=='https:'||startUrl.username||startUrl.password)throw Error('Podaj poprawny adres początkowy HTTPS.');
 if(startUrl.hostname.replace(/^www\./,'')!==domain)throw Error('Adres początkowy musi należeć do podanej domeny.');
 const instructions=$('#manual-instructions').value.trim();
 if(instructions.length<5)throw Error('Opisz, co ma zrobić scenariusz (minimum 5 znaków).');
 if($('#manual-mode').value==='agent')return {domain,start_url:startUrl.href,instructions,mode:'agent',actions:[]};
 let actions;
 try{actions=JSON.parse($('#manual-actions').value)}catch{throw Error('Podaj kroki scenariusza w poprawnym JSON.');}
 if(!Array.isArray(actions)||!actions.length)throw Error('Dodaj kroki scenariusza.');
 return {domain,start_url:startUrl.href,instructions,actions};
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
 const section=document.createElement('section');section.className='manual-interaction-editor';section.innerHTML=`<h2>Manual interaction</h2><p class="hint">Opisz operacje na stronie. AI przygotuje sprawdzalne kroki. Rozszerzenie wykonuje je dopiero po uruchomieniu zadania na wybranej karcie.</p><input type="hidden" name="manual_scenarios" value="[]"><div class="manual-scenario-list"></div><div class="manual-scenario-form"><label for="manual-domain">Domena strony</label><input id="manual-domain" placeholder="portal.example.com" autocomplete="url"><label for="manual-start-url">Adres początkowy</label><input id="manual-start-url" placeholder="https://portal.example.com/login" autocomplete="url"><label for="manual-instructions">Co ma zrobić scenariusz?</label><textarea id="manual-instructions" rows="4" maxlength="6000" placeholder="Jeśli nie ma menu konta, zaloguj się. Wpisz wiadomość i zatwierdź."></textarea><div class="actions"><button type="button" class="secondary" data-manual-action="generate">✧ Zbuduj kroki z AI</button><button type="button" class="primary" data-manual-action="save">Dodaj scenariusz</button><button type="button" class="link" data-manual-action="cancel" hidden>Anuluj edycję</button></div><label for="manual-actions">Kroki do wykonania (możesz poprawić)</label><textarea id="manual-actions" rows="12" spellcheck="false" placeholder='[\n  {"type":"ifNotVisible","selector":".account-menu","then":[...],"else":[]},\n  {"type":"fill","selector":"textarea[name=message]","value":"{{message}}"},\n  {"type":"confirm","prompt":"Sprawdź wiadomość przed zatwierdzeniem."},\n  {"type":"click","selector":"button[type=submit]"}\n]'></textarea><p class="hint">Dostępne zmienne: <span data-no-translate>${variableNames.map(name=>esc('{{'+name+'}}')).join(', ')}</span>. Dane logowania rozszerzenie pyta przy uruchomieniu i nie zapisuje ich w kampanii. CAPTCHA/MFA zatrzymują zadanie do ręcznej obsługi.</p></div>`;
 stage.append(section);
 $('#manual-instructions').insertAdjacentHTML('afterend','<label for="manual-mode">Tryb wykonania</label><select id="manual-mode"><option value="steps">Zapisane kroki</option><option value="agent">Agent AI</option></select><p class="hint" id="manual-agent-hint" hidden>AI wybiera następny krok na podstawie widocznych kontrolek. Symulacja zatrzymuje się przed wysłaniem wiadomości.</p>');
 const jsPreview=document.createElement('details');jsPreview.innerHTML='<summary>Podgląd równoważnego JavaScript</summary><pre id="manual-js-preview" class="manual-js-preview"></pre>';section.querySelector('#manual-actions').after(jsPreview);
 const syncMode=()=>{
  const agent=$('#manual-mode').value==='agent';
  for(const element of [section.querySelector('[data-manual-action="generate"]'),section.querySelector('[for="manual-actions"]'),$('#manual-actions'),jsPreview])element.hidden=agent;
  $('#manual-agent-hint').hidden=!agent;
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
 section.querySelector('[data-manual-action="generate"]').onclick=async e=>{
  const button=e.currentTarget;
  try{
   const domain=manualScenarioDomain($('#manual-domain').value),instructions=$('#manual-instructions').value.trim();
   if(!instructions)throw Error('Opisz kroki scenariusza.');
   button.disabled=true;button.textContent='AI przygotowuje kroki…';
   const result=await api('ai/manual-interaction',{domain,instructions,message_example:$('#steps .step [name=body]')?.value||''});
   showActions(domain,JSON.parse(result.actions));toast('Kroki i podgląd JavaScript gotowe do sprawdzenia.');
  }
  catch(error){toast(error instanceof Error?error.message:'Nie udało się wygenerować kroków.')}
  finally{button.disabled=false;button.textContent='✧ Zbuduj kroki z AI';}
 };
 section.querySelector('[data-manual-action="save"]').onclick=()=>{
  try{
   const scenario=readManualScenarioForm();
   if(manualScenarioEditing<0)manualScenarioDrafts.push(scenario);else manualScenarioDrafts[manualScenarioEditing]=scenario;
   form.elements.manual_scenarios.value=JSON.stringify(manualScenarioDrafts);manualScenarioEditing=-1;clearManualScenarioForm();renderManualScenarioList();persistBuilder();
  }catch(error){toast(error.message||'Nie można zapisać scenariusza.');}
 };
 section.querySelector('[data-manual-action="cancel"]').onclick=()=>{manualScenarioEditing=-1;clearManualScenarioForm();renderManualScenarioList()};
 $('#manual-actions').addEventListener('input',renderManualJavaScript);
 section.querySelector('.manual-scenario-list').addEventListener('click',e=>{const button=e.target.closest('[data-scenario-action]');if(!button)return;const index=Number(button.dataset.index),action=button.dataset.scenarioAction;if(action==='remove'){manualScenarioDrafts.splice(index,1);if(manualScenarioEditing===index){manualScenarioEditing=-1;clearManualScenarioForm()}else if(manualScenarioEditing>index)manualScenarioEditing--;form.elements.manual_scenarios.value=JSON.stringify(manualScenarioDrafts);persistBuilder();renderManualScenarioList()}else if(action==='edit'){const item=manualScenarioDrafts[index];manualScenarioEditing=index;$('#manual-domain').value=item.domain;$('#manual-start-url').value=item.start_url;$('#manual-instructions').value=item.instructions;$('#manual-mode').value=item.mode||'steps';showActions(item.domain,item.actions||[]);syncMode();section.querySelector('[data-manual-action="save"]').textContent='Zapisz scenariusz';section.querySelector('[data-manual-action="cancel"]').hidden=false}});
 function renderManualScenarioList(){const root=section.querySelector('.manual-scenario-list');root.innerHTML=manualScenarioDrafts.map((item,index)=>`<article class="signal-card"><div class="panel-head"><strong data-no-translate>${esc(item.domain)}</strong><span>${item.mode==='agent'?'Agent AI':`${item.actions?.length||0} kroków`}</span></div><p class="hint" data-no-translate>${esc(item.start_url)}</p><div class="actions"><button type="button" class="link" data-scenario-action="edit" data-index="${index}">Edytuj</button><button type="button" class="link danger" data-scenario-action="remove" data-index="${index}">Usuń</button></div></article>`).join('')||'<p class="hint">Dodaj scenariusz dla każdej domeny, do której prowadzi kampania.</p>';}
 function clearManualScenarioForm(){$('#manual-domain').value='';$('#manual-start-url').value='';$('#manual-instructions').value='';$('#manual-actions').value='';$('#manual-mode').value='steps';syncMode();renderManualJavaScript();section.querySelector('[data-manual-action="save"]').textContent='Dodaj scenariusz';section.querySelector('[data-manual-action="cancel"]').hidden=true;}
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
  const lines=(items,depth)=>{const pad='  '.repeat(depth);return (items||[]).flatMap(action=>{
   if(action.type==='fill')return [`${pad}await page.fill(${quote(action.selector)}, ${valueCode(action.value)});`];
   if(action.type==='pressEnter')return [`${pad}await page.press(${quote(action.selector)}, "Enter");`];
   if(action.type==='click')return [`${pad}await page.click(${quote(action.selector)}${action.text===undefined?'':`, { text: ${valueCode(action.text)} }`});`];
   if(action.type==='waitFor')return [`${pad}await page.waitFor(${quote(action.selector)}, { timeout: ${Number(action.timeout_ms)||10000}${action.text===undefined?'':`, text: ${valueCode(action.text)}`} });`];
   if(action.type==='assertVisible')return [`${pad}await page.assertVisible(${quote(action.selector)});`];
   if(action.type==='confirm')return [`${pad}await page.confirm(${quote(action.prompt)});`];
   if(action.type==='ifVisible'||action.type==='ifNotVisible')return [`${pad}if (${action.type==='ifNotVisible'?'!':''}await page.isVisible(${quote(action.selector)})) {`,...lines(action.then,depth+1),`${pad}}${action.else?.length?' else {':''}`,...(action.else?.length?lines(action.else,depth+1):[]),...(action.else?.length?[`${pad}}`]:[])];
   return [`${pad}// Nieznany krok: ${String(action.type||'')}`];
  })};
  const code=`async function run({ page, variables }) {\n${lines(actions,1).join('\n')}\n}`;
  const output=$('#manual-js-preview');if(output)output.textContent=code;
 }
 const previousRestore=window.restoreBuilder;
 if(typeof previousRestore==='function'){
  window.restoreBuilder=function(draft){previousRestore(draft);let scenarios=draft.manual_scenarios||[];try{if(typeof scenarios==='string')scenarios=JSON.parse(scenarios)}catch{scenarios=[]}manualScenarioDrafts=Array.isArray(scenarios)?scenarios:[];form.elements.manual_scenarios.value=JSON.stringify(manualScenarioDrafts);renderManualScenarioList();syncChannel()};
 }
 sync();syncChannel();syncMode();
}
