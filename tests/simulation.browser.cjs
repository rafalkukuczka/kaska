const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 fs.mkdirSync('test-results',{recursive:true});
 const data=fs.mkdtempSync(path.resolve('test-results/simulation-'));
 const server=spawn('python',['tests/browser_server.py'],{env:{...process.env,APP_PORT:'8791',APP_DATA_DIR:data,SMTP_HOST:'',SMTP_FROM:'',IMAP_HOST:'',OPENAI_API_KEY:'',HUNTER_API_KEY:'browser-fixture-only'},stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Katie:'))resolve()});server.on('error',reject);server.on('exit',c=>reject(Error('Server exit '+c)));setTimeout(()=>reject(Error('Server timeout')),10000).unref()});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],realRequests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{if(/\/api\/signals\/(scan|monitoring\/companies)$/.test(request.url()))realRequests.push(request.url())});
  await page.goto('http://localhost:8791');
  await page.waitForFunction(()=>state?.seller_profile);
  await page.evaluate(async()=>{await api('signals/monitoring/topic',{topic:'ERP Demo'});await api('signals/monitoring/topic',{topic:'NIS2 Demo'});await refresh()});
  await page.locator('nav [data-view=discover]').click();
  await page.getByText('Symulacja włączona',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-simulation-source]').count(),4);
  assert.equal(await page.locator('.monitor-source-group').count(),2);
  assert.deepEqual((await page.locator('.monitor-source-group h5').allTextContents()).sort(),['ERP Demo','NIS2 Demo']);
  const grouped=await page.evaluate(()=>{
   const sources=simulationSources(),root=document.createElement('div');
   root.innerHTML=monitorSources([sources[0],sources[2],sources[1],sources[3]]);
   return [...root.querySelectorAll('.monitor-source-group')].map(group=>({
    topic:group.querySelector('h5').textContent,
    ids:[...group.querySelectorAll('[data-monitor-source]')].map(row=>Number(row.dataset.monitorSource))
   }));
  });
  assert.deepEqual(grouped.map(group=>group.topic).sort(),['ERP Demo','NIS2 Demo']);
  assert.deepEqual(grouped.map(group=>group.ids.length),[2,2]);
  const sourceTopics=await page.evaluate(()=>Object.fromEntries(simulationSources().map(source=>[source.id,JSON.parse(source.config).topic])));
  for(const group of grouped)for(const id of group.ids)assert.equal(sourceTopics[id],group.topic);
  assert.equal(await page.locator('.discover-company').count(),12);
  assert.equal(await page.getByRole('button',{name:'Oceń firmy z nowych zdarzeń'}).isDisabled(),true);
  for(const button of await page.locator('[data-simulation-source]').all()){
   await button.click();
   assert.equal(await page.locator('[data-demo-signal]').count(),3);
   assert.equal(await page.locator('#modal [data-signal=accept]').count(),0);
   await page.locator('#modal > button.close').click();
  }
  await page.locator('[data-monitor-events]').first().click();
  assert.equal(await page.locator('[data-demo-signal]').count(),6);
  await page.locator('#modal > button.close').click();
  await page.getByRole('button',{name:'Symuluj skanowanie',exact:true}).click();
  assert.deepEqual(realRequests,[]);
  assert.equal(await page.evaluate(()=>state.signals.items.length),0);
  assert.equal(await page.evaluate(()=>state.signals.monitoring.companies.length),0);
  assert.equal(await page.evaluate(()=>state.messages.length),0);
  await page.getByRole('button',{name:'Wyłącz symulację',exact:true}).click();
  await page.getByText('Dane rzeczywiste',{exact:true}).waitFor();
  assert.equal(await page.locator('.discover-company').count(),0);
  assert.equal(await page.locator('[data-simulation-source]').count(),0);
  await page.reload();
  await page.getByText('Dane rzeczywiste',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Włącz symulację',exact:true}).click();
  assert.equal(await page.locator('.discover-company').count(),12);
  await page.evaluate(async()=>{await api('seller-profiles/create',{name:'Other demo profile'});await refresh()});
  assert.equal(await page.locator('.discover-company').count(),0);
  await page.evaluate(async()=>{await api('seller-profiles/select',{profile_id:1});await refresh()});
  assert.equal(await page.locator('.discover-company').count(),12);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'test-results/simulation-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('Simulation browser QA passed: 3 per source, 6 per monitor, no real API calls or database signals, real mode, persistence, profile isolation and mobile.');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
