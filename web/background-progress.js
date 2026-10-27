const backgroundRequests=new Map();
let backgroundRequestId=0,backgroundJobs=[],backgroundPolling=false,backgroundTimer;
const backgroundLabels={
 'campaign/messages/delete':'Usuwanie wiadomości',
 'contacts/tags/bulk':'Przypisywanie tagów do kontaktów',
 'discover/contacts/search':'Wyszukiwanie kontaktów firmy', 'discover/contacts/add':'Dodawanie kontaktów do grupy', 'discover/contacts/add-simulation':'Zapisywanie kontaktów z symulacji',
 'contact/group':'Zapisywanie grupy kontaktu',
 'ai/suggest-audience':'Przygotowywanie filtra wyszukiwania',
 'signals/monitoring/delete':'Usuwanie monitoringu',
 'research':'Odczyt strony i oferty','ai/refine':'Poprawianie tekstu z AI',
 'ai/selling-points':'Przygotowywanie problemów i wartości','ai/proof-points':'Odczyt dowodów ze strony',
 'ai/step-prompt':'Przygotowywanie kroku kampanii','signals/scan':'Skanowanie źródeł',
 'signals/monitoring/propose':'Dobieranie sygnałów do oferty','signals/monitoring/companies':'Ocena firm ze zdarzenia',
 'campaign/prepare':'Przygotowywanie wiadomości','prospecting/search':'Uruchamianie wyszukiwania klientów',
 'prospecting/verify':'Uruchamianie weryfikacji adresów','prospecting/draft':'Uruchamianie tworzenia szkiców',
 'signals/discovery/start':'Uruchamianie konfiguracji źródeł','signals/discovery/cancel':'Przerywanie konfiguracji',
 'integrations/openai':'Sprawdzanie OpenAI','integrations/gmail':'Sprawdzanie Gmail','sync':'Odczyt odpowiedzi'
};
function beginBackgroundRequest(path){
 if(path==='seller-project')return null;
 const id=++backgroundRequestId;
 backgroundRequests.set(id,{id:'request-'+id,path,label:backgroundLabels[path]||'Trwa operacja…',project_name:state?.seller_project?.name,started:Date.now()});
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
 const review=typeof discoverReview!=='undefined'&&discoverReview.running?discoverReview:null;
 const rows=[...[...backgroundRequests.values()].filter(row=>!review||row.path!=='signals/monitoring/companies'),...backgroundJobs.filter(job=>job.kind!=='discovery'||!$('#discovery-active-banner'))];
 if(review)rows.push({id:'company-review',label:'Ocena firm ze zdarzeń',completed:review.completed,total:review.total});
 if(!rows.length&&!$('#discovery-active-banner')){
   const panel=$('#background-progress');panel?.backgroundObserver?.disconnect();panel?.remove();document.documentElement.style.setProperty('--background-progress-height','0px');return;
 }
 const panel=backgroundProgressHost(),list=panel.querySelector('#background-progress-list');
 list.innerHTML=rows.map(row=>{
   const total=Number(row.total),counted=Number.isFinite(total)&&total>0,completed=counted?Math.min(total,Math.max(0,Number(row.completed)||0)):0;
   const label=row.label||(row.kind==='discovery'?'Konfiguracja źródeł z AI':({searching:'Szukanie klientów',verifying:'Weryfikacja emaili',drafting:'Tworzenie szkiców'}[row.status]||'Trwa operacja…'));
   const percent=counted?Math.floor(completed/total*100):null;
   return `<div class="background-progress-row" role="status" data-background-task="${esc(row.id)}"><div class="background-progress-heading"><strong>${esc(translateUiText(label))}</strong>${counted?`<span>${completed} / ${total} · ${percent}%</span>`:'<span class="background-working">W trakcie…</span>'}</div>${row.stage||row.project_name?`<p><span>${esc(row.stage||'')}</span>${row.project_name?` · <span data-no-translate>${esc(row.project_name)}</span>`:''}</p>`:''}<progress aria-label="${esc(translateUiText(label))}" ${counted?`max="${total}" value="${completed}"`:''}></progress></div>`;
 }).join('');
}
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
setInterval(()=>{if(backgroundJobs.length||backgroundRequests.size||state?.prospecting?.runs.some(r=>['searching','verifying','drafting'].includes(r.status)))pollBackgroundProgress().catch(()=>{})},3000);
document.addEventListener('DOMContentLoaded',()=>pollBackgroundProgress().catch(()=>{}));
