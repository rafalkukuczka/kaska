const campaignWorkspaces=new Map();
function campaignWorkspace(id){
 const key=JSON.stringify([state.seller_project.id,id,simulationEpoch]);
 if(!campaignWorkspaces.has(key))campaignWorkspaces.set(key,{key,id,projectId:state.seller_project.id,epoch:simulationEpoch,tab:'recipients',page:1,size:25,data:null,loading:false,error:'',request:0,open:new Set()});
 return campaignWorkspaces.get(key);
}
function campaignReviewKey(w){return 'kaska-campaign-review:'+w.projectId+':'+w.id+':'+monitoringSimulation}
function campaignHasReview(w){try{return !!w.data&&sessionStorage.getItem(campaignReviewKey(w))===w.data.fingerprint}catch{return false}}
function rememberCampaignReview(w){if(w.data)try{sessionStorage.setItem(campaignReviewKey(w),w.data.fingerprint)}catch{}}
function campaignWorkspaceData(w){
 if(!w.data)return null;
 const data=structuredClone(w.data),run=monitoringSimulation?deliverySimulationRuns()[w.id]:null;
 if(!run)return data;
 advanceDeliverySimulation(run);
 const ids=new Set(data.summary.message_ids),messages=new Map(run.messages.filter(message=>ids.has(message.id)).map(message=>[message.id,message]));
 for(const original of run.messages){
  if(!ids.has(original.id))continue;
  const previous=original.original_status,next=original.status;
  if(previous!==next){data.summary.counts[previous]=Math.max(0,(data.summary.counts[previous]||0)-1);data.summary.counts[next]=(data.summary.counts[next]||0)+1}
 }
 for(const person of data.recipients)person.messages=person.messages.map(message=>messages.has(message.id)?{...message,...messages.get(message.id),delivery_simulated:true}:message);
 const sent=[...messages.values()].filter(message=>message.status==='sent');
 data.summary.sent+=sent.filter(message=>message.original_status!=='sent').length;data.summary.contacted=new Set([...data.summary.sent_contact_ids,...sent.map(message=>message.contact_id)]).size;
 data.summary.replies+=run.replies.length;data.summary.replied=new Set([...data.summary.replied_contact_ids,...run.replies.map(reply=>reply.contact_id)]).size;
 return data;
}
function manualQueueActive(w){
 return Boolean(!w.manualQueueError&&w.manualRuns?.some(task=>['queued','running'].includes(task.status)));
}
function campaignWorkspaceStatus(c,w,summary,delivery){
 if(!monitoringSimulation&&c.channel==='manual'&&manualQueueActive(w))return 'Kolejka rozszerzenia aktywna';
 if(c.status==='active'){
  if(!monitoringSimulation&&c.channel==='manual'){
   if(w.manualQueueError)return 'Kolejka rozszerzenia niedostępna';
   if(!w.manualRuns)return 'Sprawdzam stan kolejki…';
   if(w.manualRuns.some(task=>['paused','needs_review'].includes(task.status)))return 'Zadania wstrzymane lub do sprawdzenia';
   return summary?.counts.queued?'Kolejka oczekuje na uruchomienie':'Brak oczekujących zadań';
  }
  if(monitoringSimulation)return 'Symulacja w toku';
  if(summary?.counts.sending)return 'Wysyłka w toku';
  if(summary?.counts.uncertain)return 'Wymaga uwagi';
  if(summary?.messages&&!summary.counts.queued)return 'Brak wiadomości do wysłania';
  if(delivery)return 'Oczekuje na wysyłkę';
  return 'Wysyłka w toku';
 }
 if((summary?.counts.uncertain||0)>0)return 'Wymaga uwagi';
 if(c.status==='paused')return 'Wysyłka wstrzymana';
 return summary?.messages?'Wiadomości przygotowane':'Do przygotowania';
}
function campaignMainAction(c,w,summary){
 if(!monitoringSimulation&&c.channel==='linkedin'){
  if(!summary)return '<span class="badge gray">Wczytuję kampanię…</span>';
  if(!summary.messages)return `<button type="button" class="primary" data-action="prepare" data-id="${c.id}">Przygotuj wiadomości LinkedIn</button>`;
  if(summary.restartable)return campaignRestartButton(c.id);
  if(!summary.counts.queued)return '<span class="badge gray">Brak wiadomości do wysłania</span>';
  return `<button type="button" class="primary" data-linkedin-campaign-start="${c.id}">${c.status==='active'?'Otwórz kolejkę LinkedIn':'Uruchom kolejkę'}</button>`;
 }
 if(!monitoringSimulation&&c.channel==='manual'){
  const start=`<button type="button" class="primary" data-manual-campaign-start="${c.id}">Uruchom kolejkę</button>`;
  const resumePaused=`<button type="button" class="secondary" data-manual-campaign-start="${c.id}" data-manual-start-mode="resume-paused">Uruchom tylko wstrzymane</button>`;
  if(c.status==='active'&&summary&&!(summary.counts.queued||0))return '<span class="badge gray">Brak oczekujących zadań</span>';
  if(c.status==='active')return start+resumePaused+'<button type="button" class="secondary" data-manual-queue-command="pause">Wstrzymaj scenariusze</button>';
  if(!summary)return '<span class="badge gray">Wczytuję kampanię…</span>';
  if(!summary.messages)return `<button type="button" class="primary" data-action="prepare" data-id="${c.id}">Przygotuj zadania</button>`;
  if(!(summary.counts.queued||0))return '<span class="badge gray">Brak zadań w kolejce</span>';
  if(c.status!=='paused'&&!campaignHasReview(w))return '<button type="button" class="primary" data-campaign-review>Sprawdź zadania</button>';
  return start+(c.status==='paused'?resumePaused:'');
 }
 const pending=[...backgroundRequests.values()].some(request=>['campaign/prepare','campaign/status','campaign/update','campaign/restart'].includes(request.path));
 const disabled=pending||(c.status!=='active'&&(!summary||w.loading||!!w.error||w.data.revision!==c.revision));
 const button=(label,attrs)=>`<button type="button" class="primary" ${attrs} ${disabled?'disabled':''}>${label}</button>`;
 if(summary?.restartable)return campaignRestartButton(c.id,disabled);
 if(c.status==='active')return button(monitoringSimulation?'Wstrzymaj symulację':'Wstrzymaj wysyłkę',`data-action="campaign-status" data-id="${c.id}" data-status="paused"`);
 if(!summary)return button('Wczytuję kampanię…','');
 if(!summary.messages)return button('Przygotuj wiadomości',`data-action="prepare" data-id="${c.id}"`);
 if(!(summary.counts.queued||summary.counts.sending))return '<span class="badge gray">Brak wiadomości do wysłania</span>';
 if(c.status!=='paused'&&!campaignHasReview(w))return button('Sprawdź wiadomości','data-campaign-review');
 return button(monitoringSimulation?'Symuluj wysyłkę':c.status==='paused'?'Wznów wysyłkę':'Uruchom wysyłkę',`data-action="campaign-status" data-id="${c.id}" data-status="active"`);
}
function campaignRestartButton(id,disabled=false){
 return `<button type="button" class="primary" data-campaign-restart="${id}" ${disabled?'disabled':''}>Uruchom ponownie</button>`;
}
function confirmCampaignRestart(id){
 const campaign=state.campaigns.find(row=>row.id===id);
 if(!campaign)return;
 const projectId=state.seller_project.id,epoch=simulationEpoch;
 modal(`<h2>Uruchomić kampanię ponownie?</h2><p data-no-translate>${esc(campaign.name)}</p>
  <p>Powstanie nowa kolejka z przygotowanymi wiadomościami dla nadal aktywnych odbiorców. Historia poprzedniej wysyłki pozostanie w dotychczasowej kampanii.</p>
  <div class="actions"><button type="button" class="primary" data-confirm-campaign-restart>Przygotuj ponowne uruchomienie</button>
   <button type="button" class="secondary close">Anuluj</button></div>`);
 const confirm=$('[data-confirm-campaign-restart]');
 confirm.onclick=()=>run(confirm,async()=>{
  const data=await api('campaign/restart',{id,project_id:projectId});
  if(!confirm.isConnected||projectId!==state.seller_project.id||epoch!==simulationEpoch)return;
  $('#modal').close();
  selectedCampaign=data.campaign.id;
  await refresh();
  if(view==='campaigns'&&selectedCampaign===data.campaign.id)await showCampaignPreflight(data.campaign.id);
 });
 syncLanguages();
}
function campaignReprepareButton(id,style){
 return `<button type="button" class="${style}" data-campaign-reprepare="${id}">Przygotuj wiadomości ponownie</button>`;
}
function confirmCampaignReprepare(id){
 const campaign=state.campaigns.find(c=>c.id===id);if(!campaign)return;
 const projectId=state.seller_project.id,active=campaign.status==='active',manual=!monitoringSimulation&&campaign.channel==='manual';
 modal(`<h2>Przygotować wiadomości ponownie?</h2>
  <p data-no-translate>${esc(campaign.name)}</p>
  <p>Nowe szkice zastąpią treść oczekujących wiadomości. Historia wysyłek zostanie zachowana.</p>
  ${active?'<p>Kampania zostanie wstrzymana przed przygotowaniem szkiców.</p>':''}
  <p class="error" role="alert" data-campaign-reprepare-error></p>
  <div class="actions"><button type="button" class="primary" data-confirm-campaign-reprepare>${active?'Wstrzymaj i przygotuj ponownie':'Przygotuj wiadomości ponownie'}</button><button type="button" class="secondary close">Anuluj</button></div>`);
 const confirm=$('[data-confirm-campaign-reprepare]'),error=$('[data-campaign-reprepare-error]');
 confirm.onclick=()=>void run(confirm,async()=>{
  error.textContent='';
  try{
   if(projectId!==state.seller_project.id)throw Error('Zmieniono projekt. Otwórz kampanię ponownie.');
   if(active){
    if(manual)await manualQueueAction('pause',id);
    else await api('campaign/status',{id,status:'paused'});
   }
   if(projectId!==state.seller_project.id)throw Error('Zmieniono projekt. Otwórz kampanię ponownie.');
   toast(translateUiText('Przygotowuję wiadomości. Przy użyciu AI może to potrwać kilka minut.'));
   await api('campaign/prepare',{id});
   if(confirm.isConnected)$('#modal').close();
   await refresh();
   toast(translateUiText('Wiadomości gotowe do sprawdzenia'));
  }catch(failure){
   error.textContent=translateUiText(failure.message);
   if(active)await refresh();
  }
 });
 syncLanguages();
}
function renderCampaignWorkspaceHeader(c,w,data){
 const root=$('#campaign-workspace-header');if(!root)return;
 const summary=data?.summary;
 const active=!monitoringSimulation&&c.channel==='manual'?manualQueueActive(w):c.status==='active';
 root.innerHTML=`<div class="topline campaign-workspace-top"><div><p class="section-label">KAMPANIA</p><h1 data-no-translate>${esc(c.name)}</h1><p class="muted" data-no-translate>${esc(c.audience||campaignAudience(c))}</p></div><div class="actions campaign-workspace-actions">${campaignMainAction(c,w,summary)}<button type="button" class="secondary" data-action="edit-campaign" data-id="${c.id}">Edytuj kampanię</button><details class="campaign-more"><summary aria-label="${esc(translateUiText('Więcej działań'))}">⋯</summary><div>${summary?.messages?campaignReprepareButton(c.id,'link'):''}<button type="button" class="link danger" data-action="delete-campaign" data-id="${c.id}">Usuń kampanię</button></div></details></div></div><div class="campaign-summary" aria-label="${esc(translateUiText('Podsumowanie kampanii'))}">${[['Odbiorcy',summary?.recipients],['Kroki',summary?.steps],['Wiadomości',summary?.messages]].map(([label,count])=>`<div><strong data-campaign-summary="${label}">${count??'—'}</strong><span>${label}</span></div>`).join('')}<div class="campaign-state"><span class="campaign-state-dot ${active?'active':''}"></span><strong ${c.channel==='manual'?'data-manual-workspace-status':''}>${campaignWorkspaceStatus(c,w,summary,data?.delivery)}</strong>${monitoringSimulation?'<small>Symulacja</small>':''}</div></div>${renderCampaignDelivery(data)}${summary&&!summary.messages&&summary.recipients?'<p class="campaign-next-step">Kontakty są wybrane. Przygotuj wiadomości, aby sprawdzić treść i uruchomić kampanię.</p>':''}`;
}
function renderCampaignDelivery(data){
 if(!data?.delivery||monitoringSimulation)return '';
 const delivery=data.delivery;
 return `<div class="campaign-delivery-summary"><strong>Stan kolejki wysyłki</strong><div class="campaign-delivery-reasons">${Object.entries(delivery.reasons).map(([reason,count])=>`<div><span>${esc(translateUiText(deliveryReasonLabels[reason]||reason))}</span><strong>${count}</strong></div>`).join('')||'<p class="hint">Brak wiadomości oczekujących na wysyłkę.</p>'}</div><p class="hint"><span>Wysłano dziś ze wszystkich projektów:</span> ${delivery.sent_today} / ${delivery.daily_limit} · <span>Odstęp w sekundach:</span> ${delivery.interval_seconds}</p>${delivery.next_attempt_at>Date.now()/1000?`<p class="hint"><span>Najwcześniejsza próba:</span> ${deliveryTime(delivery.next_attempt_at)} <span>(Warszawa)</span></p>`:''}<p class="hint">Terminy uwzględniają limity i odstępy sekwencji. Inne wiadomości w kolejce mogą opóźnić wysyłkę.</p></div>`;
}
function campaignRecipientPagination(w,total,scope='recipient'){
 const pages=Math.max(1,Math.ceil(total/w.size));
 return `<div class="discover-company-pagination"><span class="hint">${total?((w.page-1)*w.size+1):0}–${Math.min(total,w.page*w.size)} / ${total}</span><label><span>Odbiorców na stronie</span><select data-campaign-${scope}-size>${[10,25,50,100].map(size=>`<option ${size===w.size?'selected':''}>${size}</option>`).join('')}</select></label><div class="actions"><button class="secondary" data-campaign-${scope}-page="${w.page-1}" ${w.page===1||w.loading?'disabled':''}>‹ <span>Poprzednia</span></button><span class="hint"><span>Strona</span> ${w.page} / ${pages}</span><button class="secondary" data-campaign-${scope}-page="${w.page+1}" ${w.page===pages||w.loading?'disabled':''}><span>Następna</span> ›</button></div></div>`;
}
function renderCampaignRecipients(w,data){
 const root=$('#campaign-recipients');if(!root)return;
 if(!data){root.innerHTML='<p class="hint" role="status">Wczytuję odbiorców…</p>';return}
 root.innerHTML=`<div class="panel-head"><h2>Odbiorcy <span class="badge gray">${data.total}</span></h2><button type="button" class="secondary" data-campaign-recipient-add>Dodaj do kampanii</button></div>${campaignRecipientPagination(w,data.total)}<div class="campaign-people">${data.recipients.map(person=>`<details class="campaign-person" data-campaign-person="${person.id}" ${w.open.has(person.id)?'open':''}><summary><span class="campaign-person-chevron" aria-hidden="true">›</span><div class="campaign-person-identity"><strong data-no-translate>${esc(person.name)}</strong><small data-no-translate>${esc(person.email)}</small></div><div class="campaign-person-company" data-no-translate>${esc(person.company)}<small>${esc(person.role)}</small></div><span class="badge gray">${person.messages.length} <span>wiadomości</span></span>${badge(person.status)}</summary><div class="campaign-person-body"><div class="campaign-person-tags" data-no-translate>${person.tags.map(tag=>`<span class="badge gray">${esc(tag)}</span>`).join(' ')}</div>${person.messages.length?person.messages.map(message=>`<article class="campaign-person-message"><div><small><span>Krok</span> ${message.position+1}</small><strong data-no-translate>${esc(message.subject)}</strong><button type="button" class="link" data-action="message" data-id="${message.id}">Podgląd / edycja</button></div>${messageDeliveryProgress(message)}</article>`).join(''):'<p class="hint">Wiadomości dla tego odbiorcy nie zostały jeszcze przygotowane.</p>'}<div class="actions"><button type="button" class="link danger" data-campaign-recipient-remove="${person.id}">Usuń z kampanii</button></div></div></details>`).join('')||empty('Brak pasujących odbiorców','Sprawdź tagi, statusy kontaktów i warunki kampanii.')}</div>`;
}
function renderCampaignSequence(c,data){
 const root=$('#campaign-sequence');if(!root)return;
 if(!data){root.innerHTML='<p class="hint">Wczytuję sekwencję…</p>';return}
 const signature=JSON.stringify([data.steps,data.conditions,c.offer,c.audience,c.audience_tags]);if(root.dataset.signature===signature)return;root.dataset.signature=signature;
 const rules=position=>data.conditions.filter(rule=>rule.before_step===position||(position===0&&rule.before_step===undefined));
 const conditionBlock=position=>rules(position).length?`<div class="campaign-sequence-condition"><strong>Warunek</strong>${rules(position).map(rule=>`<p><span>${esc(conditionFields[rule.field]||rule.field)}</span> · <span>${esc(conditionOps[rule.operator]||rule.operator)}</span> <span data-no-translate>${esc(rule.value)}</span></p>`).join('')}<small>Tak: następny krok · Nie: pomiń odbiorcę</small></div>`:'';
 root.innerHTML=`<h2>Sekwencja</h2><div class="campaign-sequence-timeline">${data.steps.map((step,index)=>`${conditionBlock(index)}<details class="campaign-sequence-step"><summary><span class="campaign-step-number">${index+1}</span><div><strong data-no-translate>${esc(step.subject)}</strong><small><span>Dzień wysyłki</span>: ${step.delay_days}</small></div></summary><p class="message" data-no-translate>${esc(step.body)}</p></details>`).join('')}${conditionBlock(data.steps.length)}</div><details class="campaign-offer"><summary>Oferta i odbiorcy</summary><p data-no-translate>${esc(c.offer)}</p><p data-no-translate>${esc(campaignAudience(c))}</p></details>`;
}
function renderCampaignResults(data){
 const root=$('#campaign-results');if(!root)return;
 if(!data){root.innerHTML='<p class="hint">Wczytuję wyniki…</p>';return}
 const s=data.summary,rate=s.contacted?Math.round(s.replied/s.contacted*1000)/10:null;
 const metrics=[['Wysłane wiadomości',s.sent],['Osoby, do których wysłano',s.contacted],['Odpowiedzi',s.replies],
  ['Wskaźnik odpowiedzi',rate===null?'—':rate+'%']];
 const statuses=[['queued','Oczekuje na wysyłkę'],['sending','Wysyłanie'],['sent','Wysłano'],['cancelled','Zatrzymano'],['uncertain','Wymaga uwagi']];
 root.innerHTML=`<h2>Wyniki kampanii</h2>
 ${monitoringSimulation?'<span class="badge warn">Symulacja</span>':''}
 <div class="campaign-result-metrics">${metrics.map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
 <div class="campaign-status-breakdown">${statuses.map(([status,label])=>{
  const count=s.counts[status]||0;
  return `<div><span>${label}</span><progress aria-label="${esc(translateUiText(label))}" max="${Math.max(1,s.messages)}" value="${count}"></progress><strong>${s.messages?`${count} · ${progressPercent(count,s.messages)}`:count}</strong></div>`;
 }).join('')}</div>
 <p class="hint">Statystyki wysłanych wiadomości obejmują historię kampanii. Odpowiedzi są liczone po przypisaniu do tej kampanii; starsze odpowiedzi mogą nie mieć przypisania.</p>`;
}
function campaignWorkspaceError(w){return w.error?`<div class="notice" role="alert"><span data-no-translate>${esc(w.error)}</span> <button type="button" class="link" data-campaign-workspace-retry>Spróbuj ponownie</button></div>`:''}
const launchSavedCampaignNote='<p class="hint">Uruchomienie użyje zapisanej kampanii. Niezapisane zmiany pozostaną w edytorze jako szkic.</p>';
function confirmManualQueueStart(campaign,data,command,onStart){
 const epoch=simulationEpoch;
 const scenario=JSON.parse(campaign.manual_scenarios||'[]')[0];
 if(!scenario)throw Error('Dodaj scenariusz kampanii przed zalogowaniem.');
 const headless=scenario.headless!==false;
 modal(`<h2>Zaloguj się przed uruchomieniem kolejki</h2>
  <p><span>Serwis</span> <strong data-no-translate>${esc(scenario.domain)}</strong><span> · ${headless?'Tryb headless':'Zwykły profil Chrome'}</span></p>
  <p>${headless?'Zaloguj się w osobnym oknie profilu headless. Po zalogowaniu zamknij to okno i wróć tutaj.':'Zaloguj się w karcie otwartej przez rozszerzenie, a potem wróć tutaj.'}</p>
 ${onStart?launchSavedCampaignNote:''}
  <button type="button" class="secondary" data-manual-queue-login>Otwórz logowanie w Chrome</button>
  <label class="check"><input type="checkbox" data-manual-login-confirmed> Jestem zalogowany w tym profilu</label>
  <p class="error" role="alert" data-manual-start-error></p>
  <div class="actions"><button type="button" class="primary" data-manual-queue-confirm-start disabled>${command==='resume-paused'?'Uruchom tylko wstrzymane':'Uruchom kolejkę'}</button>
  <button type="button" class="secondary close">Anuluj</button></div>`);
 const login=$('[data-manual-queue-login]'),confirmed=$('[data-manual-login-confirmed]');
 const start=$('[data-manual-queue-confirm-start]'),error=$('[data-manual-start-error]');
 confirmed.onchange=()=>{start.disabled=!confirmed.checked};
 login.onclick=async()=>{
  error.textContent='';confirmed.disabled=true;start.disabled=true;
  try{await run(login,async()=>{
   try{await requestManualQueue('campaign-login',campaign.id)}
   catch(failure){error.textContent=translateUiText(failure.message)}
  })}finally{confirmed.disabled=false;start.disabled=!confirmed.checked}
 };
 start.onclick=()=>void run(start,async()=>{
  if(!confirmed.checked)return;
  error.textContent='';login.disabled=true;confirmed.disabled=true;
  try{
   if(data.project_id!==state.seller_project.id||epoch!==simulationEpoch)throw Error('Zmieniono projekt lub tryb aplikacji.');
   if(headless&&(await api('manual-interaction/headless',{method:'login-status'})).open){
    throw Error('Zamknij okno logowania headless i spróbuj ponownie.');
   }
   await api('campaign/status',{id:campaign.id,status:'active',fingerprint:data.fingerprint});
   if(epoch!==simulationEpoch)throw Error('Zmieniono tryb aplikacji. Odśwież dane.');
   await manualQueueAction(command,campaign.id);
   onStart?.();
   $('#modal').close();
   await refresh();
  }catch(failure){error.textContent=translateUiText(failure.message)}
  finally{login.disabled=false;confirmed.disabled=false}
 });
 syncLanguages();
}
async function showCampaignPreflight(id,command='start',{onStart}={}){
 const projectId=state.seller_project.id,epoch=simulationEpoch,response=await fetch('/api/campaign/workspace?'+new URLSearchParams({campaign_id:id,page:1,page_size:10})),data=await response.json();
 if(!response.ok)throw Error(data.error);
 if(projectId!==state.seller_project.id||epoch!==simulationEpoch)return;
 const campaign=state.campaigns.find(c=>c.id===id);if(!campaign)return;
 if(monitoringSimulation){
  const {summary}=campaignWorkspaceData({id,data});
  if(!summary.counts.queued)throw Error('Brak wiadomości do wysłania');
  modal(`<h2>Uruchomić symulację wysyłki?</h2><p data-no-translate>${esc(campaign.name)}</p>
    ${onStart?launchSavedCampaignNote:''}
    <div class="actions"><button type="button" class="primary" data-confirm-send>Symuluj wysyłkę</button><button type="button" class="secondary close">Anuluj</button></div>`);
  $('[data-confirm-send]').onclick=event=>run(event.currentTarget,async()=>{
   if(projectId!==state.seller_project.id||epoch!==simulationEpoch)throw Error('Zmieniono projekt lub tryb aplikacji.');
   await api('campaign/status',{id,status:'active'});
   onStart?.();$('#modal').close();await refresh();
  });
  syncLanguages();
  return;
 }
 if(campaign.channel==='manual'){
  if(!data.summary.counts.queued||data.summary.counts.uncertain)throw Error('Sprawdź oczekujące zadania kampanii.');
  if(command==='resume-paused'){
   const {runs}=await requestManualQueue('status',id);
   if(projectId!==state.seller_project.id)return;
   if(!runs.some(task=>task.status==='paused'))throw Error(translateUiText('Brak wstrzymanych scenariuszy.'));
  }
  confirmManualQueueStart(campaign,data,command,onStart);
  return;
 }
 if(campaign.channel==='linkedin'){
  if(!data.summary.counts.queued)throw Error('Brak wiadomości do wysłania');
  modal(`<h2>Kolejka LinkedIn</h2><p data-no-translate>${esc(campaign.name)}</p>
   <p>Otwórz przygotowane wiadomości w Outreach i wyślij je ręcznie w LinkedIn.</p>
   ${onStart?launchSavedCampaignNote:''}
   <div class="actions"><button type="button" class="primary" data-confirm-linkedin-start>${campaign.status==='active'?'Otwórz kolejkę LinkedIn':'Uruchom kolejkę'}</button><button type="button" class="secondary close">Anuluj</button></div>`);
  $('[data-confirm-linkedin-start]').onclick=event=>run(event.currentTarget,async()=>{
   if(projectId!==state.seller_project.id||epoch!==simulationEpoch)throw Error('Zmieniono projekt lub tryb aplikacji.');
   if(campaign.status!=='active')await api('campaign/status',{id,status:'active',fingerprint:data.fingerprint});
   if(epoch!==simulationEpoch)throw Error('Zmieniono tryb aplikacji. Odśwież dane.');
   onStart?.();$('#modal').close();
   try{await requestManualQueue('open-linkedin',id)}
   finally{await refresh()}
  });
  syncLanguages();
  return;
 }
 const missingAttachment=campaign.material_mode==='document'&&!data.attachment_name;
 const blocked=!state.integrations.smtp||!data.summary.counts.queued||data.summary.counts.uncertain||missingAttachment;
 modal(`<h2>Sprawdź przed wysyłką</h2><p data-no-translate>${esc(campaign.name)}</p><dl class="preflight-summary"><dt>Nadawca</dt><dd data-no-translate>${esc(state.integrations.sender_name||'')} &lt;${esc(state.integrations.sender||'')}&gt;</dd><dt>Odbiorcy z wiadomościami</dt><dd>${data.summary.prepared_recipients}</dd><dt>Oczekujące wiadomości</dt><dd>${data.summary.counts.queued||0}</dd><dt>Pomijane lub zatrzymane wiadomości</dt><dd>${data.summary.counts.cancelled||0}</dd><dt>Limit dzienny / odstęp</dt><dd>${data.delivery.daily_limit} / ${data.delivery.interval_seconds} <span>sekund</span></dd></dl><h3>Harmonogram sekwencji</h3>${data.steps.map(step=>`<p><span>Dzień wysyłki</span> ${step.delay_days}: <span data-no-translate>${esc(step.subject)}</span></p>`).join('')}<p class="hint">Terminy kolejnych kroków liczone są od faktycznej wysyłki poprzedniej wiadomości. Limity obejmują wszystkie projekty.</p><details><summary>Przykładowe wiadomości</summary>${data.recipients.slice(0,3).flatMap(person=>person.messages.slice(0,1).map(message=>`<article class="preflight-message"><strong data-no-translate>${esc(person.email)} · ${esc(message.subject)}</strong><p class="message" data-no-translate>${esc(message.body)}</p></article>`)).join('')}</details>${!state.integrations.smtp?'<p class="error">Podłącz pocztę w Integracjach.</p>':''}${data.summary.counts.uncertain?'<p class="error">Sprawdź niepotwierdzone wysyłki w skrzynce przed wznowieniem.</p>':''}<p class="hint">Sprawdź poprawność adresów, treści i wybranych odbiorców. Odpowiedzi zatrzymują dalsze kroki.</p><p class="error" role="alert" data-preflight-error></p><div class="actions"><button type="button" class="primary" data-confirm-send ${blocked?'disabled':''}>Potwierdź i uruchom wysyłkę</button><button type="button" class="secondary close">Anuluj</button></div>`);
 if(onStart)$('[data-preflight-error]').insertAdjacentHTML('beforebegin',launchSavedCampaignNote);
 if(data.attachment_name)$('.preflight-summary').insertAdjacentHTML('beforeend',
  `<dt>Załącznik w pierwszym e-mailu</dt><dd>${offerDocumentLink(data.attachment_name,{project_id:projectId,campaign_id:id})}</dd>`);
 if(missingAttachment)$('[data-preflight-error]').textContent=translateUiText('Brakuje oryginału załącznika. Dodaj plik ponownie lub wybierz inny dokument.');
 $('[data-confirm-send]').onclick=event=>run(event.currentTarget,async()=>{
  if(projectId!==state.seller_project.id||epoch!==simulationEpoch)throw Error('Zmieniono projekt lub tryb aplikacji.');
  try{await api('campaign/status',{id,status:'active',fingerprint:data.fingerprint});onStart?.();$('#modal').close();await refresh();toast('Kampania uruchomiona')}
  catch(error){if($('[data-preflight-error]'))$('[data-preflight-error]').textContent=error.message;throw error}
 });
 syncLanguages();
}

