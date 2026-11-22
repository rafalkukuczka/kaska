let reportsDays=7,reportsSnapshot=null,reportsKey='',reportsLoading=false,reportsError='',reportsUpdated=0,reportsRequest=0,reportsController=null;
let reportsCostPage=1,reportsCostMetric='cost';
const reportsChartTypeKey='kaska-openai-chart-type';
let reportsChartType='area';
try{if(localStorage.getItem(reportsChartTypeKey)==='bar')reportsChartType='bar'}catch{}
function renderReports(){
 const key=state.seller_project.id+':'+reportsDays+':'+(state.simulation_generation||'');
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
 root.innerHTML=`${reportsError?`<p class="notice" role="alert">${esc(translateUiText(reportsError))}</p>`:''}<p class="hint reports-updated"><span>Stan na:</span> <time data-no-translate datetime="${new Date(data.end*1000).toISOString()}">${esc(date(data.end))}</time></p>${dashboardFlowPanel(data.flow)}${dashboardActivityPanel(true)}<section class="panel reports-campaigns"><div class="panel-head"><h2>Porównanie kampanii</h2><span class="badge gray">${data.campaigns.length}</span></div><p class="hint">Wysyłki i odbiorcy z wybranego okresu. Kolejka i wysyłki do sprawdzenia pokazują stan bieżący. Historia obejmuje również usunięte kampanie.</p><div class="table-wrap"><table><thead><tr><th>Kampania</th><th>Status</th><th>Wysłane wiadomości</th><th>Skontaktowani odbiorcy</th><th>W kolejce</th><th>Wysyłki do sprawdzenia</th></tr></thead><tbody>${data.campaigns.map(c=>`<tr data-report-campaign="${c.id}"><td data-no-translate>${c.status==='deleted'?esc(c.name):`<a class="link report-campaign-link" href="${campaignHash(c.id)}">${esc(c.name)}</a>`}</td><td>${c.status==='deleted'?'<span class="badge gray">Usunięta</span>':badge(c.status)}</td><td>${number(c.sent)}</td><td>${number(c.contacted)}</td><td>${number(c.queued)}</td><td>${number(c.uncertain)}</td></tr>`).join('')||'<tr><td colspan="6"><span class="badge gray">Brak kampanii w tym projekcie.</span></td></tr>'}</tbody></table></div><p class="hint">Odpowiedzi raportujemy dla projektu. Błąd SMTP nie oznacza potwierdzonego odbicia.</p></section>`;
 renderDashboardActivity();
 root.querySelector('.reports-campaigns').insertAdjacentHTML('beforebegin',openAIReport(data.openai_usage));
 renderLogErrorReport();
 renderOpenAIReportChart();
}

function renderLogErrorReport(){
 const report=reportsSnapshot,activity=$('#reports-content .dashboard-activity');
 if(!activity||!report?.log_errors)return;
 const existing=$('.reports-errors');
 const expanded=existing?.querySelector('details')?.open;
 const markup=logErrorReport(report,Math.max(270,activity.clientWidth-44),expanded);
 if(existing)existing.outerHTML=markup;
 else activity.insertAdjacentHTML('afterend',markup);
}

