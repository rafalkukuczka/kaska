let reportsDays=7,reportsSnapshot=null,reportsKey='',reportsLoading=false,reportsError='',reportsUpdated=0,reportsRequest=0,reportsController=null;
function renderReports(){
 const key=state.seller_project.id+':'+reportsDays;
 if(reportsKey!==key){reportsController?.abort();reportsRequest++;reportsKey=key;reportsSnapshot=null;reportsLoading=false;reportsError='';reportsUpdated=0}
 $('#content').innerHTML=renderTop('Raporty','Lejek kontaktu, aktywność i wyniki kampanii bieżącego projektu.')+projectContextLink()+`<section class="panel reports-toolbar"><label for="reports-days"><span>Okres raportów</span><select id="reports-days">${[7,30,90].map(days=>`<option value="${days}" ${days===reportsDays?'selected':''}>${days} ${esc(translateUiText('dni'))}</option>`).join('')}</select></label><button type="button" class="secondary" id="reports-refresh" ${reportsLoading?'disabled':''}>Odśwież raporty</button><span class="badge gray">Dane rzeczywiste</span><p class="hint">Raporty pomijają symulację. Zaangażowanie i odbicia wymagają osobnego pomiaru.</p></section><div id="reports-content"></div>`;
 $('#reports-days').onchange=event=>{reportsDays=Number(event.target.value);renderReports()};
 $('#reports-refresh').onclick=()=>{reportsError='';reportsUpdated=0;loadReports()};
 renderReportsContent();
 if(!reportsLoading&&!reportsError&&Date.now()-reportsUpdated>30000)loadReports();
}
function renderReportsContent(){
 const root=$('#reports-content');if(!root||view!=='reports')return;
 if(!reportsSnapshot){root.innerHTML=reportsError?`<p class="notice" role="alert">${esc(translateUiText(reportsError))}</p>`:'<p class="hint" role="status">Wczytywanie raportów…</p>';return}
 const data=reportsSnapshot,number=value=>new Intl.NumberFormat(uiLanguage==='en'?'en-GB':'pl-PL').format(value);
 root.innerHTML=`${reportsError?`<p class="notice" role="alert">${esc(translateUiText(reportsError))}</p>`:''}<p class="hint reports-updated"><span>Stan na:</span> <time data-no-translate datetime="${new Date(data.end*1000).toISOString()}">${esc(date(data.end))}</time></p>${dashboardFlowPanel(data.flow)}${dashboardActivityPanel(true)}<section class="panel reports-campaigns"><div class="panel-head"><h2>Porównanie kampanii</h2><span class="badge gray">${data.campaigns.length}</span></div><p class="hint">Wysyłki i odbiorcy z wybranego okresu. Kolejka i wysyłki do sprawdzenia pokazują stan bieżący. Historia obejmuje również usunięte kampanie.</p><div class="table-wrap"><table><thead><tr><th>Kampania</th><th>Status</th><th>Wysłane wiadomości</th><th>Skontaktowani odbiorcy</th><th>W kolejce</th><th>Wysyłki do sprawdzenia</th></tr></thead><tbody>${data.campaigns.map(c=>`<tr data-report-campaign="${c.id}"><td data-no-translate>${esc(c.name)}</td><td>${c.status==='deleted'?'<span class="badge gray">Usunięta</span>':badge(c.status)}</td><td>${number(c.sent)}</td><td>${number(c.contacted)}</td><td>${number(c.queued)}</td><td>${number(c.uncertain)}</td></tr>`).join('')||'<tr><td colspan="6"><span class="badge gray">Brak kampanii w tym projekcie.</span></td></tr>'}</tbody></table></div><p class="hint">Odpowiedzi raportujemy dla projektu. Błąd SMTP nie oznacza potwierdzonego odbicia.</p></section>`;
 renderDashboardActivity();
}
async function loadReports(){
 if(reportsLoading)return;
 reportsLoading=true;reportsError='';
 const request=++reportsRequest,key=reportsKey,projectId=state.seller_project.id;
 reportsController=new AbortController();
 const button=$('#reports-refresh');if(button)button.disabled=true;
 try{
  const response=await fetch('/api/reports?'+new URLSearchParams({days:reportsDays}),{signal:reportsController.signal}),data=await response.json();
  if(!response.ok)throw Error(data.error);
  if(request!==reportsRequest||key!==reportsKey||projectId!==state.seller_project.id)return;
  if(data.project_id!==projectId)throw Error('Zmieniono projekt. Odśwież raporty.');
  reportsSnapshot=data;reportsUpdated=Date.now();
 }catch(error){if(error.name!=='AbortError'&&request===reportsRequest)reportsError='Nie udało się wczytać raportów. Spróbuj ponownie.'}
 finally{
  if(request===reportsRequest){reportsLoading=false;if(view==='reports'){renderReportsContent();const current=$('#reports-refresh');if(current)current.disabled=false;syncLanguages()}}
 }
}