function requestManualQueue(command,campaignId,messageId){
 const id=crypto.randomUUID(),origin=location.origin;
 return new Promise((resolve,reject)=>{
  const receive=event=>{
   if(event.source!==window||event.origin!==origin||event.data?.type!=='KATIE_MANUAL_QUEUE_RESPONSE'||event.data.id!==id)return;
   clearTimeout(timer);
   window.removeEventListener('message',receive);
   const response=event.data.response;
   if(response?.ok)resolve(response);
   else reject(Error(response?.error||'Rozszerzenie odrzuciło polecenie kolejki.'));
  };
  const timer=setTimeout(()=>{
   window.removeEventListener('message',receive);
   reject(Error('Brak odpowiedzi Kaśka Outreach. Sprawdź rozszerzenie i odśwież kartę.'));
  },['login','campaign-login'].includes(command)?45000:5000);
  window.addEventListener('message',receive);
  window.postMessage({type:'KATIE_MANUAL_QUEUE_REQUEST',id,command,campaignId,messageId,csrf:state.csrf},origin);
 });
}

function manualQueueRunSummary(task){
 const label=translateUiText;
 if(task.mode==='steps')return label('Zapisane kroki');
 if(task.mode!=='agent')return '';
 const parts=[label('Agent AI')];
 if(task.timing){
  const {aiRequests,decisions={},staleDecisions,repeatedDecisions}=task.timing;
  parts.push(`${label('Wywołania AI')} ${aiRequests}`);
  const actions={click:'Kliknięcia',fill:'Wypełnianie pól',pressEnter:'Zatwierdzanie',send:'Wysyłanie',wait:'Oczekiwanie',done:'Zakończenie',stop:'Wstrzymanie'};
  for(const [action,title] of Object.entries(actions)){
   if(decisions[action])parts.push(`${label(title)} ${decisions[action]}`);
  }
  if(staleDecisions)parts.push(`${label('Nieaktualne decyzje')} ${staleDecisions}`);
  if(repeatedDecisions)parts.push(`${label('Powtórzone decyzje')} ${repeatedDecisions}`);
 }
 return parts.join(' · ');
}

