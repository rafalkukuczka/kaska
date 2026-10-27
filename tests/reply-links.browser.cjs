const {chromium}=require('playwright');
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 fs.mkdirSync('test-results',{recursive:true});const data=fs.mkdtempSync(path.resolve('test-results/reply-links-'));
 const server=spawn('python',['tests/browser_server.py'],{env:{...process.env,APP_PORT:'8806',APP_DATA_DIR:data,SMTP_HOST:'',SMTP_FROM:'Sender Name <sender@workspace.example>',IMAP_HOST:'',OPENAI_API_KEY:'',HUNTER_API_KEY:''},stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Katie:'))resolve()});server.on('error',reject);server.on('exit',c=>reject(Error('Server exit '+c)));setTimeout(()=>reject(Error('Server timeout')),10000).unref()});
  execFileSync('python',['-c',`import sqlite3,sys,time
c=sqlite3.connect(sys.argv[1])
c.execute("INSERT INTO contacts(name,email) VALUES('Old Contact','reply+support@buyer.example')")
c.executemany("INSERT INTO contacts(name,email) VALUES(?,?)",[(f'Contact {i}',f'contact{i}@buyer.example') for i in range(2050)])
c.execute("INSERT INTO replies(contact_id,subject,body,received,uid) VALUES(1,?,?,?,'reply-fixture')",('Offer & details? + costs','Reply body <script>literal text</script>',time.time()))
c.commit()`,path.join(data,'katie.sqlite3')]);
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('kaska-simulation','off'));
  await context.route('https://mail.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Gmail compose fixture</title>'}));
  await page.goto('http://localhost:8806/#inbox');await page.waitForFunction(()=>state?.replies.length);
  assert.equal(await page.evaluate(()=>state.contacts.some(c=>c.id===1)),false);
  assert.equal(await page.evaluate(()=>state.replies[0].email),'reply+support@buyer.example');
  assert.ok((await page.locator('.inbox-reply h3').innerText()).includes('Old Contact'));
  const mailto=new URL(await page.locator('[data-reply-mailto]').getAttribute('href'));
  assert.equal(decodeURIComponent(mailto.pathname),'reply+support@buyer.example');
  assert.equal(mailto.searchParams.get('subject'),'Re: Offer & details? + costs');
  const popupPromise=page.waitForEvent('popup');await page.locator('[data-reply-gmail]').click();const popup=await popupPromise;await popup.waitForLoadState();
  const gmail=new URL(popup.url());assert.equal(gmail.origin,'https://mail.google.com');assert.equal(gmail.searchParams.get('to'),'reply+support@buyer.example');assert.equal(gmail.searchParams.get('su'),'Re: Offer & details? + costs');assert.equal(gmail.searchParams.get('authuser'),'sender@workspace.example');await popup.close();
  const helper=await page.evaluate(()=>({subject:replyMailLinks({email:'ok@example.com',subject:'Re: existing\r\n &bcc=bad'},null).subject,invalid:replyMailLinks({email:'bad@example.com?bcc=bad',subject:'x'},null),simulation:replyMailLinks({email:'fictional@demo.example',subject:'Hello',delivery_simulated:true},null).email}));
  assert.equal(helper.subject,'Re: existing &bcc=bad');assert.equal(helper.invalid,null);assert.equal(helper.simulation,'fictional@demo.example');
  assert.equal(await page.locator('.inbox-reply script').count(),0);
  await page.locator('#app-simulation').check();await page.waitForFunction(()=>monitoringSimulation&&!document.querySelector('#app-simulation').disabled);
  assert.equal(await page.locator('.inbox-reply').count(),3);
  assert.ok(await page.evaluate(()=>state.replies.every(reply=>reply.demo_inbox&&reply.email.endsWith('.example'))));
  assert.equal(await page.locator('.inbox-reply h3').filter({hasText:'Old Contact'}).count(),0);
  assert.ok((await page.locator('.inbox-reply h3').first().innerText()).includes('Anna Kowalska'));
  await page.reload();await page.waitForFunction(()=>state?.replies.length===3);
  assert.equal(await page.locator('.inbox-reply').count(),3);
  const canonical=await page.evaluate(async()=>await(await fetch('/api/state')).json());
  assert.equal(canonical.replies.length,1);
  await page.locator('#app-simulation').uncheck();await page.waitForFunction(()=>!monitoringSimulation&&!document.querySelector('#app-simulation').disabled);
  assert.equal(await page.locator('.inbox-reply').count(),1);
  assert.ok((await page.locator('.inbox-reply h3').innerText()).includes('Old Contact'));
  await page.locator('#ui-language').selectOption('en');await page.getByRole('link',{name:'Reply in Gmail ↗'}).waitFor();
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'test-results/reply-links-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log('Reply links QA passed: contact outside workspace limit, Gmail popup/account/subject, encoded mailto, simulation fallback, invalid addresses, English and mobile.');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
