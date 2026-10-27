let dashboardActivityDays=30;
function dashboardFlowPanel(metrics=state.dashboard_flow||{}){
 const days=metrics.days||7,locale=uiLanguage==='en'?'en-GB':'pl-PL';
 const count=value=>Number.isFinite(value)?new Intl.NumberFormat(locale).format(value):'—';
 const percent=value=>Number.isFinite(value)?new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(value)+'%':'—';
 const cards=[
  ['potential','Potencjalni odbiorcy',count(metrics.potential),'Aktywne, rzeczywiste kontakty z puli projektu, do których nie wysłano jeszcze wiadomości w tym projekcie. Stan bieżący.'],
  ['contacted','Skontaktowani odbiorcy',count(metrics.contacted),'Unikalni odbiorcy z potwierdzoną wysyłką SMTP w tym projekcie w ostatnich 7 dniach. Follow-upy nie zwiększają liczby osób.'],
  ['engagement','Zaangażowanie',percent(metrics.engagement_rate),'Brak pomiaru otwarć i kliknięć. Odpowiedzi pokazujemy osobno.'],
  ['reply','Wskaźnik odpowiedzi',percent(metrics.reply_rate),'Odsetek skontaktowanych odbiorców z ostatnich 7 dni, od których otrzymano odpowiedź po wysyłce. Każda osoba jest liczona raz.'],
  ['bounce','Wskaźnik odbić',percent(metrics.bounce_rate),'Brak rejestracji potwierdzonych odbić poczty. Błędy SMTP i wyniki weryfikacji adresów nie są liczone jako odbicia.']
 ];
 return `<section class="dashboard-flow" aria-label="${esc(translateUiText('Twój lejek kontaktu'))}"><div class="panel-head"><div><h2>Twój lejek kontaktu</h2><p class="hint">${esc(translateUiText('Ostatnie 7 dni · pula odbiorców: stan bieżący').replace('7',String(days)))}</p></div><span class="badge gray">Dane rzeczywiste</span></div><div class="flow-metrics">${cards.map(([key,label,value,help])=>`<article class="flow-metric" data-flow-metric="${key}"><div class="flow-metric-heading"><i class="flow-metric-dot" aria-hidden="true"></i><span>${esc(translateUiText(label))}</span><details class="flow-metric-help"><summary aria-label="${esc(translateUiText('Jak liczymy ten wskaźnik?')+' '+translateUiText(label))}">ⓘ</summary><p>${esc(translateUiText(help).replaceAll('7',String(days)))}</p></details></div><div class="flow-metric-value"><strong>${value}</strong>${value==='—'?`<small>${esc(translateUiText(key==='reply'&&!metrics.contacted?'Brak wysyłek w tym okresie':'Brak danych'))}</small>`:key==='reply'?`<small>${count(metrics.replied)} / ${count(metrics.contacted)}</small>`:''}</div></article>`).join('')}</div></section>`;
}
const activityDayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'});
function activityDayKey(timestamp){
 const parts=Object.fromEntries(activityDayFormatter.formatToParts(new Date(timestamp*1000)).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
function dashboardActivitySeries(now=Date.now(),options={}){
 const today=activityDayKey(now/1000),end=Date.parse(today+'T12:00:00Z');
 const days=options.start?Math.round((end-Date.parse(activityDayKey(options.start)+'T12:00:00Z'))/86400000)+1:dashboardActivityDays;
 const rows=Array.from({length:days},(_,index)=>({day:new Date(end-(days-1-index)*86400000).toISOString().slice(0,10),sent:0,replies:0}));
 const byDay=new Map(rows.map(row=>[row.day,row]));
 function add(kind,timestamp,count=1){if(!Number.isFinite(timestamp)||timestamp>now/1000)return;const row=byDay.get(activityDayKey(timestamp));if(row)row[kind]+=count}
 if(monitoringSimulation&&!options.real){
  for(const run of Object.values(deliverySimulationRuns()))for(const message of run.messages)if(message.status==='sent'&&['queued','sending'].includes(message.original_status))add('sent',message.sent_at);
  for(const reply of state.replies)if(reply.simulated)add('replies',reply.received);
 }else{
  for(const kind of ['sent','replies'])for(const [timestamp,count] of (options.activity||state.dashboard_activity)?.[kind]||[])add(kind,timestamp,count);
 }
 return rows;
}
function dashboardActivityPanel(report=false){
 return `<section class="panel dashboard-activity"><div class="panel-head"><div><h2>Wiadomości i odpowiedzi</h2><p class="hint">Dane dzienne bieżącego projektu · czas polski</p></div>${report?'':`<label class="activity-range"><span>Okres</span><select id="dashboard-activity-range">${[7,30,90].map(days=>`<option value="${days}" ${dashboardActivityDays===days?'selected':''}>${days} ${esc(translateUiText('dni'))}</option>`).join('')}</select></label>`}</div><div id="dashboard-activity-chart"></div></section>`;
}
function renderDashboardActivity(){
 const root=document.querySelector('#dashboard-activity-chart');if(!root)return;
 const report=view==='reports'&&typeof reportsSnapshot!=='undefined'?reportsSnapshot:null;
 const rows=dashboardActivitySeries(Date.now(),report?{activity:report.activity,real:true,start:report.start}:{}),totals=rows.reduce((sum,row)=>({sent:sum.sent+row.sent,replies:sum.replies+row.replies}),{sent:0,replies:0});
 const width=Math.max(300,root.clientWidth||900),height=260,left=42,right=16,top=18,bottom=38,plotWidth=width-left-right,plotHeight=height-top-bottom;
 const max=Math.max(1,...rows.flatMap(row=>[row.sent,row.replies])),step=Math.max(1,Math.ceil(max/4)),ceiling=step*4;
 const x=index=>left+index*plotWidth/(rows.length-1),y=count=>top+plotHeight-count/ceiling*plotHeight;
 const number=value=>Number(value.toFixed(2)),label=day=>new Intl.DateTimeFormat(uiLanguage==='en'?'en-GB':'pl-PL',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
 const grid=Array.from({length:5},(_,index)=>{const value=index*step;return `<line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}" class="activity-grid"/><text x="${left-10}" y="${y(value)+4}" text-anchor="end">${value}</text>`}).join('');
 const ticks=[...new Set([0,Math.round((rows.length-1)/3),Math.round((rows.length-1)*2/3),rows.length-1])].map(index=>`<text x="${x(index)}" y="${height-12}" text-anchor="${index===0?'start':index===rows.length-1?'end':'middle'}">${esc(label(rows[index].day))}</text>`).join('');
 const lines=['sent','replies'].map(kind=>`<polyline class="activity-line activity-${kind}" points="${rows.map((row,index)=>`${number(x(index))},${number(y(row[kind]))}`).join(' ')}"/>`).join('');
 const points=rows.map((row,index)=>`<g><title>${esc(label(row.day))}: ${esc(translateUiText('Wysłane wiadomości'))} ${row.sent}, ${esc(translateUiText('Odpowiedzi'))} ${row.replies}</title><rect x="${x(index)-plotWidth/rows.length/2}" y="${top}" width="${plotWidth/rows.length}" height="${plotHeight}" fill="transparent"/>${['sent','replies'].map(kind=>`<circle class="activity-point activity-${kind}" cx="${x(index)}" cy="${y(row[kind])}" r="${rows.length<=7?3:2}"/>`).join('')}</g>`).join('');
 root.innerHTML=`<div class="activity-legend"><span><i class="activity-swatch activity-sent"></i><span>Wysłane wiadomości</span> <strong data-activity-total="sent">${totals.sent}</strong></span><span><i class="activity-swatch activity-replies"></i><span>Odpowiedzi</span> <strong data-activity-total="replies">${totals.replies}</strong></span>${monitoringSimulation&&!report?'<span class="badge warn">Symulacja</span>':''}</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(translateUiText('Wysłane wiadomości'))}: ${totals.sent}; ${esc(translateUiText('Odpowiedzi'))}: ${totals.replies}">${grid}${ticks}${lines}${points}</svg>${totals.sent||totals.replies?'':'<p class="hint activity-empty">Brak wysłanych wiadomości i odpowiedzi w wybranym okresie.</p>'}<details class="activity-data"><summary>Dane wykresu</summary><div class="table-wrap"><table><thead><tr><th>Data</th><th>Wysłane wiadomości</th><th>Odpowiedzi</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.day}</td><td>${row.sent}</td><td>${row.replies}</td></tr>`).join('')}</tbody></table></div></details>`;
 const range=document.querySelector('#dashboard-activity-range');if(range)range.onchange=event=>{dashboardActivityDays=Number(event.target.value);renderDashboardActivity();syncLanguages()};
}
let dashboardChartResize;
window.addEventListener('resize',()=>{cancelAnimationFrame(dashboardChartResize);dashboardChartResize=requestAnimationFrame(()=>{if(['dashboard','reports'].includes(view))renderDashboardActivity()})});