const manualProgressMarkup='<label class="manual-queue-progress-bar"><span data-no-translate></span><progress></progress></label>';
const manualQueueLayoutKey='kaska-manual-queue-layout';
function manualQueueLayout(){
 try{return localStorage.getItem(manualQueueLayoutKey)==='tiles'?'tiles':'list'}catch{return 'list'}
}
function setManualQueueLayout(root,layout){
 root.querySelector('[data-manual-queue-runs]').dataset.layout=layout;
 for(const button of root.querySelectorAll('[data-manual-queue-layout]')){
  button.setAttribute('aria-pressed',String(button.dataset.manualQueueLayout===layout));
 }
}
function updateManualProgress(root,label,value,max,showCount=true){
 const [caption,bar]=root.children;
 const title=translateUiText(label);
 let text=title;
 if(value!==undefined&&max>0){
  if(showCount)text+=` ${value}/${max} · ${progressPercent(value,max)}`;
  else if(value===max)text+=` · ${progressPercent(value,max)}`;
 }
 if(caption.textContent!==text)caption.textContent=text;
 if(bar.getAttribute('aria-label')!==title)bar.setAttribute('aria-label',title);
 if(bar.max!==max)bar.max=max;
 if(value===undefined)bar.removeAttribute('value');
 else if(!bar.hasAttribute('value')||bar.value!==value)bar.value=value;
}

