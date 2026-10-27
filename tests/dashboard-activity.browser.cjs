const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const data=fs.mkdtempSync(path.resolve('test-results/activity-'));
 const server=spawn('python',['tests/browser_server.py'],{env:{...process.env,APP_PORT:'8808',APP_DATA_DIR:data,SMTP_HOST:'',SMTP_FROM:'',IMAP_HOST:'',OPENAI_API_KEY:'',HUNTER_API_KEY:''},stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Katie:'))resolve()});server.on('error',reject);server.on('exit',c=>reject(Error('Server exit '+c)));setTimeout(()=>reject(Error('Server timeout')),10000).unref()});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  await page.addInitScript(()=>localStorage.setItem('kaska-simulation','off'));
  await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:8808');await page.locator('#dashboard-activity-chart svg').waitFor();
  assert.equal(await page.locator('[data-flow-metric]').count(),5);
  assert.equal(await page.locator('[data-flow-metric=contacted] strong').innerText(),'0');
  assert.equal(await page.locator('[data-flow-metric=reply] strong').innerText(),'—');
  assert.equal(await page.locator('[data-activity-total=sent]').innerText(),'0');
  assert.equal(await page.locator('.activity-empty').count(),1);
  const fixture=await page.evaluate(async()=>{
   await api('contacts',{name:'Contact',email:'chart@example.com'});
   const campaign={name:'Activity campaign',offer:'Services',audience_mode:'all',steps:[{delay_days:0,subject:'Hello',body:'Hello'}]};
   await api('campaigns',campaign);await refresh();const first=state.campaigns[0].id,contact=state.contacts[0].id;
   await chooseSellerProject('seller-projects/create',{name:'Other project',share_contacts:true});
   await api('campaigns',campaign);await refresh();const second=state.campaigns[0].id;
   await chooseSellerProject('seller-projects/select',{project_id:1});
   return {first,second,contact};
  });
  const seed=spawnSync('python',['-c',`
import sqlite3,sys,json,time
f=json.loads(sys.argv[2]);now=time.time()
with sqlite3.connect(sys.argv[1]) as c:
 c.executemany("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at) VALUES(?,?,?,'Hello','Body',0,'sent',?)",[(f['first'],f['contact'],i,now-86400) for i in range(2051)])
 c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due,status,sent_at) VALUES(?,?,0,'Other','Body',0,'sent',?)",(f['second'],f['contact'],now))
 c.executemany("INSERT INTO replies(contact_id,subject,body,received,uid,project_id) VALUES(?,'Reply','Body',?,?,?)",[(f['contact'],now-86400,'yesterday',1),(f['contact'],now,'today',1),(f['contact'],now-100*86400,'old',1),(f['contact'],now,'other',2)])
`,path.join(data,'katie.sqlite3'),JSON.stringify(fixture)],{encoding:'utf8'});
  assert.equal(seed.status,0,seed.stderr);
  await page.evaluate(async()=>refresh());
  assert.equal(await page.locator('[data-flow-metric=potential] strong').innerText(),'0');
  assert.equal(await page.locator('[data-flow-metric=contacted] strong').innerText(),'1');
  assert.equal(await page.locator('[data-flow-metric=reply] strong').innerText(),'100%');
  assert.equal(await page.locator('[data-flow-metric=engagement] strong').innerText(),'—');
  assert.equal(await page.locator('[data-flow-metric=bounce] strong').innerText(),'—');
  await page.locator('.dashboard-flow').screenshot({path:'test-results/dashboard-flow-desktop.png'});
  assert.equal(await page.locator('[data-activity-total=sent]').innerText(),'2051');
  assert.equal(await page.locator('[data-activity-total=replies]').innerText(),'2');
  assert.equal(await page.locator('.activity-data tbody tr').count(),30);
  await page.selectOption('#dashboard-activity-range','7');
  assert.equal(await page.locator('.activity-data tbody tr').count(),7);
  assert.equal(await page.locator('[data-activity-total=sent]').innerText(),'2051');
  const boundary=await page.evaluate(()=>activityDayKey(Date.parse('2026-10-26T23:30:00Z')/1000));
  assert.equal(boundary,'2026-10-27');
  await page.evaluate(async()=>chooseSellerProject('seller-projects/select',{project_id:2}));
  assert.equal(await page.locator('[data-activity-total=sent]').innerText(),'1');
  assert.equal(await page.locator('[data-activity-total=replies]').innerText(),'1');
  await page.evaluate(async()=>chooseSellerProject('seller-projects/select',{project_id:1}));
  await page.locator('#app-simulation').check();
  await page.waitForFunction(()=>monitoringSimulation&&document.querySelector('#dashboard-activity-chart .badge'));
  assert.equal(await page.locator('[data-flow-metric=contacted] strong').innerText(),'1');
  assert.equal(await page.locator('[data-flow-metric=reply] strong').innerText(),'100%');
  await page.evaluate(()=>{
   const now=Date.now();deliverySimulationRuns()[999]={campaign_id:999,status:'paused',created:now-4000,at:now,elapsed:4000,messages:[{id:999,contact_id:999,position:0,original_status:'queued',status:'sent',sent_at:now/1000}],replies:[]};
   renderDashboardActivity();
  });
  assert.equal(await page.locator('[data-activity-total=sent]').innerText(),'1');
  assert.equal(await page.locator('[data-activity-total=replies]').innerText(),'3');
  await page.waitForFunction(()=>deliverySimulationSignature.includes('"paused"'));
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.dashboard-activity').screenshot({path:'test-results/dashboard-activity-mobile.png'});
  await page.locator('.dashboard-flow').screenshot({path:'test-results/dashboard-flow-mobile.png'});
  await page.locator('#ui-language').selectOption('en');
  await page.getByRole('heading',{name:'Messages and replies',exact:true}).waitFor();
  await page.getByText('Contacted prospects',{exact:true}).waitFor();
  await page.locator('[data-flow-metric=bounce] summary').click();
  await page.getByText('Confirmed email bounces are not recorded. SMTP errors and address verification results are not counted as bounces.',{exact:true}).waitFor();
  await page.locator('#app-simulation').uncheck();
  await page.waitForFunction(()=>!monitoringSimulation&&document.querySelector('[data-activity-total=sent]').textContent==='2051');
  await page.setViewportSize({width:1440,height:1000});
  const navigation=await page.locator('nav [data-view]').evaluateAll(buttons=>buttons.map(button=>button.dataset.view));
  assert.equal(navigation[navigation.indexOf('library')+1],'reports');
  await page.locator('nav [data-view=reports]').click();
  await page.locator(`[data-report-campaign="${fixture.first}"]`).waitFor();
  assert.equal(await page.locator('nav [data-view=reports] svg').count(),1);
  assert.equal(await page.locator('[data-report-campaign]').count(),1);
  assert.equal((await page.locator(`[data-report-campaign="${fixture.first}"] td`).nth(2).innerText()).replace(/\D/g,''),'2051');
  assert.equal(await page.locator('[data-activity-total=sent]').innerText(),'2051');
  await page.locator('#app-simulation').check();
  await page.waitForFunction(()=>monitoringSimulation);
  assert.equal(await page.locator('[data-activity-total=sent]').innerText(),'2051');
  assert.equal(await page.locator('#dashboard-activity-chart .badge').count(),0);
  await page.route('**/api/reports?days=90',route=>route.fulfill({status:500,json:{error:'Fixture unavailable'}}));
  await page.selectOption('#reports-days','90');
  await page.getByRole('alert').filter({hasText:'Could not load reports.'}).waitFor();
  await page.unroute('**/api/reports?days=90');
  await page.locator('#reports-refresh').click();
  await page.waitForFunction(()=>reportsSnapshot?.days===90);
  assert.equal(await page.locator('[data-activity-total=sent]').innerText(),'2051');
  await page.screenshot({path:'test-results/reports-desktop.png',fullPage:true});
  await page.evaluate(async()=>chooseSellerProject('seller-projects/select',{project_id:2}));
  await page.waitForFunction(()=>reportsSnapshot?.project_id===2);
  assert.equal(await page.locator('[data-report-campaign]').count(),1);
  assert.equal(await page.locator(`[data-report-campaign="${fixture.second}"]`).count(),1);
  assert.equal(await page.locator('[data-activity-total=sent]').innerText(),'1');
  await page.reload();await page.locator(`[data-report-campaign="${fixture.second}"]`).waitFor();
  assert.ok(page.url().endsWith('#reports'));
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'test-results/reports-mobile.png',fullPage:true});
  await page.locator('#ui-language').selectOption('pl');
  await page.getByRole('heading',{name:'Raporty',exact:true}).waitFor();
  await page.getByRole('heading',{name:'Porównanie kampanii',exact:true}).waitFor();
  await page.evaluate(async()=>{await api('seller-project',{website:'dashboard.example',offer:'Production software services'});await refresh()});
  await page.locator('nav [data-view=dashboard]').click();
  await page.getByRole('heading',{name:'Kogo dziś szukamy?',exact:true}).waitFor();
  await page.locator('#dashboard-audience').fill('Firmy produkcyjne w Niemczech, ponad 50 pracownikow');
  await page.evaluate(async()=>refresh());
  assert.equal(await page.locator('#dashboard-audience').inputValue(),'Firmy produkcyjne w Niemczech, ponad 50 pracownikow');
  await page.getByRole('button',{name:'Przejdź do leadów',exact:false}).click();
  await page.waitForFunction(()=>view==='prospecting'&&state.seller_project.audience==='Firmy produkcyjne w Niemczech, ponad 50 pracownikow');
  await page.waitForFunction(()=>state.prospecting.runs.some(run=>String(run.id).startsWith('sim-')&&run.audience.includes('Firmy produkcyjne w Niemczech, ponad 50 pracownikow')));
  await page.evaluate(async()=>chooseSellerProject('seller-projects/select',{project_id:1}));
  assert.notEqual(await page.evaluate(()=>state.seller_project.audience),'Firmy produkcyjne w Niemczech, ponad 50 pracownikow');
  assert.deepEqual(errors,[]);
  console.log('Dashboard/reports QA passed: complete history, project isolation, ranges, Warsaw dates, real reports during simulation, retry, navigation, reload, Polish/English and mobile.');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