function logErrorReport(report,width,expanded){
 const start=Date.parse(activityDayKey(report.start)+'T12:00:00Z');
 const end=Date.parse(activityDayKey(report.end)+'T12:00:00Z');
 const rowCount=Math.round((end-start)/86400000)+1;
 const days=Array.from({length:rowCount},(_,index)=>new Date(start+index*86400000).toISOString().slice(0,10));
 const counts=new Map(days.map(day=>[day,0]));
 for(const [timestamp,count] of report.log_errors){
  const day=activityDayKey(timestamp);
  if(counts.has(day))counts.set(day,counts.get(day)+count);
 }
 const total=[...counts.values()].reduce((sum,count)=>sum+count,0);
 const number=new Intl.NumberFormat(uiLanguage==='en'?'en-GB':'pl-PL');
 const dateLabel=new Intl.DateTimeFormat(uiLanguage==='en'?'en-GB':'pl-PL',{day:'numeric',month:'short',timeZone:'UTC'});
 const label=day=>dateLabel.format(new Date(day+'T12:00:00Z'));
 const left=42,right=width-20,top=12,bottom=146,step=Math.max(1,Math.ceil(Math.max(...counts.values())/4));
 const y=count=>bottom-count/(step*4)*(bottom-top);
 const slot=(right-left)/days.length,barWidth=Math.min(32,slot*.72);
 const x=index=>left+slot*(index+.5);
 const grid=Array.from({length:5},(_,index)=>{
  const value=index*step,height=y(value);
  return `<line class="activity-grid" x1="${left}" x2="${right}" y1="${height}" y2="${height}"/>
   <text x="${left-8}" y="${height+4}" text-anchor="end">${number.format(value)}</text>`;
 }).join('');
 const bars=days.map((day,index)=>{
  const count=counts.get(day);
  return count?`<rect class="reports-error-bar" x="${x(index)-barWidth/2}" y="${y(count)}" width="${barWidth}" height="${bottom-y(count)}">
   <title>${esc(label(day))} · ${number.format(count)}</title></rect>`:'';
 }).join('');
 const ticks=[...new Set([0,Math.round((days.length-1)/3),Math.round((days.length-1)*2/3),days.length-1])]
  .map(index=>`<text x="${x(index)}" y="170" text-anchor="${index===0?'start':index===days.length-1?'end':'middle'}">${esc(label(days[index]))}</text>`).join('');
 return `<section class="panel reports-errors" aria-labelledby="reports-errors-title">
  <div class="panel-head"><div><h2 id="reports-errors-title">Błędy z dziennika</h2>
   <p class="hint">Wpisy z całej aplikacji według dnia · czas polski</p></div>
   <p class="activity-legend"><span>Łącznie</span> <strong data-log-error-total>${number.format(total)}</strong></p></div>
  ${total?`<svg viewBox="0 0 ${width} 178" role="img" aria-label="${esc(translateUiText('Dzienna liczba błędów'))}">${grid}${bars}${ticks}</svg>
   <details class="activity-data" ${expanded?'open':''}><summary>Dane wykresu</summary><div class="table-wrap"><table><thead><tr><th>Data</th><th>Błędy</th></tr></thead>
   <tbody>${days.map(day=>`<tr><td data-no-translate>${esc(label(day))}</td><td>${number.format(counts.get(day))}</td></tr>`).join('')}</tbody></table></div></details>`:
   '<p class="hint">Brak błędów w tym okresie.</p>'}
 </section>`;
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
    ${requests.length?`<div class="reports-ai-chart-controls">
    <label class="reports-ai-metric" for="reports-ai-metric"><span>Wykres</span><select id="reports-ai-metric">
      <option value="cost" ${reportsCostMetric==='cost'?'selected':''}>Koszt zapytania</option>
      <option value="duration" ${reportsCostMetric==='duration'?'selected':''}>Czas odpowiedzi</option>
    </select></label>
    <label class="reports-ai-metric" for="reports-ai-chart-type"><span>Typ wykresu</span><select id="reports-ai-chart-type">
      <option value="bar" ${reportsChartType==='bar'?'selected':''}>Słupkowy</option>
      <option value="area" ${reportsChartType==='area'?'selected':''}>Liniowy z wypełnieniem</option>
    </select></label></div>`:''}</div>
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
 const isBar=reportsChartType==='bar';
 const value=row=>isCost?(row.cost_usd===null?null:Number(row.cost_usd)):row.duration_ms===null?null:row.duration_ms/1000;
 const ordered=[...rows].reverse();
 const values=ordered.map(value);
 const measured=values.filter(amount=>amount!==null);
 if(!measured.length){
  root.innerHTML=`<p class="hint">${isCost?'Brak wycenionych zapytań na tej stronie.':'Brak pomiarów czasu na tej stronie.'}</p>`;
  return;
 }
 const locale=uiLanguage==='en'?'en-GB':'pl-PL';
 const number=new Intl.NumberFormat(locale,{maximumFractionDigits:isCost?8:3});
 const cost=openAIUsdFormatter(locale),axis=translateUiText(isCost?'USD za zapytanie':'Sekundy na zapytanie');
 const width=Math.max(280,root.clientWidth||700),height=250,left=width<480?62:82,right=15,top=26,bottom=37;
 const plotWidth=width-left-right,plotHeight=height-top-bottom;
 const start=rows.at(-1).created,end=rows[0].created,span=end-start;
 const ceiling=Math.max(...measured)||(isCost?0.00000001:0.01);
 const baseline=top+plotHeight,slot=plotWidth/rows.length,barWidth=Math.min(28,slot*.76);
 const timeX=stamp=>left+(span?(stamp-start)/span:.5)*plotWidth;
 const barX=index=>left+(index+.5)*slot;
 const y=amount=>baseline-amount/ceiling*plotHeight;
 const when=new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',
  ...(span<3600?{second:'2-digit'}:{}),timeZone:'Europe/Warsaw'});
 const grid=Array.from({length:5},(_,index)=>{
  const amount=ceiling*index/4;
  return `<line x1="${left}" x2="${width-right}" y1="${y(amount)}" y2="${y(amount)}" class="activity-grid"/>
    <text x="${left-8}" y="${y(amount)+4}" text-anchor="end">${esc(number.format(amount))}</text>`;
 }).join('');
 const fractions=span?(width<530||(isBar&&rows.length<3)?[0,1]:[0,.5,1]):[.5];
 const ticks=fractions.map(fraction=>{
  const index=Math.round((rows.length-1)*fraction);
  const stamp=isBar?ordered[index].created:start+span*fraction;
  const position=isBar&&span?barX(index):timeX(stamp);
  const anchor=fraction===0?'start':fraction===1?'end':'middle';
  return `<text x="${position}" y="${height-9}" text-anchor="${anchor}">${esc(when.format(new Date(stamp*1000)))}</text>`;
 }).join('');
 const marks=ordered.map((row,index)=>{
  const amount=values[index];if(amount===null)return '';
  const title=`<title>${esc(`${when.format(new Date(row.created*1000))} · ${openAIUsageLabel(row)} · ${cost(row.cost_usd)} · ${number.format(row.input_tokens+row.output_tokens)} ${translateUiText('tokenów')}${row.duration_ms===null?'':' · '+number.format(row.duration_ms/1000)+' s'}`)}</title>`;
  if(isBar){
   const barHeight=Math.max(1,baseline-y(amount));
   return `<rect class="reports-ai-bar" x="${barX(index)-barWidth/2}" y="${baseline-barHeight}" width="${barWidth}" height="${barHeight}">${title}</rect>`;
  }
  return `<circle class="reports-ai-point" cx="${timeX(row.created)}" cy="${y(amount)}" r="4">${title}</circle>`;
 }).join('');
 const series=[];
 if(!isBar){
  let segment=[];
  for(let index=0;index<values.length;index++){
   if(values[index]===null){if(segment.length)series.push(segment);segment=[];continue}
   segment.push([timeX(ordered[index].created),y(values[index])]);
  }
  if(segment.length)series.push(segment);
 }
 const lines=series.filter(segment=>segment.length>1).map(segment=>{
  const line=segment.join(' ');
  return `<polygon class="reports-ai-area" points="${segment[0][0]},${baseline} ${line} ${segment.at(-1)[0]},${baseline}"/>
    <polyline class="reports-ai-line" points="${line}"/>`;
 }).join('');
 root.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(axis)}">
  <text x="${left}" y="13">${esc(axis)}</text>${grid}${ticks}
  ${lines}${marks}</svg>${isBar?`<p class="hint reports-ai-order">${esc(translateUiText('Zapytania w kolejności wykonania'))}</p>`:''}`;
}

document.addEventListener('change',event=>{
 if(event.target.id==='reports-ai-metric')reportsCostMetric=event.target.value;
 else if(event.target.id==='reports-ai-chart-type'){
  reportsChartType=event.target.value;
  try{localStorage.setItem(reportsChartTypeKey,reportsChartType)}catch{}
 }else return;
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
 if(view==='reports'&&state)openAIChartResize=requestAnimationFrame(()=>{
  renderOpenAIReportChart();
  renderLogErrorReport();
  syncLanguages();
 });
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