function updateManualAgentProgress(bar,details,task){
 const {milestones,completed}=task.progress||{};
 details.hidden=!milestones?.length;
 if(details.hidden){
  if(task.status==='done'){
   updateManualProgress(bar,task.dryRun?'Próba zakończona':'Scenariusz zakończony',1,1,false);
   return;
  }
  const running=task.status==='running';
  updateManualProgress(bar,running?'Ustalam czynności scenariusza…':'Brak danych o postępie',running?undefined:0,1,false);
  return;
 }
 updateManualProgress(bar,'Wykonane czynności',completed.length,milestones.length);
 const labels=milestones.map(({label},index)=>`${label} · ${translateUiText(completed.includes(index+1)?'Wykonano':'Do wykonania')}`);
 const list=details.querySelector('ol'),signature=JSON.stringify(labels);
 if(list.dataset.signature===signature)return;
 list.dataset.signature=signature;
 list.replaceChildren(...labels.map(label=>{
  const item=document.createElement('li');
  item.textContent=label;
  return item;
 }));
}

function updateManualWaitCountdown(countdown){
 const deadline=Number(countdown.dataset.pageWaitUntil);
 const hidden=!deadline;
 if(countdown.hidden!==hidden)countdown.hidden=hidden;
 if(!deadline)return;
 const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));
 const time=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 const text=`${translateUiText('Pozostały czas oczekiwania')} ${time}`;
 if(countdown.textContent!==text)countdown.textContent=text;
}

