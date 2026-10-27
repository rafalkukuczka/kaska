// Demo records exist only in the browser; they never enter the signal or campaign APIs.
let monitoringSimulation=true;
try{monitoringSimulation=localStorage.getItem('kaska-monitoring-simulation')!=='off'}catch{}
function simulationSources(){const ids=new Set((sig().monitoring?.monitors||[]).flatMap(m=>m.source_ids));return sig().sources.filter(s=>ids.has(s.id))}
function simulationSignals(source){
 const topic=JSON.parse(source.config||'{}').topic||source.company||source.name;
 const selected=JSON.parse(source.signal_kinds||'[]'),kinds=selected.length?selected:['tender','erp','hiring'];
 return Array.from({length:3},(_,index)=>{
   const company=`${translateUiText('Firma demonstracyjna')} ${source.id}.${index+1}`,kind=kinds[index%kinds.length];
   return {id:`demo-${source.id}-${index}`,source_id:source.id,company,kind,topic,title:`${company}: ${signalLabel(kind)} — ${topic}`,
     evidence:translateUiText('Przykładowe zdarzenie wygenerowane na potrzeby symulacji. Nie pochodzi z odczytu źródła.'),
     reason:translateUiText('Przykładowa okazja do rozmowy o ofercie z wybranego profilu. Wymagałaby potwierdzenia w rzeczywistym źródle.'),observed:Date.now()/1000,simulated:true};
 });
}
function allSimulationSignals(){return simulationSources().flatMap(simulationSignals)}
function simulationBanner(){return `<section class="notice simulation-banner"><div><strong>${monitoringSimulation?'Symulacja włączona':'Dane rzeczywiste'}</strong><p>${monitoringSimulation?'Każde źródło zwraca 3 przykładowe sygnały. Dane nie są zapisywane w bazie ani używane w kampaniach.':'Możesz sprawdzić wygląd wyników na 3 przykładowych sygnałach z każdego źródła.'}</p></div><button class="secondary" data-simulation-toggle>${monitoringSimulation?'Wyłącz symulację':'Włącz symulację'}</button></section>`}
function simulationSignalCards(signals){return signals.map(s=>`<article class="signal-card" data-demo-signal="${esc(s.id)}"><span class="badge warn">Symulacja</span><h3 data-no-translate>${esc(s.title)}</h3><p>${esc(s.evidence)}</p><p class="hint">${esc(s.reason)}</p></article>`).join('')}
function showSimulationSignals(signals){modal(`<h2>Sygnały symulowane</h2><p class="hint">To dane testowe. Nie można ich akceptować ani używać do wysyłki.</p>${simulationSignalCards(signals)}`)}
document.addEventListener('click',e=>{
 if(e.target.closest('[data-simulation-toggle]')){
   monitoringSimulation=!monitoringSimulation;
   try{localStorage.setItem('kaska-monitoring-simulation',monitoringSimulation?'on':'off')}catch{}
   $('#content').replaceChildren();render();return;
 }
 if(e.target.closest('[data-simulation-scan]')){renderDiscover();toast('Symulacja gotowa: 3 sygnały z każdego źródła.');return}
 const button=e.target.closest('[data-simulation-source]');if(!button)return;
 const source=simulationSources().find(s=>s.id===Number(button.dataset.simulationSource));
 if(source)showSimulationSignals(simulationSignals(source));
});
