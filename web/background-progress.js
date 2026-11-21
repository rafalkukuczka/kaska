const backgroundRequests=new Map();
const backgroundCancelPending=new Set();
let backgroundRequestId=0,backgroundJobs=[],backgroundPolling=false,backgroundTimer;
const backgroundLabels={
 'discover/opportunities/start':'Wyszukiwanie okazji','discover/opportunities/cancel':'Zatrzymywanie wyszukiwania okazji',
 'ai/translate-search-brief':'Tłumaczenie opisu wyszukiwania',
 'campaign/edit-data':'Wczytywanie kampanii','campaign/update':'Zapisywanie zmian kampanii',
 'campaign/messages/delete':'Usuwanie wiadomości',
 'contacts/tags/bulk':'Przypisywanie tagów do kontaktów',
 'contacts/parse':'Rozdzielanie danych kontaktu',
 'discover/contacts/search':'Wyszukiwanie kontaktów firmy', 'discover/contacts/add':'Dodawanie kontaktów do grupy', 'discover/contacts/add-simulation':'Zapisywanie kontaktów z symulacji',
 'lead-search/contact-search':'Wyszukiwanie kontaktów firmy', 'lead-search/contact-add':'Zapisywanie kontaktów',
 'contact/group':'Zapisywanie grupy kontaktu',
 'lead-search/start':'Wyszukiwanie firm','lead-search/job':'Praca agentów',
 'discovery-pilot/search':'Wyszukiwanie firm w Discover',
 'discovery-pilot/qualify':'Kwalifikacja firmy',
 'ai/manual-agent':'Decyzja agenta AI','ai/manual-interaction':'Przygotowywanie scenariusza',
 'extension/manual-agent':'Rozszerzenie · Decyzja agenta AI',
 'extension/generate':'Rozszerzenie · Generowanie wiadomości',
 'extension/refine':'Rozszerzenie · Poprawianie wiadomości',
 'extension/article':'Rozszerzenie · Dobór artykułu',
 'extension/translate':'Rozszerzenie · Tłumaczenie',
 'ai/suggest-audience':'Przygotowywanie filtra wyszukiwania',
 'research':'Odczyt strony i oferty','ai/refine':'Poprawianie tekstu z AI',
 'offer/generate':'Przygotowywanie oferty',
 'ai/selling-points':'Przygotowywanie problemów i wartości','ai/proof-points':'Odczyt dowodów ze strony',
 'ai/step-prompt':'Przygotowywanie kroku kampanii',
 'campaign/prepare':'Przygotowywanie wiadomości','prospecting/search':'Uruchamianie wyszukiwania klientów',
 'prospecting/verify':'Uruchamianie weryfikacji adresów','prospecting/draft':'Uruchamianie tworzenia szkiców',
 'integrations/openai':'Sprawdzanie OpenAI','integrations/gmail':'Sprawdzanie Gmail','sync':'Odczyt odpowiedzi'
};
function beginBackgroundRequest(path,data){
 if(['seller-project','background/cancel','lead-search/bell','lead-search/start','lead-search/stop-all'].includes(path))return null;
 const id=++backgroundRequestId;
 backgroundRequests.set(id,{id:'request-'+id,path,campaign_id:path==='campaign/prepare'?Number(data?.id):null,label:backgroundLabels[path]||'Trwa operacja…',project_name:state?.seller_project?.name,started:Date.now()});
 renderBackgroundProgress();return id;
}
function endBackgroundRequest(id){if(id!==null)backgroundRequests.delete(id);renderBackgroundProgress();scheduleBackgroundPoll()}
function backgroundProgressHost(){
 let panel=$('#background-progress');if(panel)return panel;
 panel=document.createElement('section');panel.id='background-progress';panel.setAttribute('role','region');panel.setAttribute('aria-label',translateUiText('Operacje w tle'));
 panel.innerHTML='<div id="background-progress-list"></div>';document.body.append(panel);
 if(typeof ResizeObserver!=='undefined'){
   const observer=new ResizeObserver(()=>document.documentElement.style.setProperty('--background-progress-height',panel.offsetHeight+32+'px'));
   observer.observe(panel);panel.backgroundObserver=observer;
 }
 return panel;
}
function renderBackgroundProgress(){
 const preparing=new Set(backgroundJobs.filter(job=>job.kind==='campaign-prepare').map(job=>job.campaign_id));
 const rows=[...[...backgroundRequests.values()].filter(request=>!preparing.has(request.campaign_id)),...backgroundJobs];
 if(!rows.length){
   const panel=$('#background-progress');panel?.backgroundObserver?.disconnect();panel?.remove();document.documentElement.style.setProperty('--background-progress-height','0px');return;
 }
 const panel=backgroundProgressHost(),list=panel.querySelector('#background-progress-list');
 const markup=rows.map(row=>{
   const total=Number(row.total),counted=Number.isFinite(total)&&total>0,completed=counted?Math.min(total,Math.max(0,Number(row.completed)||0)):0;
   const label=row.label||(row.kind==='opportunities'?'Wyszukiwanie okazji':({searching:'Szukanie klientów',verifying:'Weryfikacja emaili',drafting:'Tworzenie szkiców'}[row.status]||'Trwa operacja…'));
   const cancelling=row.status==='cancelling'||backgroundCancelPending.has(row.id);
   const action=row.cancellable?`<button type="button" class="danger link" data-background-cancel="${esc(row.id)}" ${cancelling?'disabled':''}>${esc(translateUiText(cancelling?'Przerywanie…':'Przerwij'))}</button>`:'';
   return `<div class="background-progress-row" data-background-task="${esc(row.id)}">
     <div class="background-progress-heading"><strong>${esc(translateUiText(label))}</strong>
       <div class="background-progress-actions">${counted?`<span role="status">${completed} / ${total} · ${progressPercent(completed,total)}</span>`:'<span class="background-working" role="status">W trakcie…</span>'}${action}</div>
     </div>
     ${row.stage||row.project_name?`<p>${row.stage?`<span>${esc(translateUiText(row.stage))}</span>`:''}${row.project_name?`${row.stage?' · ':''}<span data-no-translate>${esc(row.project_name)}</span>`:''}</p>`:''}
     <progress aria-label="${esc(translateUiText(label))}" ${counted?`max="${total}" value="${completed}"`:''}></progress>
   </div>`;
 }).join('');
 if(list._markup===markup)return;
 const focused=document.activeElement?.dataset.backgroundCancel;
 list.innerHTML=markup;
 list._markup=markup;
 if(focused)list.querySelector(`[data-background-cancel="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
}
document.addEventListener('click',async event=>{
 const id=event.target.closest('#background-progress [data-background-cancel]')?.dataset.backgroundCancel;
 if(!id||backgroundCancelPending.has(id))return;
 const job=backgroundJobs.find(row=>row.id===id&&row.cancellable&&row.status!=='cancelling');
 if(!job)return;
 backgroundCancelPending.add(id);
 renderBackgroundProgress();
 try{
   const result=await api('background/cancel',{id});
   const current=backgroundJobs.find(row=>row.id===id);
   if(result.ok&&current)current.status='cancelling';
 }catch(error){toast(error.message)}
 finally{
   backgroundCancelPending.delete(id);
   renderBackgroundProgress();
   scheduleBackgroundPoll();
 }
});
function scheduleBackgroundPoll(){clearTimeout(backgroundTimer);backgroundTimer=setTimeout(()=>pollBackgroundProgress().catch(()=>{}),0)}
async function pollBackgroundProgress(){
 if(backgroundPolling)return;
 backgroundPolling=true;
 try{
   const response=await fetch('/api/background');if(!response.ok)throw Error('Nie można połączyć się z aplikacją');
   backgroundJobs=(await response.json()).jobs;
   renderBackgroundProgress();
 }finally{backgroundPolling=false}
}
setInterval(()=>{if(backgroundJobs.length||backgroundRequests.size||state?.discovery_opportunities?.runs.some(r=>['running','cancelling'].includes(r.status))||state?.prospecting?.runs.some(r=>['searching','verifying','drafting','cancelling'].includes(r.status)))pollBackgroundProgress().catch(()=>{})},1500);
document.addEventListener('DOMContentLoaded',()=>pollBackgroundProgress().catch(()=>{}));

let openAIUsagePolling=false;
function openAIUsageLabel(row){
 return translateUiText(backgroundLabels[row.action]||'Operacja OpenAI')+(row.reference?' '+row.reference:'');
}
function openAIUsdFormatter(locale){
 const currency=new Intl.NumberFormat(locale,{style:'currency',currency:'USD',currencyDisplay:'code',
  minimumFractionDigits:4,maximumFractionDigits:8});
 return amount=>amount===null?translateUiText('Koszt niedostępny'):'≈ '+currency.format(Number(amount));
}
function renderOpenAIUsage(operations){
 const list=$('#openai-cost-items');
 $('#openai-cost-empty').hidden=Boolean(operations.length);
 list.hidden=!operations.length;
 const locale=uiLanguage==='en'?'en-US':'pl-PL';
 const number=new Intl.NumberFormat(locale);
 const cost=openAIUsdFormatter(locale);
 const metrics=row=>{
  const tokens=number.format(row.input_tokens+row.output_tokens);
  return `${tokens} ${translateUiText('tokenów')} · ${cost(row.cost_usd)}`;
 };
 const items=operations.map(row=>`<li><strong>${esc(openAIUsageLabel(row))}</strong><span>${esc(metrics(row))}</span>
  <small>${esc(translateUiText('Zapytania'))}: ${number.format(row.calls)} · ${number.format(row.input_tokens)} ${esc(translateUiText('wejściowych'))} · ${number.format(row.output_tokens)} ${esc(translateUiText('wyjściowych'))}
  ${row.web_calls?' · Web Search: '+number.format(row.web_calls):''}</small></li>`).join('');
 if(list._items!==items){list.innerHTML=items;list._items=items}
}
function renderBillableActivity(providers){
 const bell=$('#openai-cost-bell'),active=providers.length>0;
 const label=translateUiText(active?'API z możliwym kosztem':'Koszty OpenAI')+(active?' · '+providers.join(', '):'');
 bell.classList.toggle('billable-active',active);
 bell.title=label;
 bell.setAttribute('aria-label',label);
}
async function pollOpenAIUsage(){
 if(openAIUsagePolling||document.hidden)return;
 openAIUsagePolling=true;
 try{
  const response=await fetch('/api/openai-usage');
  if(response.ok){
   const data=await response.json();
   renderBillableActivity(data.billable_providers||[]);
   renderOpenAIUsage(data.operations);
  }
 }catch{}finally{openAIUsagePolling=false}
}
document.addEventListener('DOMContentLoaded',pollOpenAIUsage);
document.addEventListener('visibilitychange',pollOpenAIUsage);
setInterval(pollOpenAIUsage,2500);
document.addEventListener('click',event=>{
 const menu=$('#openai-cost-menu');
 if(menu.open&&!menu.contains(event.target))menu.open=false;
});
document.addEventListener('keydown',event=>{
 const menu=$('#openai-cost-menu');
 if(event.key==='Escape'&&menu.open&&!$('#modal').open){
  menu.open=false;
  $('#openai-cost-bell').focus();
 }
});