function updateManualQueueProgress(root,runs){
 const aggregate=root.querySelector('[data-manual-queue-progress]');
 aggregate.hidden=!runs.length;
 if(!runs.length)return;
 const [progress,counts,activity]=aggregate.children;
 const active=runs.filter(task=>task.status==='running');
 const done=runs.filter(task=>task.status==='done').length;
 const waiting=runs.filter(task=>task.status==='queued').length;
 const attention=runs.filter(task=>['paused','needs_review'].includes(task.status)).length;
 updateManualProgress(progress,'Ukończone zadania',done,runs.length);
 const totals=[['W trakcie',active.length],['Oczekuje',waiting],['Wstrzymane lub do sprawdzenia',attention]]
  .map(([label,count])=>`${translateUiText(label)} ${count}`).join(' · ');
 const current=active.map(task=>[task.contactName,task.detail].filter(Boolean).join(' · ')).join('\n');
 if(counts.textContent!==totals)counts.textContent=totals;
 if(activity.textContent!==current)activity.textContent=current;
 activity.hidden=!current;
}

function renderManualQueueRuns(campaignId,runs){
 const root=$('#campaign-manual-queue');
 if(!root||Number(root.dataset.campaignId)!==campaignId)return;
 const w=campaignWorkspace(campaignId);
 w.manualRuns=runs;
 w.manualQueueError=false;
 updateManualWorkspaceStatus(w);
 const list=root.querySelector('[data-manual-queue-runs]');
 const notice=root.querySelector('[data-manual-queue-notice]');
 const rows=new Map([...list.children].map(row=>[Number(row.dataset.runId),row]));
 const labels={queued:'Oczekuje',running:'W trakcie',paused:'Wstrzymano',needs_review:'Wymaga sprawdzenia',done:'Zakończono'};
 updateManualQueueProgress(root,runs);
 notice.hidden=runs.length>0;
 const emptyLabel=translateUiText('Nie ma jeszcze uruchomionych zadań.');
 if(!notice.hidden&&notice.textContent!==emptyLabel)notice.textContent=emptyLabel;
 const ordered=[...runs.filter(task=>task.status==='running'),...runs.filter(task=>task.status!=='running')];
 let nextRow=list.firstElementChild;
 for(const task of ordered){
  let row=rows.get(task.id);
  if(!row){
   row=document.createElement('article');
   row.className='signal-card';
   row.dataset.runId=task.id;
   row.innerHTML=`<div class="panel-head"><strong data-no-translate></strong><span data-no-translate></span></div><p class="hint" data-no-translate></p><p class="hint manual-wait-countdown" data-no-translate hidden></p>${manualProgressMarkup}<details class="manual-queue-progress-details" hidden><summary>Czynności scenariusza</summary><ol data-no-translate></ol></details><p class="hint" data-no-translate></p><div class="actions"></div>`;
  }
  if(row!==nextRow)list.insertBefore(row,nextRow);
  nextRow=row.nextElementSibling;
  rows.delete(task.id);
  row.dataset.active=String(task.status==='running');
  const tileStatus=task.failed===true?'error':task.status;
  if(row.dataset.status!==tileStatus)row.dataset.status=tileStatus;
  const status=[translateUiText(labels[task.status]||''),task.dryRun?translateUiText('Próba'):'',
   task.headless?translateUiText('Tryb headless'):''].filter(Boolean).join(' · ');
  const summary=manualQueueRunSummary(task);
  const [head,detail,countdown,progress,progressDetails,summaryLine,actions]=row.children;
  const [contact,statusLine]=head.children;
  const description=[task.detail,task.headless?translateUiText('Przeglądarka nie jest widoczna.'):''].filter(Boolean).join(' ');
  for(const [element,value] of [[contact,task.contactName||''],[statusLine,status],[detail,description],[summaryLine,summary]]){
   if(element.textContent!==value)element.textContent=value;
  }
  summaryLine.hidden=!summary;
  if(task.status==='running'&&task.pageWaitUntil)countdown.dataset.pageWaitUntil=task.pageWaitUntil;
  else delete countdown.dataset.pageWaitUntil;
  updateManualWaitCountdown(countdown);
  progress.classList.toggle('manual-queue-progress-error',task.failed===true);
  if(task.mode==='agent')updateManualAgentProgress(progress,progressDetails,task);
  else{
   progressDetails.hidden=true;
   if(task.totalSteps)updateManualProgress(progress,'Wykonane kroki',task.completedSteps,task.totalSteps);
   else updateManualProgress(progress,'Postęp zadania',task.status==='running'?undefined:Number(task.status==='done'),1);
  }
  const buttons=`
   ${!task.headless&&task.tabId!==undefined?`<button class="secondary" data-manual-queue-command="open" data-message-id="${task.id}">Otwórz kartę</button>`:''}
   ${task.headless&&['paused','needs_review'].includes(task.status)?`<button class="secondary" data-manual-queue-command="login" data-message-id="${task.id}">Zaloguj się w profilu headless</button>`:''}
   ${task.status==='paused'?`<button class="primary" data-manual-queue-command="resume" data-message-id="${task.id}">Wznów zadanie</button>`:''}
   ${task.dryRun&&['needs_review','done'].includes(task.status)?`<button class="secondary" data-manual-queue-command="resume" data-message-id="${task.id}">Ponów próbę</button>`:''}
   ${task.status==='needs_review'&&!task.dryRun?`<button class="secondary" data-manual-queue-command="complete" data-message-id="${task.id}">Oznacz jako wysłane</button>`:''}`;
  if(actions.dataset.buttons!==buttons){actions.dataset.buttons=buttons;actions.innerHTML=buttons}
 }
 for(const row of rows.values())row.remove();
}

