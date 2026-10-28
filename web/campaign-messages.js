const campaignMessagePages=new Map();
function campaignMessagePage(id){
 if(!campaignMessagePages.has(id))campaignMessagePages.set(id,{page:1,size:25,total:0,messages:[],selected:new Set(),bulk:false,busy:false,loading:false,loaded:false,sequence:0,error:''});
 return campaignMessagePages.get(id);
}
function findCampaignMessage(id){return [...campaignMessagePages.values()].flatMap(page=>page.messages).find(message=>message.id===id)||state.messages.find(message=>message.id===id)}
function messageDeliveryProgress(message){
 const status=message.status;
 const scheduled=status==='queued'&&!message.delivery_simulated&&message.due>Date.now()/1000&&state.campaigns.find(c=>c.id===message.campaign_id)?.status==='active';
 const schedule=scheduled?`<small class="message-send-schedule"><span>Zaplanowano:</span> <time datetime="${new Date(message.due*1000).toISOString()}">${esc(new Intl.DateTimeFormat(uiLanguage==='en'?'en-GB':'pl-PL',{timeZone:'Europe/Warsaw',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(message.due*1000)))}</time></small>`:'';
 const label=status==='sending'?'Wysyłanie…':status==='sent'?(message.delivery_simulated?'Wysłano w symulacji':'Przekazano do serwera pocztowego'):status==='queued'?'Oczekuje na wysyłkę':status==='uncertain'?'Status wysyłki niepotwierdzony':'Wysyłka zatrzymana';
 const progress=['queued','sending','sent'].includes(status)?`<progress max="100" ${status==='sending'?'':`value="${status==='sent'?100:0}"`} aria-label="${esc(translateUiText(label))}"></progress>`:'<span class="message-delivery-track" aria-hidden="true"></span>';
 return `<div class="message-delivery message-delivery-${esc(status)}" data-message-progress="${message.id}">${badge(status)}${message.delivery_replied?badge('replied'):''}${message.delivery_simulated?'<span class="badge warn">Symulacja</span>':''}<div class="message-delivery-bar">${progress}${status==='sent'?'<small>100%</small>':status==='queued'?'<small>0%</small>':''}</div><small title="${esc(translateUiText(label))}">${esc(translateUiText(label))}</small>${schedule}</div>`;
}
function campaignMessagesPagination(p){
 const pages=Math.max(1,Math.ceil(p.total/p.size));
 return `<div class="discover-company-pagination"><label><span>Wiadomości na stronie</span><select data-message-page-size ${p.busy?'disabled':''}>${[10,25,50,100].map(size=>`<option value="${size}" ${p.size===size?'selected':''}>${size}</option>`).join('')}</select></label><div class="actions"><button class="secondary" data-message-page="1" ${p.page===1||p.loading||p.busy?'disabled':''}>« <span>Pierwsza</span></button><button class="secondary" data-message-page="${p.page-1}" ${p.page===1||p.loading||p.busy?'disabled':''}>‹ <span>Poprzednia</span></button><span class="hint"><span>Strona</span> ${p.page} / ${pages}</span><button class="secondary" data-message-page="${p.page+1}" ${p.page===pages||p.loading||p.busy?'disabled':''}><span>Następna</span> ›</button><button class="secondary" data-message-page="${pages}" ${p.page===pages||p.loading||p.busy?'disabled':''}><span>Ostatnia</span> »</button></div></div>`;
}
function renderCampaignMessages(id){
 const root=$('#campaign-messages');if(!root||Number(root.dataset.campaignId)!==id)return;
 const p=campaignMessagePage(id),campaign=state.campaigns.find(c=>c.id===id);if(!campaign)return;
 const busy=p.busy||p.loading,visible=p.messages.filter(m=>m.status!=='sending'),selected=visible.filter(m=>p.selected.has(m.id)).length;
 root.innerHTML=`<h2><span>Wiadomości</span> · ${p.total}</h2>${p.error?`<p class="error" role="alert" data-no-translate>${esc(p.error)}</p><button class="secondary" data-message-retry>Spróbuj ponownie</button>`:''}${p.loading?'<p class="hint" role="status">Wczytuję wiadomości…</p>':''}${p.loaded&&(!p.loading||p.total)?`<label class="contact-bulk-toggle"><input type="checkbox" data-message-bulk-toggle ${p.bulk?'checked':''} ${busy?'disabled':''}><span>Operacje zbiorcze</span></label>${p.bulk?`<div class="actions message-bulk-actions"><span><span>Zaznaczono wiadomości:</span> <strong>${p.selected.size}</strong></span><button class="link" data-message-clear ${busy||!p.selected.size?'disabled':''}>Odznacz wszystkie</button><button class="secondary danger" data-message-delete ${busy||!p.selected.size||campaign.status==='active'?'disabled':''}>Usuń zaznaczone</button></div>${campaign.status==='active'?'<p class="hint">Wstrzymaj kampanię przed usunięciem wiadomości.</p>':''}`:''}${p.total?campaignMessagesPagination(p)+`<div class="table-wrap"><table><thead><tr>${p.bulk?`<th class="contact-bulk-check"><input type="checkbox" data-message-all aria-label="${esc(translateUiText('Zaznacz wszystkie widoczne wiadomości'))}" ${visible.length&&selected===visible.length?'checked':''} ${busy||!visible.length?'disabled':''}></th>`:''}<th>Odbiorca</th><th>Temat</th><th>Krok</th><th>Status</th><th></th></tr></thead><tbody>${p.messages.map(m=>`<tr>${p.bulk?`<td class="contact-bulk-check"><input type="checkbox" data-message-select="${m.id}" aria-label="${esc(translateUiText('Zaznacz wiadomość'))}" ${p.selected.has(m.id)?'checked':''} ${busy||m.status==='sending'?'disabled':''}></td>`:''}<td>${esc(m.email)}</td><td>${esc(m.subject)}${m.error?`<small class="error">${esc(m.error)}</small>`:''}</td><td>${m.position+1}</td><td>${messageDeliveryProgress(m)}</td><td><button class="link" data-action="message" data-id="${m.id}">Podgląd / edycja</button></td></tr>`).join('')}</tbody></table></div>`:empty('Najpierw przygotuj wiadomości','Powstaną osobne szkice dla każdego odbiorcy i kroku.'+(['draft','paused'].includes(campaign.status)?`<div class="actions campaign-empty-actions"><button type="button" class="primary" data-action="prepare" data-id="${id}">Przygotuj wiadomości</button></div>`:''))}`:''}`;
 const all=root.querySelector('[data-message-all]');if(all)all.indeterminate=selected>0&&selected<visible.length;
}
async function loadCampaignMessages(id,{silent=false}={}){
 const p=campaignMessagePage(id),sequence=++p.sequence;p.error='';
 if(silent)p.polling=true;else{p.loading=true;renderCampaignMessages(id)}
 try{
  const response=await fetch('/api/campaign/messages?'+new URLSearchParams({campaign_id:id,page:p.page,page_size:p.size}));
  let data=await response.json();if(!response.ok)throw Error(data.error);
  data=simulationCampaignMessagePage(id,data);
  if(p.sequence!==sequence)return;
  Object.assign(p,{messages:data.messages,total:data.total,page:data.page,loaded:true});
 }catch(error){if(p.sequence===sequence){p.error=error.message;if(!silent)p.loaded=false}}
 finally{if(silent)p.polling=false;if(p.sequence===sequence){p.loading=false;renderCampaignMessages(id)}}
}
function mountCampaignMessages(campaign){renderCampaignMessages(campaign.id);loadCampaignMessages(campaign.id)}
setInterval(()=>{
 if(document.hidden||view!=='campaigns'||!selectedCampaign||$('#modal').open)return;
 const p=campaignMessagePage(selectedCampaign),campaign=state?.campaigns.find(c=>c.id===selectedCampaign);
 if(!p.loaded||p.busy||p.loading||p.polling)return;
 if(campaign?.status==='active'||p.messages.some(message=>message.status==='sending'))loadCampaignMessages(selectedCampaign,{silent:true});
},2000);
document.addEventListener('change',event=>{
 if(!event.target.closest('#campaign-messages'))return;
 const p=campaignMessagePage(selectedCampaign);if(p.busy||p.loading)return;
 if(event.target.matches('[data-message-bulk-toggle]')){p.bulk=event.target.checked;p.selected.clear()}
 if(event.target.matches('[data-message-select]')){const id=Number(event.target.dataset.messageSelect);event.target.checked?p.selected.add(id):p.selected.delete(id)}
 if(event.target.matches('[data-message-all]'))for(const message of p.messages.filter(m=>m.status!=='sending'))event.target.checked?p.selected.add(message.id):p.selected.delete(message.id);
 if(event.target.matches('[data-message-page-size]')){p.size=Number(event.target.value);p.page=1;loadCampaignMessages(selectedCampaign);return}
 renderCampaignMessages(selectedCampaign);
});
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button?.closest('#campaign-messages'))return;
 const id=selectedCampaign,p=campaignMessagePage(id);if(p.busy||p.loading)return;
 if(button.matches('[data-message-page]')){p.page=Number(button.dataset.messagePage);loadCampaignMessages(id)}
 if(button.matches('[data-message-retry]'))loadCampaignMessages(id);
 if(button.matches('[data-message-clear]')){p.selected.clear();renderCampaignMessages(id)}
 if(button.matches('[data-message-delete]')){
  const ids=[...p.selected];if(!ids.length)return;
  modal(`<h2>Usunąć zaznaczone wiadomości?</h2><p><span>Liczba wiadomości:</span> ${ids.length}</p><p>Usunięcie oczekującej wiadomości anuluje dalsze oczekujące kroki dla tego odbiorcy. Historia wysłanych wiadomości pozostaje w systemie.</p><div class="actions"><button class="primary" type="button" data-confirm-message-delete>Usuń wiadomości</button><button class="secondary close" type="button">Anuluj</button></div><p class="error" role="alert" data-message-delete-error></p>`);
  $('[data-confirm-message-delete]').onclick=event=>run(event.currentTarget,async()=>{
   p.busy=true;renderCampaignMessages(id);
   try{await api('campaign/messages/delete',{campaign_id:id,ids});p.selected.clear();$('#modal').close();await refresh();toast(translateUiText('Wiadomości usunięte.'))}
   catch(error){$('[data-message-delete-error]').textContent=error.message;throw error}
   finally{p.busy=false;renderCampaignMessages(id)}
  });
 }
});
