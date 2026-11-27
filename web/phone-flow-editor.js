const phoneFlowEdges={
 script:[['answered','Rozmowa odbyta'],['no_answer','Nie odebrano']],
 condition:[['yes','Tak'],['no','Nie']],
};

function legacyPhoneFlow(scripts,variants,conditions){
 const nodes=[],entries=[];
 const entryRules=conditions.filter(rule=>rule.before_step===undefined||rule.before_step===0);
 scripts.forEach((text,index)=>{
  const rules=index===0?entryRules:[...entryRules,...conditions.filter(rule=>rule.before_step===index)];
  const id='script-'+index;
  entries.push(rules.length?'condition-'+index:id);
  if(rules.length)nodes.push({id:entries[index],kind:'condition',rules:rules.map(({field,operator,value})=>({field,operator,value})),yes:id,no:null});
  nodes.push({id,kind:'script',text,time_variant:variants[index]??null,answered:null,no_answer:null});
 });
 nodes.filter(node=>node.kind==='script').forEach((node,index)=>node.no_answer=entries[index+1]??null);
 return {entry:entries[0],nodes};
}

function phoneFlowLabels(flow){
 const counts={script:0,condition:0};
 return new Map(flow.nodes.map(node=>[node.id,
  translateUiText(node.kind==='script'?'Skrypt rozmowy':'Warunek')+' '+(++counts[node.kind])]));
}