async function manualQueueAction(command,campaignId,messageId){
 if(command==='pause')await api('campaign/status',{id:campaignId,status:'paused'});
 try{
  const result=await requestManualQueue(command,campaignId,messageId);
  if(command==='start'||command==='resume-paused'){
   if(command==='resume-paused'){
    if(result.count)toast(`${translateUiText('Wznowione scenariusze:')} ${result.count}.`);
    else if(result.attention)toast(translateUiText('Wstrzymane scenariusze wymagają sprawdzenia w kolejce.'));
    else toast(translateUiText('Brak wstrzymanych scenariuszy gotowych do wznowienia.'));
   }
   else if(result.count)toast(`${translateUiText('Zadania przekazane do kolejki:')} ${result.count}.`);
   else if(result.alreadyRunning||result.runs?.some(task=>['queued','running'].includes(task.status)))toast(translateUiText('Kolejka już pracuje.'));
   else if(result.attention||result.runs?.some(task=>['paused','needs_review'].includes(task.status)))toast(translateUiText('Zadania wymagają wznowienia lub sprawdzenia w kolejce scenariuszy.'));
   else toast(translateUiText('Brak nowych gotowych zadań.'));
   if(view==='campaigns'&&selectedCampaign===campaignId&&$('#campaign-manual-queue')){
    const workspace=campaignWorkspace(campaignId);
    workspace.tab='manual-queue';
    updateCampaignTab(workspace);
   }
  }
  if(command==='resume'&&!result.count)toast('Zadanie nie jest gotowe do wznowienia.');
  if(command==='login')toast('Po zalogowaniu zamknij okno Chrome i wznów zadanie.');
  renderManualQueueRuns(campaignId,result.runs);
 }finally{
  if(command==='pause')await refresh();
 }
}

