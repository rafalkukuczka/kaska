const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 fs.mkdirSync('test-results',{recursive:true});
 const data=fs.mkdtempSync(path.resolve('test-results/coverage-'));
 const server=spawn('python',['tests/browser_server.py'],{env:{...process.env,APP_PORT:'8800',APP_DATA_DIR:data,SMTP_HOST:'',SMTP_FROM:'',IMAP_HOST:'',OPENAI_API_KEY:'',HUNTER_API_KEY:'browser-fixture-only'},stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Katie:'))resolve()});server.on('error',reject);server.on('exit',c=>reject(Error('Server exit '+c)));setTimeout(()=>reject(Error('Server timeout')),10000).unref()});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({latitude:35.6762,longitude:139.6503});
  await page.addInitScript(()=>localStorage.setItem('kaska-simulation','off'));
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')}));
  await page.goto('http://localhost:8800');await page.waitForFunction(()=>state?.seller_project);
  await page.locator('#project-coverage-preview.leaflet-container').waitFor();
  await page.waitForFunction(()=>{const map=document.querySelector('#project-coverage-preview')._coverageMap;return Math.abs(map.getCenter().lng-139.6503)<1});
  const preview=await page.evaluate(()=>{const map=document.querySelector('#project-coverage-preview')._coverageMap;return {center:map.getCenter(),zoom:map.getZoom(),areas:state.seller_project.search_areas}});
  assert.equal(preview.zoom,0);assert.deepEqual(preview.areas,[]);
  assert.ok(Math.abs(preview.center.lat-35.6762)<1);
  assert.equal(await page.locator('#project-coverage-preview path.leaflet-interactive').count(),0);
  assert.equal(await page.locator('#project-coverage-map').count(),0);
  assert.ok((await page.locator('nav [data-view=dashboard]').innerText()).includes('Dashboard'));
  assert.equal(await page.locator('.dashboard-stats>.stat').nth(1).getAttribute('class'),'stat project-coverage-tile');
  const tileLayout=await page.evaluate(()=>{
   const stats=document.querySelector('.dashboard-stats'),gap=parseFloat(getComputedStyle(stats).gap);
   const normal=stats.querySelector('.stat').getBoundingClientRect(),map=stats.querySelector('.project-coverage-tile').getBoundingClientRect();
   return {widthDifference:Math.abs(map.width-(normal.width*2+gap)),heightDifference:Math.abs(map.height-(normal.height*2+gap))};
  });
  assert.ok(tileLayout.widthDifference<2);assert.ok(tileLayout.heightDifference<2);
  await page.screenshot({path:'test-results/dashboard-map-four-tiles.png',fullPage:true});
  await page.evaluate(async()=>{
   const first={lat:52.23,lng:21.01,radius_km:40,label:'Warsaw'},second={lat:50.06,lng:19.94,radius_km:60,label:'Krakow'};
   await api('seller-project',{project_id:state.seller_project.id,revision:state.seller_project.revision,search_areas:[first]});await refresh();
   await api('signals/monitoring/topic',{topic:'Regional market',search_areas:[first,second]});await refresh();
  });
  await page.locator('#project-coverage-preview.leaflet-container').waitFor();
  assert.equal(await page.locator('#project-coverage-map').count(),0);
  await page.locator('[data-open-project-map]').click();
  await page.locator('#project-coverage-map.leaflet-container').waitFor();
  const full=await page.locator('.project-map-fullscreen').boundingBox();assert.equal(full.width,1440);assert.equal(full.height,1000);
  assert.equal(await page.locator('[data-coverage-area]').count(),2);
  assert.equal(await page.locator('#project-coverage-map path.leaflet-interactive').count(),2);
  assert.equal(await page.evaluate(()=>document.querySelector('#project-coverage-map')._coverageAreas[0].sources.length),2);
  const containsAll=await page.evaluate(()=>{const canvas=document.querySelector('#project-coverage-map');return canvas._coverageAreas.every(a=>canvas._coverageMap.getBounds().contains([a.lat,a.lng]))});assert.equal(containsAll,true);
  await page.locator('[data-coverage-area="1"]').click();
  await page.evaluate(async()=>refresh());
  assert.equal(await page.locator('#project-coverage-map path.leaflet-interactive').count(),2);
  await page.keyboard.press('Escape');await page.locator('.project-map-fullscreen').waitFor({state:'detached'});
  await page.locator('nav [data-view=discover]').click();
  assert.equal(await page.getByRole('heading',{name:'Jak chcesz szukać okazji?'}).count(),0);
  assert.equal(await page.locator('[data-discover-review]').count(),0);
  assert.equal(await page.locator('[data-monitor-topic]').count(),1);
  await page.evaluate(async()=>{await api('seller-projects/create',{name:'Empty project'});await refresh()});
  await page.locator('nav [data-view=dashboard]').click();
  assert.equal(await page.locator('#project-coverage-map').count(),0);
  await page.locator('[data-open-project-map]').click();
  await page.getByText('Cały świat — brak ograniczeń obszaru wyszukiwania.',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#project-coverage-status').textContent.includes('wyśrodkowana'));
  const worldwide=await page.evaluate(()=>{const map=document.querySelector('#project-coverage-map')._coverageMap;return {center:map.getCenter(),zoom:map.getZoom(),areas:state.seller_project.search_areas}});
  assert.equal(worldwide.zoom,1);assert.deepEqual(worldwide.areas,[]);
  assert.ok(Math.abs(worldwide.center.lat-35.6762)<0.5&&Math.abs(worldwide.center.lng-139.6503)<0.5,JSON.stringify(worldwide));
  assert.equal(await page.locator('#project-coverage-map path.leaflet-interactive').count(),0);
  // Denial keeps worldwide scope. A late location response must not undo user navigation.
  const fallback=await page.evaluate(async()=>{
   const canvas=document.querySelector('#project-coverage-map'),map=canvas._coverageMap,status=document.querySelector('#project-coverage-status');
   const original=navigator.geolocation.getCurrentPosition;
   try{
    currentMapLocation=null;navigator.geolocation.getCurrentPosition=(_,fail)=>fail({code:1});
    centerWorldwideMap(map,canvas,status);await new Promise(resolve=>setTimeout(resolve,0));
    const denied=status.textContent;
    let success;navigator.geolocation.getCurrentPosition=callback=>{success=callback};
    centerWorldwideMap(map,canvas,status);map.fire('dragstart');map.setView([10,20],3,{animate:false});
    success({coords:{latitude:-33.87,longitude:151.21}});await new Promise(resolve=>setTimeout(resolve,0));
    return {denied,center:map.getCenter(),zoom:map.getZoom(),areas:state.seller_project.search_areas};
   }finally{navigator.geolocation.getCurrentPosition=original;currentMapLocation=null}
  });
  assert.ok(fallback.denied.includes('Lokalizacja niedostępna'));assert.equal(fallback.zoom,3);
  assert.ok(Math.abs(fallback.center.lat-10)<0.5&&Math.abs(fallback.center.lng-20)<0.5);assert.deepEqual(fallback.areas,[]);
  await page.locator('.coverage-map-close').click();
  await page.evaluate(async()=>{await api('seller-projects/select',{project_id:1});await refresh()});
  await page.locator('[data-open-project-map]').click();
  await page.locator('#project-coverage-map.leaflet-container').waitFor();
  assert.equal(await page.locator('[data-coverage-area]').count(),2);
  await page.setViewportSize({width:390,height:844});
  const mobile=await page.locator('.project-map-fullscreen').boundingBox();assert.equal(mobile.width,390);assert.equal(mobile.height,844);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'test-results/project-coverage-mobile.png',fullPage:true});
  await page.locator('.coverage-map-close').click();
  await page.locator('[data-open-project-map]').click();await page.locator('#project-coverage-map.leaflet-container').waitFor();
  assert.deepEqual(errors,[]);
  console.log('Project coverage QA passed: empty state, combined project/monitor areas, deduplication, circles, fit bounds, refresh, removed controls, project isolation and mobile.');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
