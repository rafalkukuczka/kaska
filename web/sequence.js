let builderConditions=[],builderSelectedStep=0,builderAssistantBusy=false;
let sequenceView='tree',sequenceCamera={x:0,y:0,scale:1,fitted:false};
let sequenceInsertAt=null;
try{sequenceView=localStorage.getItem('kaska-sequence-view')==='list'?'list':'tree'}catch{}
const conditionFields={email:'Email',company:'Firma',role:'Stanowisko'};
const conditionOps={is_set:'jest ustawione',is_not_set:'nie jest ustawione',contains:'zawiera',equals:'jest równe',not_contains:'nie zawiera'};
function resetSequence(){builderConditions=[{field:'email',operator:'is_set',value:''}];builderSelectedStep=0;sequenceInsertAt=null;sequenceCamera={x:0,y:0,scale:1,fitted:false}}
function sequenceConditionMarkup(rules,position,y){
 return `<button type="button" class="sequence-node condition-node" data-x="780" data-y="${y}" data-flow-condition="${position}"><small>${position==='entry'?'Warunek wejścia':'Warunek'}</small><strong>◇ Warunek</strong><span>${rules.length?rules.map(c=>`<span><span>${esc(conditionFields[c.field]||c.field)}</span> · <span>${esc(conditionOps[c.operator]||c.operator)}</span> ${c.value?`<span data-no-translate>${esc(c.value)}</span>`:''}</span>`).join(''):'Bez dodatkowych warunków'}</span></button><span class="branch-badge branch-no" data-x="540" data-y="${y+123}">Nie</span><div class="sequence-stop" data-x="280" data-y="${y+145}" data-skip-after="${position}">Pomiń odbiorcę</div><span class="branch-badge branch-yes" data-x="925" data-y="${y+123}">Tak</span>`;
}
function sequenceSceneMarkup(steps){
 let y=65,html='',paths=[];
 const condition=(rules,position)=>{html+=sequenceConditionMarkup(rules,position,y);paths.push(`M900 ${y+100} V${y+190}`,`M900 ${y+100} V${y+130} H400 V${y+145}`);y+=190};
 condition(builderConditions.filter(c=>c.before_step===undefined),'entry');
 for(let position=0;position<=steps.length;position++){
  const rules=builderConditions.filter(c=>c.before_step===position);if(rules.length)condition(rules,position);
  html+=`<button type="button" class="sequence-add" data-x="884" data-y="${y}" data-canvas-add="${position}" aria-label="${esc(translateUiText('Dodaj krok'))} ${position+1}">+</button>`;
  if(position<steps.length){
   paths.push(`M900 ${y+32} V${y+65}`);y+=65;
   const step=steps[position],day=Number(step.querySelector('[name=delay]').value)||0,previous=position?Number(steps[position-1].querySelector('[name=delay]').value)||0:0;
   html+=`<button type="button" class="sequence-node email-node ${position===builderSelectedStep?'selected':''}" data-x="780" data-y="${y}" data-flow-step="${position}"><small><span>Odczekaj</span> ${Math.max(0,day-previous)} <span>dni</span></small><strong>✉ <span>Wyślij email</span> · ${position+1}</strong><span data-no-translate>${esc(step.querySelector('[name=subject]').value)}</span></button>`;
   paths.push(`M900 ${y+95} V${y+130}`);y+=130;
  }
 }
 return {height:y+100,html:`<svg class="sequence-wires" width="1200" height="${y+100}" aria-hidden="true">${paths.map(d=>`<path d="${d}"/>`).join('')}</svg>`+html};
}
function insertSequenceCondition(position=sequenceInsertAt??document.querySelectorAll('#steps .step').length){
 if(builderConditions.length>=10)return toast('Dodaj maksymalnie 10 warunków sekwencji.');
 sequenceInsertAt=position;builderConditions.push({field:'email',operator:'is_set',value:'',before_step:position});
 persistBuilder();renderSequenceMap();openConditionPanel(position);
}
function insertSequenceEmail(position){
 if(builderEditing?.protected_position!==null&&builderEditing?.protected_position!==undefined&&position<=builderEditing.protected_position)return toast('Wstaw nowe kroki po wysłanych wiadomościach.');
 const rows=[...document.querySelectorAll('#steps .step')];if(rows.length>=6)return toast('Maksymalnie 6 kroków');
 const previous=position?Number(rows[position-1].querySelector('[name=delay]').value)||0:-1;
 const day=Math.max(0,previous+(rows[position]?1:3)),shift=rows[position]?Math.max(0,day-Number(rows[position].querySelector('[name=delay]').value)+1):0;
 if(day>365||rows.some((row,index)=>index>=position&&Number(row.querySelector('[name=delay]').value)+shift>365))return toast('Dni sekwencji muszą mieścić się w zakresie 0–365.');
 addStep();const added=$('#steps').lastElementChild;
 if(rows[position])$('#steps').insertBefore(added,rows[position]);
 added.querySelector('[name=delay]').value=day;
 if(shift)for(const row of rows.slice(position))row.querySelector('[name=delay]').value=Number(row.querySelector('[name=delay]').value)+shift;
 for(const condition of builderConditions)if(condition.before_step>position)condition.before_step++;
 builderSelectedStep=position;sequenceInsertAt=position+1;decorateBuilderSteps();persistBuilder();
}
function openSequenceInsert(button){
 sequenceInsertAt=Number(button.dataset.canvasAdd);$('#sequence-insert-menu')?.remove();
 const menu=document.createElement('div');menu.id='sequence-insert-menu';menu.className='sequence-insert-menu';menu.setAttribute('role','group');menu.setAttribute('aria-label',translateUiText('Dodaj krok'));
 menu.style.left='925px';menu.style.top=button.dataset.y+'px';
 menu.innerHTML='<button type="button" class="secondary" data-sequence-insert="email">Wyślij email</button><button type="button" class="secondary" data-sequence-insert="condition">Warunek</button>';
 button.after(menu);menu.querySelector('[data-sequence-insert=email]').onclick=()=>insertSequenceEmail(sequenceInsertAt);menu.querySelector('[data-sequence-insert=condition]').onclick=()=>insertSequenceCondition(sequenceInsertAt);menu.querySelector('button').focus();syncLanguages();
 menu.onkeydown=event=>{if(event.key==='Escape'){menu.remove();button.focus()}};
}
function renderAssistantButtons(){
  const root=$('.assistant-shortcuts');if(!root)return;
  root.innerHTML=builderStep===2?'<button type="button" data-builder="improve-step">Popraw treść tego kroku z AI</button><button type="button" data-builder="first-touch">Napisz pierwszą wiadomość z AI</button>':'<button type="button" data-builder="website-shortcut">Stwórz ofertę z naszej strony</button><button type="button" data-builder="materials-shortcut">Zbuduj ofertę z historii sukcesu</button>';
  root.querySelectorAll('button').forEach(button=>{const protectedStep=builderEditing?.protected_position;button.disabled=builderAssistantBusy||(protectedStep!==undefined&&protectedStep!==null&&((button.dataset.builder==='improve-step'&&builderSelectedStep<=protectedStep)||(button.dataset.builder==='first-touch'&&protectedStep>=0)))});
  syncWebsiteActions($('#campaign-form'));
  if(!$('#assistant-step-note'))root.insertAdjacentHTML('afterend','<label class="assistant-step-note" id="assistant-note-label" hidden>Uwagi do AI<textarea id="assistant-step-note" rows="3" maxlength="2000" placeholder="Jak poprawić wiadomość?"></textarea></label>');
  $('#assistant-note-label').hidden=builderStep!==2;
  $('#assistant-step-note').oninput=persistBuilder;
}
function renderSequenceMap(){
  const root=$('#sequence-map');if(!root)return;
  const steps=[...document.querySelectorAll('#steps .step')];builderSelectedStep=Math.min(builderSelectedStep,Math.max(0,steps.length-1));
  if(sequenceInsertAt!==null)sequenceInsertAt=Math.max(0,Math.min(sequenceInsertAt,steps.length));
  initSequenceCanvas(root);
  const stage=root.closest('[data-stage]');stage.dataset.sequenceView=sequenceView;
  $('.builder-layout').classList.toggle('sequence-wide',builderStep===2&&sequenceView==='tree');
  root.querySelectorAll('[data-sequence-view]').forEach(button=>{const selected=button.dataset.sequenceView===sequenceView;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});
  root.querySelector('[data-sequence-templates]').disabled=builderEditing?.protected_position!==null&&builderEditing?.protected_position!==undefined;
  const scene=root.querySelector('.sequence-scene'),markup=sequenceSceneMarkup(steps);scene.style.height=markup.height+'px';scene.innerHTML=markup.html;
  scene.querySelectorAll('[data-x]').forEach(node=>{node.style.left=node.dataset.x+'px';node.style.top=node.dataset.y+'px'});
  root.querySelectorAll('[data-flow-condition]').forEach(button=>button.onclick=()=>openConditionPanel(button.dataset.flowCondition==='entry'?'entry':Number(button.dataset.flowCondition)));
  root.querySelectorAll('[data-canvas-add]').forEach(button=>button.onclick=()=>openSequenceInsert(button));
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
  root.innerHTML=`<div class="sequence-toolbar"><label class="sequence-sender"><span>Nadawca</span><select aria-label="Nadawca kampanii" ${state.integrations.sender?'':'disabled'}><option>${esc(state.integrations.sender||'Podłącz skrzynkę w Integracjach')}</option></select></label><div class="sequence-view-switch"><button type="button" data-sequence-view="tree">⚯ Drzewo</button><button type="button" data-sequence-view="list">☷ Lista</button></div><button type="button" class="secondary" data-edit-conditions>Warunek</button><button type="button" class="secondary" data-insert-email>Email</button><button type="button" class="secondary" data-sequence-templates>Wróć do szablonów</button></div><div class="sequence-viewport" tabindex="0" role="region" aria-label="Schemat sekwencji — przeciągnij, aby przesunąć"><div class="sequence-scene"></div></div><div class="sequence-zoom"><button type="button" data-zoom-out aria-label="Oddal">−</button><span data-zoom-label>100%</span><button type="button" data-zoom-in aria-label="Przybliż">+</button><button type="button" data-zoom-fit>Wyśrodkuj</button><span>Przeciągnij planszę, aby ją przesunąć</span></div>`;
  root.querySelectorAll('[data-sequence-view]').forEach(button=>button.onclick=()=>{sequenceView=button.dataset.sequenceView;try{localStorage.setItem('kaska-sequence-view',sequenceView)}catch{}root.closest('[data-stage]').dataset.editing='false';renderSequenceMap();if(sequenceView==='tree')requestAnimationFrame(()=>fitSequence(root))});
  root.querySelector('[data-sequence-templates]').onclick=openSequenceTemplates;
  root.querySelector('[data-edit-conditions]').onclick=()=>insertSequenceCondition();
  root.querySelector('[data-insert-email]').onclick=()=>insertSequenceEmail(sequenceInsertAt??document.querySelectorAll('#steps .step').length);
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
  $('#modal-content').querySelectorAll('[data-use-template]').forEach(button=>button.onclick=()=>{const template=templates[Number(button.dataset.useTemplate)];$('#steps').replaceChildren();template.days.forEach(day=>{addStep();$('#steps').lastElementChild.querySelector('[name=delay]').value=day});builderSelectedStep=0;sequenceInsertAt=null;for(const condition of builderConditions)if(condition.before_step>template.days.length)condition.before_step=template.days.length;$('#sequence-map').closest('[data-stage]').dataset.editing='false';sequenceCamera.fitted=false;decorateBuilderSteps();persistBuilder();$('#modal').close();renderSequenceMap()});
}
function openConditionPanel(position='entry'){
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
  const belongs=condition=>position==='entry'?condition.before_step===undefined:condition.before_step===position;
  builderConditions.filter(belongs).forEach(add);
  panel.querySelector('[data-condition-close]').onclick=()=>panel.remove();
  panel.querySelector('[data-condition-add]').onclick=()=>add();
  panel.querySelector('[data-condition-save]').onclick=e=>run(e.currentTarget,async()=>{
    const conditions=[...rows.children].map(row=>({field:row.querySelector('[data-condition-field]').value,operator:row.querySelector('[data-condition-op]').value,value:row.querySelector('input').value.trim()}));
    if(conditions.some(c=>!['is_set','is_not_set'].includes(c.operator)&&!c.value))throw Error('Uzupełnij wartość warunku.');
    if(builderConditions.filter(c=>!belongs(c)).length+conditions.length>10)throw Error('Dodaj maksymalnie 10 warunków sekwencji.');
    builderConditions=[...builderConditions.filter(c=>!belongs(c)),...conditions.map(c=>({...c,...(position==='entry'?{}:{before_step:position}),value:['is_set','is_not_set'].includes(c.operator)?'':c.value}))];persistBuilder();renderSequenceMap();panel.remove();
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
