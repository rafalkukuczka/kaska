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
function campaignWorkspaceStatus(c,summary){
 if(c.status==='active')return monitoringSimulation?'Symulacja w toku':'Wysyłka w toku';
 if((summary?.counts.uncertain||0)>0)return 'Wymaga uwagi';
 if(c.status==='paused')return 'Wysyłka wstrzymana';
 return summary?.messages?'Wiadomości przygotowane':'Do przygotowania';
}
function campaignMainAction(c,w,summary){
 const pending=[...backgroundRequests.values()].some(request=>['campaign/prepare','campaign/status','campaign/update'].includes(request.path));
 const disabled=pending||(c.status!=='active'&&(!summary||w.loading||!!w.error||w.data.revision!==c.revision));
 const button=(label,attrs)=>`<button type="button" class="primary" ${attrs} ${disabled?'disabled':''}>${label}</button>`;
 if(c.status==='active')return button(monitoringSimulation?'Wstrzymaj symulację':'Wstrzymaj wysyłkę',`data-action="campaign-status" data-id="${c.id}" data-status="paused"`);
 if(!summary)return button('Wczytuję kampanię…','');
 if(!summary.messages)return summary.signal_audience?button('Konfiguruj regułę','data-view="signals"'):button('Przygotuj wiadomości',`data-action="prepare" data-id="${c.id}"`);
 if(!campaignHasReview(w))return button('Sprawdź wiadomości','data-campaign-review');
 if(!(summary.counts.queued||summary.counts.sending))return '<span class="badge gray">Brak wiadomości do wysłania</span>';
 return button(monitoringSimulation?'Symuluj wysyłkę':c.status==='paused'?'Wznów wysyłkę':'Uruchom wysyłkę',`data-action="campaign-status" data-id="${c.id}" data-status="active"`);
}
function renderCampaignWorkspaceHeader(c,w,data){
 const root=$('#campaign-workspace-header');if(!root)return;
 const summary=data?.summary;
 root.innerHTML=`<div class="topline campaign-workspace-top"><div><p class="section-label">KAMPANIA</p><h1 data-no-translate>${esc(c.name)}</h1><p class="muted" data-no-translate>${esc(c.audience||campaignAudience(c))}</p></div><div class="actions campaign-workspace-actions">${campaignMainAction(c,w,summary)}<button type="button" class="secondary" data-action="edit-campaign" data-id="${c.id}">Edytuj kampanię</button><details class="campaign-more"><summary aria-label="${esc(translateUiText('Więcej działań'))}">⋯</summary><div>${['draft','paused'].includes(c.status)&&summary?.messages?`<button type="button" class="link" data-action="prepare" data-id="${c.id}">Przygotuj wiadomości ponownie</button>`:''}<button type="button" class="link danger" data-action="delete-campaign" data-id="${c.id}">Usuń kampanię</button></div></details></div></div><div class="campaign-summary" aria-label="${esc(translateUiText('Podsumowanie kampanii'))}">${[['Odbiorcy',summary?.recipients],['Kroki',summary?.steps],['Wiadomości',summary?.messages]].map(([label,count])=>`<div><strong data-campaign-summary="${label}">${count??'—'}</strong><span>${label}</span></div>`).join('')}<div class="campaign-state"><span class="campaign-state-dot ${c.status==='active'?'active':''}"></span><strong>${campaignWorkspaceStatus(c,summary)}</strong>${monitoringSimulation?'<small>Symulacja</small>':''}</div></div>${summary&&!summary.messages&&summary.recipients?'<p class="campaign-next-step">Kontakty są wybrane. Przygotuj wiadomości, aby sprawdzić treść i uruchomić kampanię.</p>':''}`;
}
function campaignRecipientPagination(w,total){
 const pages=Math.max(1,Math.ceil(total/w.size));
 return `<div class="discover-company-pagination"><span class="hint">${total?((w.page-1)*w.size+1):0}–${Math.min(total,w.page*w.size)} / ${total}</span><label><span>Odbiorców na stronie</span><select data-campaign-recipient-size>${[10,25,50,100].map(size=>`<option ${size===w.size?'selected':''}>${size}</option>`).join('')}</select></label><div class="actions"><button class="secondary" data-campaign-recipient-page="${w.page-1}" ${w.page===1||w.loading?'disabled':''}>‹ <span>Poprzednia</span></button><span class="hint"><span>Strona</span> ${w.page} / ${pages}</span><button class="secondary" data-campaign-recipient-page="${w.page+1}" ${w.page===pages||w.loading?'disabled':''}><span>Następna</span> ›</button></div></div>`;
}
function renderCampaignRecipients(w,data){
 const root=$('#campaign-recipients');if(!root)return;
 if(!data){root.innerHTML='<p class="hint" role="status">Wczytuję odbiorców…</p>';return}
 root.innerHTML=`<div class="panel-head"><h2>Odbiorcy <span class="badge gray">${data.total}</span></h2><span class="hint">Jedna osoba, wszystkie jej wiadomości.</span></div>${campaignRecipientPagination(w,data.total)}<div class="campaign-people">${data.recipients.map(person=>`<details class="campaign-person" data-campaign-person="${person.id}" ${w.open.has(person.id)?'open':''}><summary><span class="campaign-person-chevron" aria-hidden="true">›</span><div class="campaign-person-identity"><strong data-no-translate>${esc(person.name)}</strong><small data-no-translate>${esc(person.email)}</small></div><div class="campaign-person-company" data-no-translate>${esc(person.company)}<small>${esc(person.role)}</small></div><span class="badge gray">${person.messages.length} <span>wiadomości</span></span>${badge(person.status)}</summary><div class="campaign-person-body"><div class="campaign-person-tags" data-no-translate>${person.tags.map(tag=>`<span class="badge gray">${esc(tag)}</span>`).join(' ')}</div>${person.messages.length?person.messages.map(message=>`<article class="campaign-person-message"><div><small><span>Krok</span> ${message.position+1}</small><strong data-no-translate>${esc(message.subject)}</strong><button type="button" class="link" data-action="message" data-id="${message.id}">Podgląd / edycja</button></div>${messageDeliveryProgress(message)}</article>`).join(''):'<p class="hint">Wiadomości dla tego odbiorcy nie zostały jeszcze przygotowane.</p>'}</div></details>`).join('')||empty(data.summary.signal_audience?'Odbiorców dobierze monitoring':'Brak pasujących odbiorców',data.summary.signal_audience?'Skonfiguruj regułę, aby dołączać kontakty na podstawie sygnałów.':'Sprawdź tagi, statusy kontaktów i warunki kampanii.')}</div>`;
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
 root.innerHTML=`<h2>Wyniki kampanii</h2>${monitoringSimulation?'<span class="badge warn">Symulacja</span>':''}<div class="campaign-result-metrics">${[['Wysłane wiadomości',s.sent],['Osoby, do których wysłano',s.contacted],['Odpowiedzi',s.replies],['Wskaźnik odpowiedzi',rate===null?'—':rate+'%']].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><div class="campaign-status-breakdown">${[['queued','Oczekuje na wysyłkę'],['sending','Wysyłanie'],['sent','Wysłano'],['cancelled','Zatrzymano'],['uncertain','Wymaga uwagi']].map(([status,label])=>`<div><span>${label}</span><progress max="${Math.max(1,s.messages)}" value="${s.counts[status]||0}"></progress><strong>${s.counts[status]||0}</strong></div>`).join('')}</div><p class="hint">Statystyki wysłanych wiadomości obejmują historię kampanii. Odpowiedzi są liczone po przypisaniu do tej kampanii; starsze odpowiedzi mogą nie mieć przypisania.</p>`;
}
function campaignWorkspaceError(w){return w.error?`<div class="notice" role="alert"><span data-no-translate>${esc(w.error)}</span> <button type="button" class="link" data-campaign-workspace-retry>Spróbuj ponownie</button></div>`:''}
function renderCampaignWorkspace(c){
 const w=campaignWorkspace(c.id),data=campaignWorkspaceData(w);
 $('#content').innerHTML=`<button class="link" data-action="back">← Wszystkie kampanie</button><section id="campaign-workspace-header"></section><div id="campaign-workspace-error">${campaignWorkspaceError(w)}</div><div class="campaign-tabs" role="tablist" aria-label="${esc(translateUiText('Widoki kampanii'))}">${[['recipients','Odbiorcy'],['sequence','Sekwencja'],['messages','Wiadomości'],['results','Wyniki']].map(([tab,label])=>`<button type="button" id="campaign-tab-${tab}" role="tab" data-campaign-tab="${tab}" aria-controls="${tab==='messages'?'campaign-messages':'campaign-'+tab}" aria-selected="${w.tab===tab}" tabindex="${w.tab===tab?'0':'-1'}">${label}</button>`).join('')}</div><section class="panel campaign-tab-panel" id="campaign-recipients" role="tabpanel" aria-labelledby="campaign-tab-recipients"></section><section class="panel campaign-tab-panel" id="campaign-sequence" role="tabpanel" aria-labelledby="campaign-tab-sequence"></section><section class="panel campaign-tab-panel" id="campaign-messages" data-campaign-id="${c.id}" role="tabpanel" aria-labelledby="campaign-tab-messages"></section><section class="panel campaign-tab-panel" id="campaign-results" role="tabpanel" aria-labelledby="campaign-tab-results"></section>`;
 renderCampaignWorkspaceHeader(c,w,data);renderCampaignRecipients(w,data);renderCampaignSequence(c,data);renderCampaignResults(data);updateCampaignTab(w);mountCampaignMessages(c);loadCampaignWorkspace(c.id);
}
function updateCampaignTab(w){
 for(const button of document.querySelectorAll('[data-campaign-tab]')){const selected=button.dataset.campaignTab===w.tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$('#'+button.getAttribute('aria-controls')).hidden=!selected}
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
 renderCampaignSequence(c,data);renderCampaignResults(data);syncLanguages();
}
function campaignWorkspaceMessage(id){if(!selectedCampaign)return null;const w=campaignWorkspace(selectedCampaign);for(const person of campaignWorkspaceData(w)?.recipients||[]){const message=person.messages.find(message=>message.id===id);if(message)return message}return null}
document.addEventListener('click',event=>{
 if(view!=='campaigns'||!selectedCampaign)return;
 const w=campaignWorkspace(selectedCampaign),button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.matches('[data-campaign-tab],[data-campaign-review]')){w.tab=button.dataset.campaignTab||'messages';w.awaitReview=false;if(w.tab==='messages'){if(w.data&&campaignMessagePage(w.id).loaded&&!campaignMessagePage(w.id).loading)rememberCampaignReview(w);else w.awaitReview=true}updateCampaignTab(w);renderCampaignWorkspaceHeader(state.campaigns.find(c=>c.id===selectedCampaign),w,campaignWorkspaceData(w));syncLanguages()}
 if(button.matches('[data-campaign-recipient-page]')){w.page=Number(button.dataset.campaignRecipientPage);document.activeElement?.blur();loadCampaignWorkspace(w.id)}
 if(button.matches('[data-campaign-workspace-retry]'))loadCampaignWorkspace(w.id);
});
document.addEventListener('change',event=>{if(event.target.matches('[data-campaign-recipient-size]')){const w=campaignWorkspace(selectedCampaign);w.size=Number(event.target.value);w.page=1;event.target.blur();loadCampaignWorkspace(w.id)}});
document.addEventListener('toggle',event=>{const node=event.target;if(node.matches?.('[data-campaign-person]')&&node.isConnected){const w=campaignWorkspace(selectedCampaign),id=Number(node.dataset.campaignPerson);node.open?w.open.add(id):w.open.delete(id)}},true);
document.addEventListener('keydown',event=>{const button=event.target.closest('[data-campaign-tab]');if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll('[data-campaign-tab]')],index=tabs.indexOf(button),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus()});