const manualQueuePolling=new WeakSet();
function updateManualWorkspaceStatus(w){
 if(view!=='campaigns'||selectedCampaign!==w.id)return;
 const campaign=state.campaigns.find(c=>c.id===w.id);
 const label=$('[data-manual-workspace-status]');
 if(!campaign||!label)return;
 const data=w.data;
 label.textContent=translateUiText(campaignWorkspaceStatus(campaign,w,data?.summary,data?.delivery));
 label.previousElementSibling.classList.toggle('active',manualQueueActive(w));
}
async function refreshManualQueue(){
 const root=$('#campaign-manual-queue');
 if(!root||document.hidden||manualQueuePolling.has(root))return;
 manualQueuePolling.add(root);
 const campaignId=Number(root.dataset.campaignId);
 try{
  const result=await requestManualQueue('status',campaignId);
  if(root.isConnected)renderManualQueueRuns(campaignId,result.runs);
 }catch(error){
  if(!root.isConnected)return;
  const w=campaignWorkspace(campaignId);
  w.manualQueueError=true;
  updateManualWorkspaceStatus(w);
  const notice=root.querySelector('[data-manual-queue-notice]');
  notice.hidden=false;
  if(notice.textContent!==error.message)notice.textContent=error.message;
 }finally{manualQueuePolling.delete(root)}
}
setInterval(refreshManualQueue,2500);
setInterval(()=>{
 const root=$('#campaign-manual-queue');
 if(!root||root.hidden||document.hidden)return;
 for(const countdown of root.querySelectorAll('[data-page-wait-until]'))updateManualWaitCountdown(countdown);
},500);