function bindPhoneFlowBoard(viewport,flow,getScale,setScale){
 const canvas=viewport.querySelector('.phone-flow-canvas'),wires=canvas.querySelector('svg');
 const cards=[...canvas.querySelectorAll('[data-flow-select]')];
 const offerButtons=[...canvas.querySelectorAll('[data-flow-read-offer]')];
 const width=166,height=92,padding=16;
 const positions=new Map(Object.entries(flow.layout||{}));
 let slot=0;
 for(const card of cards){
  if(positions.has(card.dataset.flowSelect))continue;
  let point;
  do{
   point=[padding+(slot%2)*(width+60),padding+Math.floor(slot/2)*(height+52)];
   slot++;
  }while([...positions.values()].some(([x,y])=>Math.abs(x-point[0])<width+12&&Math.abs(y-point[1])<height+12));
  positions.set(card.dataset.flowSelect,point);
 }
 const paint=()=>{
  let right=0,bottom=0;
  for(const card of cards){
   const [x,y]=positions.get(card.dataset.flowSelect);
   card.style.left=x+'px';card.style.top=y+'px';
   right=Math.max(right,x+width);bottom=Math.max(bottom,y+height);
  }
  for(const button of offerButtons){
   const [x,y]=positions.get(button.dataset.flowReadOffer);
   button.style.left=x+'px';button.style.top=(y+height+4)+'px';
   bottom=Math.max(bottom,y+height+32);
  }
  const scale=getScale();
  canvas.style.zoom=scale;
  canvas.style.width=Math.max(viewport.clientWidth/scale,right+padding)+'px';
  canvas.style.height=Math.max(300,bottom+padding)+'px';
  wires.innerHTML=`<defs><marker id="phone-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5"
   markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z"/></marker></defs>`+
   flow.nodes.flatMap(node=>phoneFlowEdges[node.kind].map(([edge])=>{
    const target=positions.get(node[edge]);
    if(!target)return '';
    const [x,y]=positions.get(node.id),[tx,ty]=target;
    const horizontal=Math.abs(tx-x)>Math.abs(ty-y),forward=horizontal?tx>=x:ty>=y;
    const sx=horizontal?x+(forward?width:0):x+width/2,sy=horizontal?y+height/2:y+(forward?height:0);
    const ex=horizontal?tx+(forward?0:width):tx+width/2,ey=horizontal?ty+height/2:ty+(forward?0:height);
    const mx=(sx+ex)/2,my=(sy+ey)/2;
    const bend=horizontal?`${mx} ${sy}, ${mx} ${ey}`:`${sx} ${my}, ${ex} ${my}`;
    return `<path class="phone-flow-wire" d="M${sx} ${sy} C${bend}, ${ex} ${ey}" marker-end="url(#phone-flow-arrow)"/>`;
   })).join('');
 };
 const move=(card,x,y)=>{
  const point=[x,y].map(value=>Math.max(0,Math.min(10000,Math.round(value))));
  const id=card.dataset.flowSelect;
  positions.set(id,point);
  flow.layout={...flow.layout,[id]:point};
  paint();
 };
 let drag=null,draggedCard=null;
 viewport.onpointerdown=event=>{
  const card=event.target.closest('[data-flow-select]');
  if(!card||event.button!==0)return;
  draggedCard=null;
  const [x,y]=positions.get(card.dataset.flowSelect);
  drag={card,id:event.pointerId,x,y,scale:getScale(),left:event.clientX+viewport.scrollLeft,top:event.clientY+viewport.scrollTop,moved:false};
  card.setPointerCapture(event.pointerId);
 };
 viewport.onpointermove=event=>{
  if(!drag||drag.id!==event.pointerId)return;
  const dx=event.clientX+viewport.scrollLeft-drag.left,dy=event.clientY+viewport.scrollTop-drag.top;
  if(!drag.moved&&Math.hypot(dx,dy)<4)return;
  drag.moved=true;
  drag.card.classList.add('dragging');
  move(drag.card,drag.x+dx/drag.scale,drag.y+dy/drag.scale);
 };
 const end=event=>{
  if(!drag||drag.id!==event.pointerId)return;
  if(drag.moved)draggedCard=drag.card;
  drag.card.classList.remove('dragging');
  drag=null;
 };
 viewport.onpointerup=end;
 viewport.onpointercancel=end;
 viewport.addEventListener('click',event=>{
  if(draggedCard&&event.detail&&event.target.closest('[data-flow-select]')===draggedCard){
   event.preventDefault();event.stopPropagation();draggedCard=null;
  }
 });
 viewport.onkeydown=event=>{
  const card=event.target.closest('[data-flow-select]');
  const offset={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if(!card||!offset)return;
  event.preventDefault();
  const [x,y]=positions.get(card.dataset.flowSelect),distance=event.shiftKey?32:8;
  move(card,x+offset[0]*distance,y+offset[1]*distance);
 };
 const controls=viewport.parentElement.querySelector('.phone-flow-zoom');
 const zoom=(value,x=viewport.clientWidth/2,y=viewport.clientHeight/2)=>{
  if(drag)return;
  const before=getScale();
  const after=Math.max(.5,Math.min(2,Math.round(value*100)/100));
  if(before===after)return;
  const left=(viewport.scrollLeft+x)*after/before-x,top=(viewport.scrollTop+y)*after/before-y;
  setScale(after);
  paint();
  viewport.scrollTo(left,top);
  updateZoom();
 };
 const updateZoom=()=>{
  const scale=getScale();
  controls.querySelector('[data-flow-zoom="reset"]').textContent=Math.round(scale*100)+'%';
  controls.querySelector('[data-flow-zoom="out"]').disabled=scale<=.5;
  controls.querySelector('[data-flow-zoom="in"]').disabled=scale>=2;
 };
 controls.onclick=event=>{
  const action=event.target.closest('[data-flow-zoom]')?.dataset.flowZoom;
  if(action)zoom(action==='reset'?1:getScale()+(action==='in'?.1:-.1));
 };
 viewport.addEventListener('wheel',event=>{
  if(!event.ctrlKey&&!event.metaKey)return;
  event.preventDefault();
  const rect=viewport.getBoundingClientRect();
  zoom(getScale()+(event.deltaY<0?.1:-.1),event.clientX-rect.left,event.clientY-rect.top);
 },{passive:false});
 paint();
 updateZoom();
}

function renderPhoneFlowEditor(root,flow,readOffer){
 let selected=null,board=true,scale=1,scroll=[0,0];
 const fields=[...Object.entries(conditionFields),['call_time','Godzina rozmowy']];
 const selectValues=(items,value)=>items.map(([key,label])=>
  `<option value="${esc(key)}" ${key===value?'selected':''}>${esc(label)}</option>`).join('');
 const render=()=>{
  const oldViewport=root.querySelector('.phone-flow-viewport');
  if(oldViewport)scroll=[oldViewport.scrollLeft,oldViewport.scrollTop];
  const labels=phoneFlowLabels(flow),nodes=[...labels];
  const editing=flow.nodes.find(node=>node.id===selected);
  const options=[['','Zakończ sekwencję'],...nodes.filter(([id])=>id!==selected),
   ['+script','+ Dodaj skrypt'],['+condition','+ Dodaj warunek']];
  const edgeSummary=node=>phoneFlowEdges[node.kind].map(([key,label])=>
   `<small><span>${label}</span> → <span>${esc(labels.get(node[key])||translateUiText('Koniec sekwencji'))}</span></small>`).join('');
  const cards=flow.nodes.map(node=>`<button type="button" class="secondary phone-flow-node${node.kind==='condition'?' phone-flow-condition':''}"
   data-flow-select="${esc(node.id)}" aria-pressed="${node.id===selected}"><strong>${esc(labels.get(node.id))}</strong>
   ${node.id===flow.entry?'<span class="badge">Początek</span>':''}${edgeSummary(node)}</button>
   ${board&&node.kind==='script'?`<button type="button" class="secondary phone-flow-read-offer"
    data-flow-read-offer="${esc(node.id)}">Przeczytaj z oferty</button>`:''}`).join('');
  const rules=editing?.kind==='condition'?editing.rules.map((rule,index)=>`<div class="phone-flow-rule" data-flow-rule="${index}">
    <select aria-label="Pole warunku" data-flow-property="field">${selectValues(fields,rule.field)}</select>
    ${rule.field==='call_time'?`<p class="hint">Godziny według czasu warszawskiego</p><div class="row">
     <label>Od<input type="time" data-flow-property="start" value="${esc(rule.start)}"></label>
     <label>Do<input type="time" data-flow-property="end" value="${esc(rule.end)}"></label></div>`:
    `<select aria-label="Operator warunku" data-flow-property="operator">${selectValues(Object.entries(conditionOps),rule.operator)}</select>
    <input aria-label="Wartość warunku" data-flow-property="value" maxlength="300" value="${esc(rule.value)}"
     ${['is_set','is_not_set'].includes(rule.operator)?'hidden':''}>`}
    <button type="button" class="link danger" data-flow-remove-rule="${index}">Usuń warunek</button></div>`).join(''):'';
  root.innerHTML=`<div class="actions phone-flow-toolbar">
    <label>Początek sekwencji <select data-flow-entry>${selectValues(nodes,flow.entry)}</select></label>
    <button type="button" class="secondary" data-flow-create="script">Dodaj skrypt</button>
    <button type="button" class="secondary" data-flow-create="condition">Dodaj warunek</button>
    <button type="button" class="secondary" data-flow-view="board" aria-pressed="${board}">Plansza</button>
    <button type="button" class="secondary" data-flow-view="list" aria-pressed="${!board}">Lista</button>
   </div><div class="phone-flow-workspace" ${editing?'data-editing':''}>
    ${board?`<div class="phone-flow-viewport" role="region" aria-label="Plansza sekwencji">
     <div class="phone-flow-canvas"><svg aria-hidden="true"></svg>${cards}</div></div>
     <div class="phone-flow-zoom" role="group" aria-label="Skala planszy">
      <button type="button" class="secondary" data-flow-zoom="out" aria-label="Pomniejsz planszę">−</button>
      <button type="button" class="secondary" data-flow-zoom="reset" aria-label="Przywróć 100%"></button>
      <button type="button" class="secondary" data-flow-zoom="in" aria-label="Powiększ planszę">+</button>
     </div>`:
     `<div class="phone-flow-nodes" aria-label="Elementy sekwencji">${cards}</div>`}
    ${editing?`<section class="phone-flow-node-editor" aria-labelledby="phone-flow-editor-title">
     <div class="phone-flow-editor-header"><h2 id="phone-flow-editor-title">${esc(labels.get(selected))}</h2>
     <button type="button" class="link" data-flow-close aria-label="Zamknij edycję">×</button></div>
    ${editing.kind==='script'?`<div data-flow-refine><label>Skrypt rozmowy<textarea data-flow-text data-refine-field="script" rows="5" maxlength="15000">${esc(editing.text)}</textarea></label>
     ${refineControls('script')}</div>
     ${editing.time_variant?`<label class="check"><input type="checkbox" data-flow-time checked> Pora dnia</label>
      <p class="hint">Godziny według czasu warszawskiego</p><div class="row">
      <label>Od<input type="time" data-flow-time-field="start" value="${esc(editing.time_variant.start)}"></label>
      <label>Do<input type="time" data-flow-time-field="end" value="${esc(editing.time_variant.end)}"></label></div>
      <div data-flow-refine><label>Skrypt poza wybranymi godzinami<textarea rows="3" maxlength="15000" data-refine-field="script"
       data-flow-time-field="otherwise">${esc(editing.time_variant.otherwise)}</textarea></label>${refineControls('script')}</div>`:''}`:
     rules+'<button type="button" class="secondary" data-flow-add-rule>+ Dodaj warunek</button>'}
    <div class="phone-flow-links">${phoneFlowEdges[editing.kind].map(([key,label])=>
      `<label><span>${label}</span><select data-flow-edge="${key}">${selectValues(options,editing[key]??'')}</select></label>`).join('')}</div>
    ${flow.nodes.length>1?'<button type="button" class="link danger" data-flow-remove>Usuń element</button>':''}
   </section>`:''}</div>`;
  for(const field of root.querySelectorAll('[data-flow-refine]')){
   bindTextRefinement(field.querySelector('textarea'),null,'Skrypt dopracowany przez AI. Przeczytaj go przed rozmową.',field);
  }
  const viewport=root.querySelector('.phone-flow-viewport');
  if(viewport){bindPhoneFlowBoard(viewport,flow,()=>scale,value=>{scale=value});viewport.scrollTo(...scroll)}
  syncLanguages();
 };
 const create=kind=>{
  if(flow.nodes.length>=100){toast(translateUiText('Sekwencja może zawierać do 100 elementów.'));return null}
  const id=crypto.randomUUID();
  const node=kind==='script'?{id,kind,text:'',time_variant:null,answered:null,no_answer:null}:
   {id,kind,rules:[{field:'company',operator:'is_set',value:''}],yes:null,no:null};
  flow.nodes.push(node);
  selected=id;
  return id;
 };
 const open=id=>{
  selected=id;
  render();
  (root.querySelector('[data-flow-text], [data-flow-property="field"]')||root.querySelector('[data-flow-close]')).focus({preventScroll:true});
 };
 const close=()=>{
  const id=selected;
  selected=null;
  render();
  root.querySelector('[data-flow-select="'+CSS.escape(id)+'"]')?.focus({preventScroll:true});
 };
 root.onkeydown=event=>{
  if(event.key==='Escape'&&selected){event.stopPropagation();close()}
 };
 root.onclick=event=>{
  const button=event.target.closest('button');
  if(!button)return;
  if(button.dataset.flowView){board=button.dataset.flowView==='board';render();return}
  if(button.dataset.flowSelect){open(button.dataset.flowSelect);return}
  if(button.dataset.flowReadOffer){
   const text=readOffer().trim();
   if(!text){toast(translateUiText('Uzupełnij opis w zakładce Oferta.'));return}
   const script=flow.nodes.find(item=>item.id===button.dataset.flowReadOffer);
   const current=script.text.trimEnd();
   if(current===text||current.endsWith('\n\n'+text)){open(script.id);return}
   const combined=current?current+'\n\n'+text:text;
   if(combined.length>15000){toast(translateUiText('Skrypt rozmowy może mieć do 15 000 znaków.'));return}
   script.text=combined;
   open(script.id);
   return;
  }
  if(button.hasAttribute('data-flow-close')){close();return}
  if(button.dataset.flowCreate){
   const id=create(button.dataset.flowCreate);
   if(id)open(id);
   return;
  }
  const node=flow.nodes.find(item=>item.id===selected);
  if(button.hasAttribute('data-flow-add-rule')){
   if(node.rules.length>=10){toast(translateUiText('Dodaj maksymalnie 10 warunków sekwencji.'));return}
   node.rules.push({field:'company',operator:'is_set',value:''});
  }else if(button.hasAttribute('data-flow-remove-rule')){
   node.rules.splice(Number(button.dataset.flowRemoveRule),1);
  }else if(button.hasAttribute('data-flow-remove')){
   flow.nodes=flow.nodes.filter(item=>item.id!==selected);
   if(flow.layout)delete flow.layout[selected];
   for(const item of flow.nodes)for(const [key] of phoneFlowEdges[item.kind])if(item[key]===selected)item[key]=null;
   if(flow.entry===selected)flow.entry=flow.nodes[0].id;
   selected=null;
  }else return;
  render();
 };
 root.oninput=event=>{
  const input=event.target,node=flow.nodes.find(item=>item.id===selected);
  if(input.hasAttribute('data-flow-text'))node.text=input.value;
  if(input.dataset.flowTimeField)node.time_variant[input.dataset.flowTimeField]=input.value;
  const property=input.dataset.flowProperty;
  if(['value','start','end'].includes(property)){
   node.rules[Number(input.closest('[data-flow-rule]').dataset.flowRule)][property]=input.value;
  }
 };
 root.onchange=event=>{
  const input=event.target,node=flow.nodes.find(item=>item.id===selected);
  if(input.hasAttribute('data-flow-entry'))flow.entry=input.value;
  else if(input.dataset.flowEdge){
   if(input.value.startsWith('+')){
    const id=create(input.value.slice(1));
    if(id)node[input.dataset.flowEdge]=id;
   }else node[input.dataset.flowEdge]=input.value||null;
  }else if(input.hasAttribute('data-flow-time')){
   node.time_variant=null;
  }else if(input.dataset.flowProperty==='field'){
   const index=Number(input.closest('[data-flow-rule]').dataset.flowRule),rule=node.rules[index];
   if(input.value==='call_time')node.rules[index]={field:'call_time',start:'',end:''};
   else if(rule.field==='call_time')node.rules[index]={field:input.value,operator:'is_set',value:''};
   else rule.field=input.value;
  }else if(input.dataset.flowProperty==='operator'){
   node.rules[Number(input.closest('[data-flow-rule]').dataset.flowRule)].operator=input.value;
  }else return;
  render();
 };
 render();
 return open;
}

function phoneFlowOverview(flow){
 const labels=phoneFlowLabels(flow);
 return `<ol>${flow.nodes.map(node=>`<li><strong>${esc(labels.get(node.id))}</strong>
  ${node.id===flow.entry?' <span class="badge">Początek</span>':''}
  ${node.kind==='script'?`<p class="message" data-no-translate>${esc(node.text)}</p>
   ${node.time_variant?`<p class="hint"><span>Pora dnia</span> · ${esc(node.time_variant.start)}–${esc(node.time_variant.end)}</p>
    <p class="hint">Skrypt poza wybranymi godzinami</p><p class="message" data-no-translate>${esc(node.time_variant.otherwise)}</p>`:''}`:
   node.rules.map(rule=>rule.field==='call_time'?`<p class="hint"><span>Godzina rozmowy</span> · ${esc(rule.start)}–${esc(rule.end)}</p>`:
    `<p class="hint"><span>${esc(conditionFields[rule.field])}</span> · <span>${esc(conditionOps[rule.operator])}</span>
    <span data-no-translate>${esc(rule.value)}</span></p>`).join('')}
  ${phoneFlowEdges[node.kind].map(([key,label])=>`<p class="hint"><span>${label}</span> → ${esc(labels.get(node[key])||
   translateUiText('Koniec sekwencji'))}</p>`).join('')}</li>`).join('')}</ol>`;
}
