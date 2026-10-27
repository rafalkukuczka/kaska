const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 fs.mkdirSync('test-results',{recursive:true});
 const data=fs.mkdtempSync(path.resolve('test-results/monitoring-map-'));
 const server=spawn('python',['tests/browser_server.py'],{env:{...process.env,APP_PORT:'8796',APP_DATA_DIR:data,SMTP_HOST:'',SMTP_FROM:'',IMAP_HOST:'',OPENAI_API_KEY:'',HUNTER_API_KEY:'browser-fixture-only'},stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Katie:'))resolve()});server.on('error',reject);server.on('exit',c=>reject(Error('Server exit '+c)));setTimeout(()=>reject(Error('Server timeout')),10000).unref()});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  await page.addInitScript(()=>localStorage.setItem('kaska-simulation','off'));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&/\/api\/signals\/monitoring\/(topic|propose|activate)$/.test(r.url()))requests.push({path:r.url(),data:r.postDataJSON()})});
  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')}));
  await page.route('**/api/state',async route=>{const response=await route.fetch(),snapshot=await response.json();snapshot.integrations.ai=true;await route.fulfill({response,json:snapshot})});
  await page.goto('http://localhost:8796');await page.waitForFunction(()=>state?.seller_project);
  const projectArea={lat:51,lng:15,radius_km:100,label:'Project area'};
  await page.evaluate(async area=>{await api('seller-project',{offer:'Manufacturing services',search_areas:[area]});await refresh()},projectArea);
  await page.locator('nav [data-view=discover]').click();
  await page.locator('#my-monitoring>summary').click();
  async function setArea(form,area){
   await form.locator('[data-show-search-map]').check();
   await form.locator('[data-clear-search-areas]').click();
   await form.locator('[data-area-lat]').fill(String(area.lat));await form.locator('[data-area-lng]').fill(String(area.lng));
   await form.locator('[data-area-radius]').fill(String(area.radius_km));await form.locator('[data-area-label]').fill(area.label);
   await form.locator('[data-add-search-area]').click();
  }
  const topicArea={lat:52.2,lng:21,radius_km:50,label:'Topic area'};
  await page.locator('[data-monitor-topic]').click();
  let form=page.locator('#monitor-topic-form');
  assert.equal(await form.locator('.search-area-row').count(),1);
  await setArea(form,topicArea);
  await page.locator('#modal .actions .close').click();
  assert.deepEqual(await page.evaluate(()=>state.seller_project.search_areas),[projectArea]);
  assert.equal(await page.evaluate(()=>state.signals.monitoring.monitors.length),0);
  await page.locator('[data-monitor-topic]').click();form=page.locator('#monitor-topic-form');
  await form.locator('[name=topic]').fill('Map monitoring topic');await setArea(form,topicArea);
  await form.locator('button.primary').click();await page.waitForFunction(()=>state.signals.monitoring.monitors.length===1);
  assert.deepEqual(await page.evaluate(()=>state.signals.monitoring.monitors[0].search_areas),[topicArea]);
  assert.deepEqual(await page.evaluate(()=>state.seller_project.search_areas),[projectArea]);
  await page.locator('[data-monitor-offer]').click();form=page.locator('#monitor-offer-form');
  const offerArea={lat:48.85,lng:2.35,radius_km:25,label:'Offer area'};
  await setArea(form,offerArea);await form.locator('button.primary').click();
  form=page.locator('#monitor-plan-form');await form.waitFor();
  assert.equal(await form.locator('.search-area-row').count(),1);
  assert.ok((await form.locator('.search-area-row').textContent()).includes('Offer area'));
  // The final review can override the proposed scope without editing the seller project.
  const reviewedArea={lat:50,lng:10,radius_km:75,label:'Reviewed area'};
  await setArea(form,reviewedArea);await form.locator('button.primary').click();
  await page.waitForFunction(()=>state.signals.monitoring.monitors.length===2);
  assert.deepEqual(await page.evaluate(()=>state.signals.monitoring.monitors.find(m=>m.mode==='offer').search_areas),[reviewedArea]);
  assert.deepEqual(requests.find(r=>r.path.endsWith('/propose')).data.search_areas,[offerArea]);
  assert.deepEqual(requests.find(r=>r.path.endsWith('/activate')).data.search_areas,[reviewedArea]);
  await page.reload();await page.waitForFunction(()=>state?.seller_project);
  assert.deepEqual(await page.evaluate(()=>state.signals.monitoring.monitors.find(m=>m.mode==='topic').search_areas),[topicArea]);
  assert.deepEqual(await page.evaluate(()=>state.seller_project.search_areas),[projectArea]);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#my-monitoring>summary').click();await page.locator('[data-monitor-topic]').click();
  await page.locator('#monitor-topic-form [data-search-area-map]').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'test-results/monitoring-map-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('Monitoring map QA passed: topic/offer/review maps, defaults, independent areas, cancellation, payloads, database persistence and mobile dialogs; no live map or AI calls.');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
