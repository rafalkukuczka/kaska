let reportsDays=7,reportsSnapshot=null,reportsKey='',reportsLoading=false,reportsError='',reportsUpdated=0,reportsRequest=0,reportsController=null;
let reportsCostPage=1,reportsCostMetric='cost';
function renderReports(){
 const key=state.seller_project.id+':'+reportsDays;
 if(reportsKey!==key){reportsController?.abort();reportsRequest++;reportsKey=key;reportsSnapshot=null;reportsLoading=false;reportsError='';reportsUpdated=0;reportsCostPage=1}
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
 root.querySelector('.reports-campaigns').insertAdjacentHTML('beforebegin',openAIReport(data.openai_usage));
 renderOpenAIReportChart();
}

function openAIReport(report){
 if(!report)return '';
 const {totals,requests,page,pages}=report;
 const locale=uiLanguage==='en'?'en-GB':'pl-PL';
 const cost=openAIUsdFormatter(locale);
 const number=value=>new Intl.NumberFormat(locale).format(value);
 const timestamp=new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',
  second:'2-digit',timeZone:'Europe/Warsaw'});
 return `<section class="panel reports-openai">
  <div class="panel-head"><h2>Koszty OpenAI</h2>
    ${requests.length?`<label class="reports-ai-metric" for="reports-ai-metric"><span>Wykres</span><select id="reports-ai-metric">
      <option value="cost" ${reportsCostMetric==='cost'?'selected':''}>Koszt zapytania</option>
      <option value="duration" ${reportsCostMetric==='duration'?'selected':''}>Czas odpowiedzi</option>
    </select></label>`:''}</div>
  ${totals.calls?`<div class="activity-legend reports-ai-totals">
    <span><span>Zapytania</span> <strong>${number(totals.calls)}</strong></span>
    <span><span>Tokeny</span> <strong>${number(totals.input_tokens+totals.output_tokens)}</strong></span>
    <span><span>Szacunkowy koszt</span> <strong data-no-translate>${esc(cost(totals.calls===totals.unpriced?null:totals.cost_usd))}</strong></span>
    ${totals.unpriced?`<span><span>Zapytania bez wyceny</span> <strong>${number(totals.unpriced)}</strong></span>`:''}</div>
    <div id="reports-ai-chart"></div>
    ${pages>1?`<div class="actions reports-ai-pages"><button type="button" class="secondary" data-ai-cost-page="${page-1}" ${page===1?'disabled':''}>Nowsze</button>
      <span class="hint"><span>Strona</span> ${page} / ${pages}</span><button type="button" class="secondary" data-ai-cost-page="${page+1}" ${page===pages?'disabled':''}>Starsze</button></div>`:''}
    <details class="activity-data"><summary>Dane zapytań</summary><div class="table-wrap"><table><thead><tr>
      <th>Czas zapytania</th><th>Operacja</th><th>Model</th><th>Tokeny</th><th>Czas odpowiedzi</th><th>Koszt zapytania</th>
      </tr></thead><tbody>${requests.map(row=>`<tr>
        <td data-no-translate>${esc(timestamp.format(new Date(row.created*1000)))}</td><td data-no-translate>${esc(openAIUsageLabel(row))}</td>
        <td data-no-translate>${esc(row.model)}</td><td>${number(row.input_tokens+row.output_tokens)}</td>
        <td data-no-translate>${row.duration_ms===null?'—':number(row.duration_ms/1000)+' s'}</td>
        <td data-no-translate>${esc(cost(row.cost_usd))}</td></tr>`).join('')}</tbody></table></div></details>`:
    '<p class="hint">Brak zapisanych zapytań OpenAI w tym okresie.</p>'}
 </section>`;
}

