function searchMapControls(){return `<section class="search-map-picker" data-search-map-picker><label class="check"><input type="checkbox" data-show-search-map> <span>Pokaż mapę</span></label><p class="hint" data-search-area-count></p><div data-search-map-panel hidden><p class="hint">Kliknij punkt na mapie, ustaw promień i naciśnij „Dodaj obszar”. Możesz też wpisać współrzędne.</p><div class="search-area-map" data-search-area-map role="region" aria-label="Mapa obszarów klientów"></div><p class="hint" data-search-map-status role="status"></p><div class="search-area-fields"><label>Szerokość geograficzna<input data-area-lat type="number" step="any" inputmode="decimal" placeholder="np. 52.2297"></label><label>Długość geograficzna<input data-area-lng type="number" step="any" inputmode="decimal" placeholder="np. 21.0122"></label><label>Promień (km)<input data-area-radius type="number" step="any" inputmode="decimal" value="50"></label><label>Nazwa obszaru (opcjonalnie)<input data-area-label maxlength="100" placeholder="np. Warszawa i okolice"></label></div><div class="actions"><button type="button" class="secondary" data-add-search-area>+ Dodaj obszar</button><button type="button" class="link" data-clear-search-areas>Usuń wszystkie obszary</button></div><p class="hint">Szukamy w dowolnym z dodanych obszarów. Ukrycie mapy nie usuwa obszarów.</p><p class="hint">Obszary trafiają do kryteriów wyszukiwania. Dokładne położenie znalezionych firm wymaga potwierdzenia.</p></div><div data-search-areas-list></div><input name="search_areas" type="hidden" value="[]"></section>`}
// Location only changes the viewport; an empty area list always means worldwide.
let currentMapLocation=null,currentMapLocationRequest=null;
function getCurrentMapLocation(){
 if(currentMapLocation&&Date.now()-currentMapLocation.at<300000)return Promise.resolve(currentMapLocation.coords);
 if(currentMapLocationRequest)return currentMapLocationRequest;
 currentMapLocationRequest=new Promise((resolve,reject)=>{
  if(!navigator.geolocation){reject(new Error('Geolocation unavailable'));return}
  navigator.geolocation.getCurrentPosition(position=>{
   const coords=[Math.max(-85,Math.min(85,position.coords.latitude)),position.coords.longitude];
   currentMapLocation={coords,at:Date.now()};resolve(coords);
  },reject,{enableHighAccuracy:false,timeout:8000,maximumAge:300000});
 }).finally(()=>{currentMapLocationRequest=null});
 return currentMapLocationRequest;
}
function centerWorldwideMap(map,canvas,status,isCurrent=()=>true,zoom=1){
 canvas._cancelWorldView?.();
 map.setView([0,0],zoom,{animate:false});
 if(status)status.textContent=translateUiText('Cały świat. Ustalam Twoją lokalizację…');
 let cancelled=false;
 const cancel=()=>{cancelled=true;map.off('dragstart zoomstart click',cancel);if(canvas._cancelWorldView===cancel)delete canvas._cancelWorldView};
 canvas._cancelWorldView=cancel;
 map.on('dragstart zoomstart click',cancel);
 getCurrentMapLocation().then(coords=>{
  if(cancelled||!canvas.isConnected||!isCurrent())return;
  cancel();map.invalidateSize({pan:false});map.setView(coords,zoom,{animate:false});
  if(status)status.textContent=translateUiText('Cały świat. Mapa wyśrodkowana na Twojej lokalizacji.');
 },()=>{
  if(cancelled||!canvas.isConnected||!isCurrent())return;
  cancel();if(status)status.textContent=translateUiText('Cały świat. Lokalizacja niedostępna — możesz przesunąć mapę ręcznie.');
 });
}
function readSearchAreas(form){try{const areas=JSON.parse(form.elements.search_areas?.value||'[]');return Array.isArray(areas)?areas:[]}catch{return []}}
function projectCoverageAreas(){
 const areas=new Map();
 function add(value,source){
  let rows;try{rows=typeof value==='string'?JSON.parse(value):value}catch{return}
  if(!Array.isArray(rows))return;
  for(const area of rows){
   if(!area||![area.lat,area.lng,area.radius_km].every(Number.isFinite)||Math.abs(area.lat)>90||Math.abs(area.lng)>180||area.radius_km<=0)continue;
   const key=[area.lat,area.lng,area.radius_km].join(':');
   if(!areas.has(key))areas.set(key,{...area,sources:[]});
   const row=areas.get(key);if(!row.sources.includes(source))row.sources.push(source);
  }
 }
 add(state.seller_project.search_areas,translateUiText('Projekt'));
 for(const monitor of state.signals.monitoring?.monitors||[])add(monitor.search_areas,monitor.name||monitor.offer||monitor.plan?.[0]?.topic||translateUiText('Monitoring'));
 return [...areas.values()];
}
function projectCoveragePanel(){
 const areas=projectCoverageAreas();
 return `<section class="panel project-coverage"><div class="panel-head"><h2>Obszary obsługiwane przez projekt</h2><span class="badge gray">${areas.length}</span></div><p data-no-translate>${esc(state.seller_project.name)}</p><p class="hint">Zbiorczo: obszary projektu i jego monitoringów. Powtarzające się obszary pokazujemy raz.</p>${areas.length?'':'<p class="hint">Cały świat — brak ograniczeń obszaru wyszukiwania.</p>'}<div class="search-area-map project-coverage-map" id="project-coverage-map" role="region" aria-label="Zbiorcza mapa obszarów projektu"></div><p class="hint" id="project-coverage-status" role="status"></p><div class="project-coverage-legend">${areas.map((area,index)=>`<button type="button" class="secondary" data-coverage-area="${index}" data-no-translate>${esc(area.label||translateUiText('Obszar')+' '+(index+1))} · ${esc(area.radius_km)} km</button>`).join('')}</div></section>`;
}
function projectCoverageTile(){
 const areas=projectCoverageAreas();
 return `<div class="stat project-coverage-tile"><button type="button" data-open-project-map aria-label="${esc(translateUiText('Otwórz mapę na cały ekran'))}"><span>Obszary obsługi</span><span id="project-coverage-preview" aria-hidden="true"></span><small>${areas.length?'<span>Wybrane obszary:</span> '+areas.length:'<span>Cały świat</span>'} · <span>Otwórz mapę</span> ↗</small></button><a class="coverage-map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a></div>`;
}
function bindProjectCoverageTile(){
 const canvas=$('#project-coverage-preview'),button=$('[data-open-project-map]');if(!canvas||!button)return;
 button.onclick=openProjectCoverageMap;
 const areas=projectCoverageAreas();if(typeof L==='undefined')return;
 const map=L.map(canvas,{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false,boxZoom:false,keyboard:false,zoomAnimation:false,fadeAnimation:false}).setView([51,15],4);
 canvas._coverageMap=map;
 const layer=L.featureGroup().addTo(map);
 areas.forEach(area=>L.circle([area.lat,area.lng],{radius:area.radius_km*1000,color:'#6039ed',weight:1.5,fillOpacity:0.25,interactive:false}).addTo(layer));
 if(areas.length)map.fitBounds(layer.getBounds(),{padding:[5,5],maxZoom:10,animate:false});
 else centerWorldwideMap(map,canvas,null,()=>true,0);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,keepBuffer:0}).addTo(map);
 const resize=new ResizeObserver(()=>{if(canvas.isConnected){map.invalidateSize({animate:false});if(areas.length)map.fitBounds(layer.getBounds(),{padding:[5,5],maxZoom:10,animate:false})}});resize.observe(canvas);
 const cleanup=new MutationObserver(()=>{if(!canvas.isConnected){resize.disconnect();cleanup.disconnect();canvas._cancelWorldView?.();map.remove()}});cleanup.observe($('#content'),{childList:true,subtree:true});
}
function openProjectCoverageMap(){
 const dialog=document.createElement('dialog');dialog.className='project-map-fullscreen';dialog.setAttribute('aria-label',translateUiText('Zbiorcza mapa obszarów projektu'));
 dialog.innerHTML=`<button type="button" class="secondary coverage-map-close">${esc(translateUiText('Zamknij mapę'))} ×</button>${projectCoveragePanel()}`;
 document.body.append(dialog);dialog.showModal();
 dialog.querySelector('.coverage-map-close').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 requestAnimationFrame(()=>{if(dialog.isConnected)bindProjectCoverageMap(dialog)});
}
function bindProjectCoverageMap(root=document){
 const canvas=root.querySelector('#project-coverage-map');if(!canvas)return;
 if(typeof L==='undefined'){root.querySelector('#project-coverage-status').textContent=translateUiText('Nie udało się załadować mapy.');return}
 const areas=projectCoverageAreas(),map=L.map(canvas,{scrollWheelZoom:false,worldCopyJump:true}).setView([51,15],4);
 canvas._coverageMap=map;
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).on('tileerror',()=>{const status=canvas.parentElement?.querySelector('[role=status]');if(status)status.textContent=translateUiText('Nie udało się pobrać podkładu mapy. Obszary nadal są widoczne.')}).addTo(map);
 const layer=L.featureGroup().addTo(map),circles=areas.map((area,index)=>{
  const tooltip=document.createElement('span');tooltip.textContent=(area.label||translateUiText('Obszar')+' '+(index+1))+' · '+area.radius_km+' km — '+area.sources.join(', ');
  return L.circle([area.lat,area.lng],{radius:area.radius_km*1000,color:'#6039ed',weight:2,fillColor:'#c6b5fa',fillOpacity:0.25}).bindTooltip(tooltip).addTo(layer);
 });
 if(areas.length)map.fitBounds(layer.getBounds(),{padding:[24,24],maxZoom:11,animate:false});
 else centerWorldwideMap(map,canvas,root.querySelector('#project-coverage-status'));
 canvas._coverageAreas=areas;
 canvas.parentElement.querySelectorAll('[data-coverage-area]').forEach(button=>button.onclick=()=>{const circle=circles[Number(button.dataset.coverageArea)];map.fitBounds(circle.getBounds(),{padding:[24,24],maxZoom:12,animate:false});circle.openTooltip()});
 const resize=new ResizeObserver(()=>{if(canvas.isConnected)map.invalidateSize({animate:false})});resize.observe(canvas);
 const cleanup=new MutationObserver(()=>{if(!canvas.isConnected){resize.disconnect();cleanup.disconnect();canvas._cancelWorldView?.();map.remove()}});cleanup.observe(canvas.closest('dialog')?document.body:$('#content'),{childList:true,subtree:true});
}
function searchAreasLabel(value){try{const areas=Array.isArray(value)?value:JSON.parse(value||'[]');return areas.length?areas.map((a,index)=>`${a.label||translateUiText('Obszar')+' '+(index+1)} · ${a.radius_km} km`).join('; '):translateUiText('Cały świat')}catch{return translateUiText('Cały świat')}}
function bindSearchMap(form){
 const root=form.querySelector('[data-search-map-picker]');if(!root)return;
 const show=root.querySelector('[data-show-search-map]'),panel=root.querySelector('[data-search-map-panel]'),canvas=root.querySelector('[data-search-area-map]'),status=root.querySelector('[data-search-map-status]'),list=root.querySelector('[data-search-areas-list]'),storage=form.elements.search_areas;
 const lat=root.querySelector('[data-area-lat]'),lng=root.querySelector('[data-area-lng]'),radius=root.querySelector('[data-area-radius]'),label=root.querySelector('[data-area-label]'),add=root.querySelector('[data-add-search-area]');
 let areas=readSearchAreas(form),map=null,savedLayer=null,previewLayer=null;
 const thumbnails=new Set(),tileUrl='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
 const thumbnailObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
  if(!entry.isIntersecting||!entry.target.isConnected)return;thumbnailObserver.unobserve(entry.target);
  const area=areas[Number(entry.target.dataset.areaThumbnailMap)];if(!area||typeof L==='undefined')return;
  const mini=L.map(entry.target,{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false,boxZoom:false,keyboard:false,minZoom:0,maxZoom:19}).setView([area.lat,area.lng],4);
  thumbnails.add(mini);
  const circle=L.circle([area.lat,area.lng],{radius:area.radius_km*1000,color:'#6039ed',weight:1.5,fillColor:'#c6b5fa',fillOpacity:0.3,interactive:false}).addTo(mini);
  mini.fitBounds(circle.getBounds(),{padding:[3,3],maxZoom:12,animate:false});
  L.tileLayer(tileUrl,{maxZoom:19,keepBuffer:0}).addTo(mini);
 }),{rootMargin:'0px'});
 function clearThumbnails(){thumbnailObserver.disconnect();thumbnails.forEach(mini=>mini.remove());thumbnails.clear()}
 const projectId=state.seller_project.id,monitorForm=form.id.startsWith('monitor-'),key='kaska-show-search-map-'+projectId+(monitorForm?':'+form.id:'');
 const validDraft=()=>lat.value.trim()!==''&&lng.value.trim()!==''&&Number.isFinite(Number(lat.value))&&Number.isFinite(Number(lng.value))&&Number.isFinite(Number(radius.value))&&Math.abs(Number(lat.value))<=90&&Math.abs(Number(lng.value))<=180&&Number(radius.value)>=1&&Number(radius.value)<=1000;
 const tooltip=text=>{const element=document.createElement('span');element.textContent=text;return element};
 function preview(){
  if(!map)return;previewLayer.clearLayers();if(!validDraft())return;
  const center=[Number(lat.value),Number(lng.value)];
  L.circle(center,{radius:Number(radius.value)*1000,color:'#8b8596',dashArray:'6 5',fillOpacity:0.06,interactive:false}).addTo(previewLayer);
  L.circleMarker(center,{radius:5,color:'#6039ed',fillOpacity:1,interactive:false}).addTo(previewLayer);
 }
 function renderAreas(){
  root.querySelector('[data-search-area-count]').textContent=areas.length?translateUiText('Wybrane obszary:')+' '+areas.length:translateUiText('Cały świat — brak ograniczeń obszaru wyszukiwania.');
  add.disabled=areas.length>=10;root.querySelector('[data-clear-search-areas]').disabled=!areas.length;
  clearThumbnails();
  list.innerHTML=areas.map((area,index)=>`<div class="search-area-row"><button type="button" class="search-area-thumbnail" data-open-search-area="${index}" aria-label="${esc(translateUiText('Pokaż obszar na mapie:')+' '+(area.label||translateUiText('Obszar')+' '+(index+1)))}"><span class="search-area-thumbnail-map" data-area-thumbnail-map="${index}" aria-hidden="true"></span></button><span data-no-translate><strong>${esc(area.label||translateUiText('Obszar')+' '+(index+1))}</strong><small>${esc(area.radius_km)} km</small></span><button type="button" class="link danger" data-remove-search-area="${index}">Usuń obszar</button></div>`).join('')+(areas.length?'<p class="search-area-map-credit">&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</p>':'');
  list.querySelectorAll('[data-area-thumbnail-map]').forEach(element=>thumbnailObserver.observe(element));
  if(!map)return;if(areas.length)canvas._cancelWorldView?.();savedLayer.clearLayers();
  areas.forEach((area,index)=>L.circle([area.lat,area.lng],{radius:area.radius_km*1000,color:'#6039ed',weight:2,fillColor:'#c6b5fa',fillOpacity:0.25}).bindTooltip(tooltip((area.label||translateUiText('Obszar')+' '+(index+1))+' · '+area.radius_km+' km')).addTo(savedLayer));
 }
 function sync(){
  if(!root.isConnected||state.seller_project.id!==projectId)return;
  storage.value=JSON.stringify(areas);storage.dispatchEvent(new Event('input',{bubbles:true}));renderAreas();if(map&&!areas.length)centerWorldwideMap(map,canvas,status,()=>!areas.length&&state.seller_project.id===projectId);
 }
 function initializeMap(){
  if(!canvas.clientWidth||!canvas.clientHeight)return;
  if(map){map.invalidateSize();return}
  if(typeof L==='undefined'){status.textContent='Nie udało się załadować mapy. Możesz wpisać współrzędne poniżej.';return}
  map=L.map(canvas,{scrollWheelZoom:false,worldCopyJump:true}).setView([51,15],4);root._searchMap=map;
  L.tileLayer(tileUrl,{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).on('tileerror',()=>{status.textContent='Nie udało się pobrać podkładu mapy. Współrzędne i obszary nadal działają.'}).addTo(map);
  savedLayer=L.featureGroup().addTo(map);previewLayer=L.layerGroup().addTo(map);
  map.on('click',event=>{lat.value=event.latlng.lat.toFixed(6);lng.value=event.latlng.wrap().lng.toFixed(6);preview();status.textContent=translateUiText('Wybrano współrzędne. Ustaw promień i dodaj obszar.')});
  renderAreas();if(areas.length)map.fitBounds(savedLayer.getBounds(),{padding:[20,20],maxZoom:10});else centerWorldwideMap(map,canvas,status,()=>!areas.length&&state.seller_project.id===projectId);preview();
 }
 show.checked=areas.length>0;
 try{const saved=sessionStorage.getItem(key);if(saved!==null)show.checked=saved==='on'}catch{}
 show.onchange=()=>{panel.hidden=!show.checked;try{sessionStorage.setItem(key,show.checked?'on':'off')}catch{}if(show.checked)requestAnimationFrame(initializeMap);for(const input of panel.querySelectorAll('input'))input.disabled=!show.checked};
 for(const input of [lat,lng,radius])input.addEventListener('input',preview);
 for(const input of panel.querySelectorAll('input'))input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();add.click()}});
 add.onclick=()=>{
  if(!validDraft()){toast('Podaj poprawne współrzędne i promień od 1 do 1000 km.');return}
  if(areas.length>=10){toast('Możesz dodać maksymalnie 10 obszarów.');return}
  const area={lat:Number(Number(lat.value).toFixed(6)),lng:Number(Number(lng.value).toFixed(6)),radius_km:Number(radius.value),label:label.value.trim()};
  if(areas.some(existing=>existing.lat===area.lat&&existing.lng===area.lng&&existing.radius_km===area.radius_km)){toast('Ten obszar jest już dodany.');return}
  areas.push(area);sync();previewLayer?.clearLayers();lat.value='';lng.value='';label.value='';status.textContent=monitorForm?'Obszar dodany do monitoringu.':'Obszar dodany do projektu.';
 };
 list.onclick=event=>{
  const open=event.target.closest('[data-open-search-area]');
  if(open){
   const area=areas[Number(open.dataset.openSearchArea)];if(!area)return;
   show.checked=true;show.onchange();
   requestAnimationFrame(()=>{initializeMap();if(map)map.fitBounds(L.latLng(area.lat,area.lng).toBounds(area.radius_km*2000),{padding:[20,20],maxZoom:12,animate:false});canvas.scrollIntoView({block:'center',behavior:'smooth'});canvas.focus({preventScroll:true})});return;
  }
  const button=event.target.closest('[data-remove-search-area]');if(!button)return;areas.splice(Number(button.dataset.removeSearchArea),1);sync();
 };
 root.querySelector('[data-clear-search-areas]').onclick=()=>{areas=[];sync()};
 const resize=new ResizeObserver(()=>{if(root.isConnected&&!panel.hidden)initializeMap()});resize.observe(canvas);
 const cleanup=new MutationObserver(()=>{if(!root.isConnected){resize.disconnect();cleanup.disconnect();clearThumbnails();canvas._cancelWorldView?.();map?.remove()}});cleanup.observe(form.closest('dialog')||$('#content'),{childList:true,subtree:true});
 renderAreas();show.onchange();
}