document.addEventListener('click',event=>{
 const restart=event.target.closest('[data-campaign-restart]');
 if(restart){confirmCampaignRestart(Number(restart.dataset.campaignRestart));return}
 const classic=event.target.closest('[data-linkedin-campaign-start]');
 if(classic){void run(classic,()=>showCampaignPreflight(Number(classic.dataset.linkedinCampaignStart)));return}
 const reprepare=event.target.closest('[data-campaign-reprepare]');
 if(reprepare){confirmCampaignReprepare(Number(reprepare.dataset.campaignReprepare));return}
 const button=event.target.closest('[data-manual-queue-command], [data-manual-campaign-start]');
 if(!button)return;
 const campaignId=Number(button.dataset.manualCampaignStart||$('#campaign-manual-queue')?.dataset.campaignId);
 if(!campaignId)return;
 void run(button,()=>button.dataset.manualCampaignStart?showCampaignPreflight(campaignId,button.dataset.manualStartMode):
  manualQueueAction(button.dataset.manualQueueCommand,campaignId,Number(button.dataset.messageId)||undefined));
});
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-manual-queue-layout]');
 const root=button?.closest('#campaign-manual-queue');
 if(!root)return;
 const layout=button.dataset.manualQueueLayout;
 setManualQueueLayout(root,layout);
 try{localStorage.setItem(manualQueueLayoutKey,layout)}catch{}
});
function renderCampaignWorkspace(c){
 const w=campaignWorkspace(c.id),data=campaignWorkspaceData(w);
 const manual=!monitoringSimulation&&c.channel==='manual';
 if(manual&&$('#campaign-manual-queue')?.dataset.workspaceKey===w.key){
  const messages=campaignMessagePage(c.id);
  if(!messages.loading&&!messages.polling&&!messages.busy)void loadCampaignMessages(c.id,{silent:true});
  else void loadCampaignWorkspace(c.id);
  return;
 }
 const tabs=[['recipients','Odbiorcy'],['sequence','Sekwencja'],['messages','Wiadomości'],['results','Wyniki']];
 if(manual)tabs.push(['manual-queue','Kolejka scenariuszy']);
 if(!tabs.some(([tab])=>tab===w.tab))w.tab='recipients';
 $('#content').innerHTML=`<button class="link" data-action="back">← Wszystkie kampanie</button>
  <section id="campaign-workspace-header"></section>
  <div id="campaign-workspace-error">${campaignWorkspaceError(w)}</div>
  <div class="campaign-tabs" role="tablist" aria-label="${esc(translateUiText('Widoki kampanii'))}">${tabs.map(([tab,label],index)=>`<button type="button" id="campaign-tab-${tab}" role="tab" data-campaign-tab="${tab}" aria-controls="campaign-${tab}"><span class="tab-step-number" aria-hidden="true">${index+1}</span><span>${label}</span></button>`).join('')}</div>
  ${tabs.map(([tab,label])=>`<section class="panel campaign-tab-panel" id="campaign-${tab}" data-campaign-id="${c.id}" role="tabpanel" aria-labelledby="campaign-tab-${tab}" hidden>
   ${tab==='manual-queue'?`
    <div class="panel-head manual-queue-header">
     <h2>${label}</h2>
     <div class="manual-queue-layout" role="group" aria-label="${esc(translateUiText('Widok kolejki'))}">
      <button type="button" class="secondary" data-manual-queue-layout="list">Lista</button>
      <button type="button" class="secondary" data-manual-queue-layout="tiles">Kafelki</button>
     </div>
    </div>
    <div data-manual-queue-progress hidden>${manualProgressMarkup}<p class="hint" data-no-translate></p><p class="hint manual-queue-activity" data-no-translate hidden></p></div>
    <p class="hint" data-manual-queue-notice role="status">${esc(translateUiText('Wczytuję kolejkę…'))}</p>
    <div data-manual-queue-runs></div>`:''}
  </section>`).join('')}`;
 if(manual){
  const queue=$('#campaign-manual-queue');
  queue.dataset.workspaceKey=w.key;
  setManualQueueLayout(queue,manualQueueLayout());
 }
 renderCampaignWorkspaceHeader(c,w,data);renderCampaignRecipients(w,data);renderCampaignSequence(c,data);renderCampaignResults(data);updateCampaignTab(w);mountCampaignMessages(c);loadCampaignWorkspace(c.id);
}
function updateCampaignTab(w){
 for(const button of document.querySelectorAll('[data-campaign-tab]')){const selected=button.dataset.campaignTab===w.tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$('#'+button.getAttribute('aria-controls')).hidden=!selected}
 void refreshManualQueue();
}
async function loadCampaignWorkspace(id){
 const w=campaignWorkspace(id),token=++w.request;w.controller?.abort();w.controller=new AbortController();w.loading=true;w.error='';
 if(view==='campaigns'&&selectedCampaign===id)renderCampaignWorkspaceHeader(state.campaigns.find(c=>c.id===id),w,campaignWorkspaceData(w));
 try{
  const response=await fetch('/api/campaign/workspace?'+new URLSearchParams({campaign_id:id,page:w.page,page_size:w.size}),{signal:w.controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error);
  if(token!==w.request||state.seller_project.id!==w.projectId||simulationEpoch!==w.epoch)return;
  w.data=data;w.page=data.page;
  if(w.awaitReview&&w.tab==='messages'&&campaignMessagePage(id).loaded&&!campaignMessagePage(id).loading){rememberCampaignReview(w);w.awaitReview=false}
 }catch(error){if(token===w.request&&error.name!=='AbortError')w.error=error.message}
 finally{if(token===w.request){w.loading=false;if(state.seller_project.id===w.projectId&&simulationEpoch===w.epoch)renderCampaignWorkspaceLive(id)}}
}
function renderCampaignWorkspaceLive(id){
 if(view!=='campaigns'||selectedCampaign!==id||!$('#campaign-workspace-header'))return;
 const c=state.campaigns.find(c=>c.id===id);if(!c)return;
 const w=campaignWorkspace(id),data=campaignWorkspaceData(w);
 renderCampaignWorkspaceHeader(c,w,data);$('#campaign-workspace-error').innerHTML=campaignWorkspaceError(w);
 if(!document.activeElement?.closest('#campaign-recipients'))renderCampaignRecipients(w,data);
 renderCampaignSequence(c,data);renderCampaignResults(data);renderCampaignMessageContactTiles(w,data);syncLanguages();
}
function campaignWorkspaceMessage(id){if(!selectedCampaign)return null;const w=campaignWorkspace(selectedCampaign);for(const person of campaignWorkspaceData(w)?.recipients||[]){const message=person.messages.find(message=>message.id===id);if(message)return message}return null}
async function changeCampaignRecipient(w,contactId,action){
 if(w.projectId!==state.seller_project.id||w.epoch!==simulationEpoch)throw Error('Zmieniono projekt lub tryb aplikacji.');
 await api('campaign/recipients/'+action,{id:w.id,contact_id:contactId,project_id:w.projectId});
 if(action==='remove'){
  w.open.delete(contactId);
  const simulation=monitoringSimulation?deliverySimulationRuns(w.projectId)[w.id]:null;
  if(simulation){
   simulation.messages=simulation.messages.filter(message=>message.contact_id!==contactId);
   simulation.replies=simulation.replies.filter(reply=>reply.contact_id!==contactId);
   saveSimulationResults();
  }
  if(!monitoringSimulation&&state.campaigns.find(c=>c.id===w.id)?.channel==='manual'){
   void requestManualQueue('sync-removed',w.id).then(result=>renderManualQueueRuns(w.id,result.runs)).catch(()=>{});
  }
 }
 $('#modal').close();
 await refresh();
 toast(translateUiText(action==='add'?'Dodano odbiorcę. Przygotuj dla niego wiadomości.':'Usunięto odbiorcę z kampanii.'));
}
function showCampaignRecipientPicker(w){
 modal(`<h2>Dodaj do kampanii</h2><form id="campaign-recipient-picker">
  <label for="campaign-recipient-query">Szukaj kontaktu</label>
  <input id="campaign-recipient-query" type="search" maxlength="200">
  <label for="campaign-recipient-option">Kontakt</label>
  <select id="campaign-recipient-option" required></select>
  <p class="hint" role="status"></p><p class="error" role="alert"></p>
  <div class="actions"><button type="submit" class="primary" disabled>Dodaj do kampanii</button><button type="button" class="secondary close">Anuluj</button></div>
 </form>`);
 const form=$('#campaign-recipient-picker'),query=form.querySelector('input'),options=form.querySelector('select');
 const submit=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]'),error=form.querySelector('[role=alert]');
 let request=0,timer;
 async function search(){
  const token=++request;
  try{
   const response=await fetch('/api/campaign/recipient-options?'+new URLSearchParams({campaign_id:w.id,q:query.value}));
   const data=await response.json();
   if(!response.ok)throw Error(data.error);
   if(token!==request||!form.isConnected)return;
   options.replaceChildren(new Option(translateUiText('Wybierz kontakt'),''),
    ...data.contacts.map(contact=>new Option([contact.name,contact.email,contact.company].filter(Boolean).join(' · '),contact.id)));
   status.textContent=data.contacts.length===40?translateUiText('Wpisz nazwę, firmę lub e-mail, aby zawęzić listę.'):
    data.contacts.length?'':translateUiText('Brak pasujących kontaktów.');
  }catch(failure){if(token===request&&form.isConnected)error.textContent=failure.message}
 }
 query.oninput=()=>{
  request++;
  clearTimeout(timer);
  options.replaceChildren();
  submit.disabled=true;
  error.textContent='';
  timer=setTimeout(search,200);
 };
 options.onchange=()=>{submit.disabled=!options.value;error.textContent=''};
 form.onsubmit=event=>{
  event.preventDefault();
  const contactId=Number(options.value);
  if(!contactId)return;
  void run(submit,async()=>{
   try{await changeCampaignRecipient(w,contactId,'add')}
   catch(failure){error.textContent=translateUiText(failure.message)}
  });
 };
 void search();
 syncLanguages();
}
function confirmCampaignRecipientRemoval(w,person){
 modal(`<h2>Usunąć odbiorcę z kampanii?</h2><p><strong data-no-translate>${esc(person.name||person.email)}</strong></p>
  <p>Oczekujące kroki tej osoby zostaną anulowane. Kontakt i historia wysłanych wiadomości pozostaną zapisane.</p>
  <p class="error" role="alert"></p><div class="actions"><button type="button" class="primary" data-confirm-campaign-recipient-remove>Usuń z kampanii</button>
  <button type="button" class="secondary close">Anuluj</button></div>`);
 const confirm=$('[data-confirm-campaign-recipient-remove]'),error=$('#modal [role=alert]');
 confirm.onclick=()=>void run(confirm,async()=>{
  try{await changeCampaignRecipient(w,person.id,'remove')}
  catch(failure){error.textContent=translateUiText(failure.message)}
 });
 syncLanguages();
}
document.addEventListener('click',event=>{
 if(view!=='campaigns'||!selectedCampaign)return;
 const w=campaignWorkspace(selectedCampaign),button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.matches('[data-campaign-recipient-add]'))showCampaignRecipientPicker(w);
 if(button.matches('[data-campaign-recipient-remove]')){
  const person=w.data?.recipients.find(person=>person.id===Number(button.dataset.campaignRecipientRemove));
  if(person)confirmCampaignRecipientRemoval(w,person);
 }
 if(button.matches('[data-campaign-tab],[data-campaign-review]')){w.tab=button.dataset.campaignTab||'messages';w.awaitReview=false;if(w.tab==='messages'){if(w.data&&campaignMessagePage(w.id).loaded&&!campaignMessagePage(w.id).loading)rememberCampaignReview(w);else w.awaitReview=true}updateCampaignTab(w);renderCampaignWorkspaceHeader(state.campaigns.find(c=>c.id===selectedCampaign),w,campaignWorkspaceData(w));syncLanguages()}
 if(button.matches('[data-campaign-recipient-page], [data-campaign-message-contact-page]')){w.page=Number(button.dataset.campaignRecipientPage??button.dataset.campaignMessageContactPage);document.activeElement?.blur();loadCampaignWorkspace(w.id)}
 if(button.matches('[data-campaign-workspace-retry]'))loadCampaignWorkspace(w.id);
});
document.addEventListener('change',event=>{if(event.target.matches('[data-campaign-recipient-size], [data-campaign-message-contact-size]')){const w=campaignWorkspace(selectedCampaign);w.size=Number(event.target.value);w.page=1;event.target.blur();loadCampaignWorkspace(w.id)}});
document.addEventListener('toggle',event=>{const node=event.target;if(node.matches?.('[data-campaign-person]')&&node.isConnected){const w=campaignWorkspace(selectedCampaign),id=Number(node.dataset.campaignPerson);node.open?w.open.add(id):w.open.delete(id)}},true);
document.addEventListener('keydown',event=>{const button=event.target.closest('[data-campaign-tab]');if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll('[data-campaign-tab]')],index=tabs.indexOf(button),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus()});
