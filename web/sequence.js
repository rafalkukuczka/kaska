let builderConditions=[],builderSelectedStep=0,builderAssistantBusy=false;
let sequenceView='tree',sequenceCamera={x:0,y:0,scale:1,fitted:false};
try{sequenceView=localStorage.getItem('kaska-sequence-view')==='list'?'list':'tree'}catch{}
const conditionFields={email:'Email',company:'Firma',role:'Stanowisko'};
const conditionOps={is_set:'jest ustawione',is_not_set:'nie jest ustawione',contains:'zawiera',equals:'jest równe',not_contains:'nie zawiera'};
function resetSequence(){builderConditions=[{field:'email',operator:'is_set',value:''}];builderSelectedStep=0;sequenceCamera={x:0,y:0,scale:1,fitted:false}}
function renderAssistantButtons(){
  const root=$('.assistant-shortcuts');if(!root)return;
  root.innerHTML=builderStep===2?'<button type="button" data-builder="improve-step">Popraw treść tego kroku z AI</button><button type="button" data-builder="first-touch">Napisz pierwszą wiadomość z AI</button>':'<button type="button" data-builder="website-shortcut">Stwórz ofertę z naszej strony</button><button type="button" data-builder="materials-shortcut">Zbuduj ofertę z historii sukcesu</button>';
  root.querySelectorAll('button').forEach(button=>button.disabled=builderAssistantBusy);
  if(!$('#assistant-step-note'))root.insertAdjacentHTML('afterend','<label class="assistant-step-note" id="assistant-note-label" hidden>Uwagi do AI<textarea id="assistant-step-note" rows="3" maxlength="2000" placeholder="Jak poprawić wiadomość?"></textarea></label>');
  $('#assistant-note-label').hidden=builderStep!==2;
  $('#assistant-step-note').oninput=persistBuilder;
}
function renderSequenceMap(){
  const root=$('#sequence-map');if(!root)return;
  const steps=[...document.querySelectorAll('#steps .step')];builderSelectedStep=Math.min(builderSelectedStep,Math.max(0,steps.length-1));
  initSequenceCanvas(root);
  const stage=root.closest('[data-stage]');stage.dataset.sequenceView=sequenceView;
  $('.builder-layout').classList.toggle('sequence-wide',builderStep===2&&sequenceView==='tree');
  root.querySelectorAll('[data-sequence-view]').forEach(button=>{const selected=button.dataset.sequenceView===sequenceView;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});
  const height=420+steps.length*135,scene=root.querySelector('.sequence-scene');scene.style.height=height+'px';
  const paths=['M600 175 V225 H240 V280','M600 175 V225 H900 V280'];
  for(let i=0;i<steps.length-1;i++)paths.push(`M900 ${375+i*135} V${415+i*135}`);
  paths.push(`M900 ${240+steps.length*135} V${290+steps.length*135}`);
  scene.innerHTML=`<svg class="sequence-wires" width="1200" height="${height}" aria-hidden="true">${paths.map(d=>`<path d="${d}"/>`).join('')}</svg><button type="button" class="sequence-node condition-node" data-x="480" data-y="75" data-flow-condition><small>Warunek wejścia</small><strong>◇ Warunek</strong><span>${builderConditions.length?builderConditions.map(c=>`<span><span>${esc(conditionFields[c.field]||c.field)}</span> · <span>${esc(conditionOps[c.operator]||c.operator)}</span> ${c.value?`<span data-no-translate>${esc(c.value)}</span>`:''}</span>`).join(''):'Bez dodatkowych warunków'}</span></button><span class="branch-badge branch-no" data-x="370" data-y="214">Nie</span><div class="sequence-stop" data-x="120" data-y="280">Pomiń odbiorcę</div><span class="branch-badge branch-yes" data-x="720" data-y="214">Tak</span>${steps.map((step,i)=>{const day=Number(step.querySelector('[name=delay]').value)||0,previous=i?Number(steps[i-1].querySelector('[name=delay]').value)||0:0;return `<button type="button" class="sequence-node email-node ${i===builderSelectedStep?'selected':''}" data-x="780" data-y="${280+i*135}" data-flow-step="${i}"><small><span>Odczekaj</span> ${Math.max(0,day-previous)} <span>dni</span></small><strong>✉ <span>Wyślij email</span> · ${i+1}</strong><span data-no-translate>${esc(step.querySelector('[name=subject]').value)}</span></button>`}).join('')}<button type="button" class="sequence-add" data-x="884" data-y="${290+steps.length*135}" data-canvas-add aria-label="Dodaj krok">+</button>`;
  scene.querySelectorAll('[data-x]').forEach(node=>{node.style.left=node.dataset.x+'px';node.style.top=node.dataset.y+'px'});
  root.querySelector('[data-flow-condition]').onclick=openConditionPanel;
  root.querySelector('[data-canvas-add]').onclick=()=>{if(steps.length>=6)return toast('Maksymalnie 6 kroków');addStep();decorateBuilderSteps();persistBuilder()};
  root.querySelectorAll('[data-flow-step]').forEach(button=>button.onclick=()=>{builderSelectedStep=Number(button.dataset.flowStep);stage.dataset.editing='true';$('#sequence-condition-panel')?.remove();renderSequenceMap();steps[builderSelectedStep].querySelector('[name=body]').focus()});
  steps.forEach((step,i)=>{step.classList.toggle('selected-step',i===builderSelectedStep);if(!step.querySelector('[data-close-step]')){step.insertAdjacentHTML('afterbegin','<button type="button" class="link step-back" data-close-step>← Wstecz</button>');step.querySelector('[data-close-step]').onclick=()=>{stage.dataset.editing='false'}}});
  applySequenceCamera(root);
  if(builderStep===2&&!sequenceCamera.fitted)requestAnimationFrame(()=>{if(root.isConnected&&builderStep===2)fitSequence(root)});
}
function applySequenceCamera(root=$('#sequence-map')){if(!root)return;root.querySelector('.sequence-scene').style.transform=`translate(${sequenceCamera.x}px,${sequenceCamera.y}px) scale(${sequenceCamera.scale})`;root.querySelector('[data-zoom-label]').textContent=Math.round(sequenceCamera.scale*100)+'%'}
function zoomSequence(factor,x,y){const root=$('#sequence-map'),viewport=root.querySelector('.sequence-viewport'),before=sequenceCamera.scale,next=Math.max(.3,Math.min(2,before*factor));x=x??viewport.clientWidth/2;y=y??viewport.clientHeight/2;sequenceCamera.x=x-(x-sequenceCamera.x)*next/before;sequenceCamera.y=y-(y-sequenceCamera.y)*next/before;sequenceCamera.scale=next;sequenceCamera.fitted=true;applySequenceCamera(root)}
function fitSequence(root=$('#sequence-map')){const viewport=root.querySelector('.sequence-viewport');if(!viewport.clientWidth||!viewport.clientHeight)return;const scene=root.querySelector('.sequence-scene'),height=parseFloat(scene.style.height)||600;sequenceCamera.scale=Math.max(.3,Math.min(1,(viewport.clientWidth-40)/1200,(viewport.clientHeight-40)/height));sequenceCamera.x=(viewport.clientWidth-1200*sequenceCamera.scale)/2;sequenceCamera.y=15;sequenceCamera.fitted=true;applySequenceCamera(root)}
function initSequenceCanvas(root){
  if(root.querySelector('.sequence-viewport'))return;
  root.classList.add('sequence-workspace');
  root.innerHTML=`<div class="sequence-toolbar"><label class="sequence-sender"><span>Nadawca</span><select aria-label="Nadawca kampanii" ${state.integrations.sender?'':'disabled'}><option>${esc(state.integrations.sender||'Podłącz skrzynkę w Integracjach')}</option></select></label><div class="sequence-view-switch"><button type="button" data-sequence-view="tree">⚯ Drzewo</button><button type="button" data-sequence-view="list">☷ Lista</button></div><button type="button" class="secondary" data-edit-conditions>Warunek</button><button type="button" class="secondary" data-sequence-templates>Wróć do szablonów</button></div><div class="sequence-viewport" tabindex="0" role="region" aria-label="Schemat sekwencji — przeciągnij, aby przesunąć"><div class="sequence-scene"></div></div><div class="sequence-zoom"><button type="button" data-zoom-out aria-label="Oddal">−</button><span data-zoom-label>100%</span><button type="button" data-zoom-in aria-label="Przybliż">+</button><button type="button" data-zoom-fit>Wyśrodkuj</button><span>Przeciągnij planszę, aby ją przesunąć</span></div>`;
  root.querySelectorAll('[data-sequence-view]').forEach(button=>button.onclick=()=>{sequenceView=button.dataset.sequenceView;try{localStorage.setItem('kaska-sequence-view',sequenceView)}catch{}root.closest('[data-stage]').dataset.editing='false';renderSequenceMap();if(sequenceView==='tree')requestAnimationFrame(()=>fitSequence(root))});
  root.querySelector('[data-sequence-templates]').onclick=openSequenceTemplates;
  root.querySelector('[data-edit-conditions]').onclick=openConditionPanel;
  root.querySelector('[data-zoom-out]').onclick=()=>zoomSequence(1/1.2);root.querySelector('[data-zoom-in]').onclick=()=>zoomSequence(1.2);root.querySelector('[data-zoom-fit]').onclick=()=>fitSequence(root);
  const viewport=root.querySelector('.sequence-viewport');let drag=null;
  viewport.onpointerdown=e=>{if(e.target.closest('button')||e.button!==0)return;drag={x:e.clientX,y:e.clientY,originX:sequenceCamera.x,originY:sequenceCamera.y};viewport.setPointerCapture(e.pointerId);viewport.classList.add('dragging');e.preventDefault()};
  viewport.onpointermove=e=>{if(!drag)return;sequenceCamera.x=drag.originX+e.clientX-drag.x;sequenceCamera.y=drag.originY+e.clientY-drag.y;sequenceCamera.fitted=true;applySequenceCamera(root)};
  const end=()=>{drag=null;viewport.classList.remove('dragging')};viewport.onpointerup=end;viewport.onpointercancel=end;
  viewport.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey||e.metaKey){const rect=viewport.getBoundingClientRect();zoomSequence(Math.exp(-e.deltaY*.002),e.clientX-rect.left,e.clientY-rect.top)}else{sequenceCamera.x-=e.deltaX;sequenceCamera.y-=e.deltaY;sequenceCamera.fitted=true;applySequenceCamera(root)}},{passive:false});
  viewport.onkeydown=e=>{if(e.target!==viewport)return;if(e.key==='+'||e.key==='='){e.preventDefault();zoomSequence(1.2)}if(e.key==='-'){e.preventDefault();zoomSequence(1/1.2)}if(e.key==='0'){e.preventDefault();fitSequence(root)}};
}
function openSequenceTemplates(){
  const templates=[{name:'Pojedynczy kontakt',days:[0]},{name:'Kontakt i follow-up',days:[0,3]},{name:'Trzy kroki',days:[0,3,7]}];
  $('#modal-content').innerHTML=`<h2>Szablony sekwencji</h2><p>Zastosowanie szablonu zastąpi bieżące wiadomości. Oferta i warunki pozostaną zachowane.</p>${templates.map((template,i)=>`<article class="sequence-template"><h3>${template.name}</h3><p><span>Dni wysyłki:</span> ${template.days.join(' → ')}</p><button type="button" class="secondary" data-use-template="${i}">Użyj tego szablonu</button></article>`).join('')}`;$('#modal').showModal();
  $('#modal-content').querySelectorAll('[data-use-template]').forEach(button=>button.onclick=()=>{const template=templates[Number(button.dataset.useTemplate)];$('#steps').replaceChildren();template.days.forEach(day=>{addStep();$('#steps').lastElementChild.querySelector('[name=delay]').value=day});builderSelectedStep=0;$('#sequence-map').closest('[data-stage]').dataset.editing='false';sequenceCamera.fitted=false;decorateBuilderSteps();persistBuilder();$('#modal').close();renderSequenceMap()});
}
function openConditionPanel(){
  $('#sequence-map').closest('[data-stage]').dataset.editing='false';
  $('#sequence-condition-panel')?.remove();
  const panel=document.createElement('section');panel.id='sequence-condition-panel';panel.className='sequence-condition-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','condition-title');
  panel.innerHTML='<button type="button" class="link" data-condition-close>← Wstecz</button><h2 id="condition-title">◇ Warunek</h2><p>Wszystkie warunki muszą być spełnione. Tak: przejdź do wiadomości. Nie: pomiń odbiorcę.</p><div class="condition-rows"></div><button type="button" class="secondary" data-condition-add>+ Dodaj warunek</button><button type="button" class="primary" data-condition-save>Zapisz warunki</button>';
  $('.builder-layout').append(panel);
  const rows=panel.querySelector('.condition-rows');
  const add=(condition={field:'company',operator:'contains',value:''})=>{
    if(rows.children.length>=10)return;
    const row=document.createElement('div');row.className='condition-row';
    row.innerHTML=`<select aria-label="Pole warunku" data-condition-field>${Object.entries(conditionFields).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select><select aria-label="Operator warunku" data-condition-op>${Object.entries(conditionOps).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select><input maxlength="300" aria-label="Wartość warunku" placeholder="Wartość warunku"><button type="button" class="link" aria-label="Usuń warunek">×</button>`;
    row.querySelector('[data-condition-field]').value=condition.field;row.querySelector('[data-condition-op]').value=condition.operator;row.querySelector('input').value=condition.value||'';
    const update=()=>row.querySelector('input').hidden=['is_set','is_not_set'].includes(row.querySelector('[data-condition-op]').value);
    row.querySelector('[data-condition-op]').onchange=update;row.querySelector('button').onclick=()=>row.remove();rows.append(row);update();
  };
  builderConditions.forEach(add);
  panel.querySelector('[data-condition-close]').onclick=()=>panel.remove();
  panel.querySelector('[data-condition-add]').onclick=()=>add();
  panel.querySelector('[data-condition-save]').onclick=e=>run(e.currentTarget,async()=>{
    const conditions=[...rows.children].map(row=>({field:row.querySelector('[data-condition-field]').value,operator:row.querySelector('[data-condition-op]').value,value:row.querySelector('input').value.trim()}));
    if(conditions.some(c=>!['is_set','is_not_set'].includes(c.operator)&&!c.value))throw Error('Uzupełnij wartość warunku.');
    builderConditions=conditions.map(c=>({...c,value:['is_set','is_not_set'].includes(c.operator)?'':c.value}));persistBuilder();renderSequenceMap();panel.remove();
  });
  panel.onkeydown=e=>{if(e.key==='Escape')panel.remove()};panel.querySelector('button').focus();
}
async function assistantStep(mode){
  if(builderAssistantBusy)throw Error('Trwa już operacja. Zaczekaj na zakończenie.');
  const form=$('#campaign-form'),rows=[...form.querySelectorAll('.step')],index=mode==='first_touch'?0:builderSelectedStep,target=rows[index];
  if(!target)return;
  builderAssistantBusy=true;renderAssistantButtons();
  try{
    const data=builderData();
    const result=await api('ai/step-prompt',{...data,...data.steps[index],mode,note:$('#assistant-step-note').value});
    if(!target.isConnected||$('#campaign-form')!==form)return;
    $('#modal-content').innerHTML=`<h2>Sprawdź propozycję wiadomości</h2><form id="assistant-step-form"><label for="assistant-step-subject">Temat</label><input id="assistant-step-subject" maxlength="250" required value="${esc(result.subject)}"><label for="assistant-step-body">Treść</label><textarea id="assistant-step-body" rows="10" maxlength="15000" required>${esc(result.body)}</textarea><p class="hint">Zastosowanie zmieni tylko wybrany krok. Nie uruchamia wysyłki.</p><button class="primary">Zastosuj wiadomość</button></form>`;$('#modal').showModal();
    $('#assistant-step-form').onsubmit=event=>{event.preventDefault();if(!target.isConnected){$('#modal').close();return}target.querySelector('[name=subject]').value=$('#assistant-step-subject').value;target.querySelector('[name=body]').value=$('#assistant-step-body').value;builderSelectedStep=index;persistBuilder();renderSequenceMap();$('#modal').close()};
  }finally{builderAssistantBusy=false;if($('#campaign-form'))renderAssistantButtons()}
}