function renderOpenAIReportChart(){
 const root=$('#reports-ai-chart'),rows=reportsSnapshot?.openai_usage?.requests;
 if(!root||!rows?.length)return;
 const isCost=reportsCostMetric==='cost';
 const value=row=>isCost?(row.cost_usd===null?null:Number(row.cost_usd)):row.duration_ms===null?null:row.duration_ms/1000;
 const points=rows.filter(row=>value(row)!==null);
 if(!points.length){
  root.innerHTML=`<p class="hint">${isCost?'Brak wycenionych zapytań na tej stronie.':'Brak pomiarów czasu na tej stronie.'}</p>`;
  return;
 }
 const locale=uiLanguage==='en'?'en-GB':'pl-PL';
 const number=new Intl.NumberFormat(locale,{maximumFractionDigits:isCost?8:3});
 const cost=openAIUsdFormatter(locale),axis=translateUiText(isCost?'USD za zapytanie':'Sekundy na zapytanie');
 const width=Math.max(280,root.clientWidth||700),height=250,left=width<480?62:82,right=15,top=26,bottom=37;
 const plotWidth=width-left-right,plotHeight=height-top-bottom;
 const start=rows.at(-1).created,end=rows[0].created,span=end-start;
 const ceiling=Math.max(...points.map(value))||(isCost?0.00000001:0.01);
 const x=stamp=>left+(span?(stamp-start)/span:.5)*plotWidth;
 const y=amount=>top+plotHeight-amount/ceiling*plotHeight;
 const when=new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',
  ...(span<3600?{second:'2-digit'}:{}),timeZone:'Europe/Warsaw'});
 const grid=Array.from({length:5},(_,index)=>{
  const amount=ceiling*index/4;
  return `<line x1="${left}" x2="${width-right}" y1="${y(amount)}" y2="${y(amount)}" class="activity-grid"/>
    <text x="${left-8}" y="${y(amount)+4}" text-anchor="end">${esc(number.format(amount))}</text>`;
 }).join('');
 const ticks=(span?(width<530?[0,1]:[0,.5,1]):[.5]).map(fraction=>
  `<text x="${left+fraction*plotWidth}" y="${height-9}" text-anchor="${fraction===0?'start':fraction===1?'end':'middle'}">${esc(when.format(new Date((start+span*fraction)*1000)))}</text>`).join('');
 const marks=points.map(row=>`<circle class="reports-ai-point" cx="${x(row.created)}" cy="${y(value(row))}" r="4"><title>${esc(
  `${when.format(new Date(row.created*1000))} · ${openAIUsageLabel(row)} · ${cost(row.cost_usd)} · ${number.format(row.input_tokens+row.output_tokens)} ${translateUiText('tokenów')}${row.duration_ms===null?'':' · '+number.format(row.duration_ms/1000)+' s'}`
 )}</title></circle>`).join('');
 const line=[...points].reverse().map(row=>`${x(row.created)},${y(value(row))}`).join(' ');
 root.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(axis)}">
  <text x="${left}" y="13">${esc(axis)}</text>${grid}${ticks}
  <polyline class="reports-ai-line" points="${line}"/>${marks}</svg>`;
}

document.addEventListener('change',event=>{
 if(event.target.id!=='reports-ai-metric')return;
 reportsCostMetric=event.target.value;
 renderOpenAIReportChart();
 syncLanguages();
});
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-ai-cost-page]');
 if(!button||reportsLoading)return;
 reportsCostPage=Number(button.dataset.aiCostPage);
 loadReports();
});
let openAIChartResize;
window.addEventListener('resize',()=>{
 cancelAnimationFrame(openAIChartResize);
 if(view==='reports')openAIChartResize=requestAnimationFrame(renderOpenAIReportChart);
});
async function loadReports(){
 if(reportsLoading)return;
 reportsLoading=true;reportsError='';
 const request=++reportsRequest,key=reportsKey,projectId=state.seller_project.id;
 reportsController=new AbortController();
 const button=$('#reports-refresh');if(button)button.disabled=true;
 try{
  const response=await fetch('/api/reports?'+new URLSearchParams({days:reportsDays,cost_page:reportsCostPage}),{signal:reportsController.signal}),data=await response.json();
  if(!response.ok)throw Error(data.error);
  if(request!==reportsRequest||key!==reportsKey||projectId!==state.seller_project.id)return;
  if(data.project_id!==projectId)throw Error('Zmieniono projekt. Odśwież raporty.');
  if(data.openai_usage)reportsCostPage=data.openai_usage.page;
  reportsSnapshot=data;reportsUpdated=Date.now();
 }catch(error){if(error.name!=='AbortError'&&request===reportsRequest)reportsError='Nie udało się wczytać raportów. Spróbuj ponownie.'}
 finally{
  if(request===reportsRequest){reportsLoading=false;if(view==='reports'){renderReportsContent();const current=$('#reports-refresh');if(current)current.disabled=false;syncLanguages()}}
 }
}
