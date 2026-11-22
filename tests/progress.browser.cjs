const {chromium}=require('playwright');
const {selectContactTags}=require('./tag-picker-helper.cjs');
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 fs.mkdirSync('test-results',{recursive:true});
 const data=fs.mkdtempSync(path.resolve('test-results/progress-'));
 const logTime=new Date(Date.now()-60000);
 const pad=value=>String(value).padStart(2,'0');
 const timestamp=`${logTime.getFullYear()}-${pad(logTime.getMonth()+1)}-${pad(logTime.getDate())} ${pad(logTime.getHours())}:${pad(logTime.getMinutes())}:${pad(logTime.getSeconds())},000`;
 fs.writeFileSync(path.join(data,'katie.log.1'),`${timestamp} ERROR worker Fixture error\n`);
 const server=spawn('python',['tests/browser_server.py'],{env:{...process.env,APP_PORT:'8792',APP_DATA_DIR:data,SMTP_HOST:'',SMTP_FROM:'',IMAP_HOST:'',OPENAI_API_KEY:'',HUNTER_API_KEY:'browser-fixture-only'},stdio:'pipe'});
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Katie:'))resolve()});server.on('error',reject);server.on('exit',c=>reject(Error('Server exit '+c)));setTimeout(()=>reject(Error('Server timeout')),10000).unref()});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  await page.addInitScript(()=>localStorage.setItem('kaska-simulation','off'));
  page.on('pageerror',e=>errors.push(e.message));
  let jobs=[{id:'prospect-1',kind:'prospecting',status:'drafting',stage:'Generating messages',project_name:'Another project',completed:2,total:6}];
  await page.route('**/api/background',route=>route.fulfill({json:{jobs}}));
  await page.goto('http://localhost:8792');
  await page.locator('#background-progress').waitFor();
  await page.locator('#background-progress').getByText('2 / 6 · 33%',{exact:true}).waitFor();
  assert.equal(await page.locator('#background-progress progress').getAttribute('value'),'2');
  let adminJobs=jobs;
  await page.route('**/api/admin/logs',route=>route.fulfill({json:{
   jobs:adminJobs,entries:[{created:Date.now()/1000,level:'info',detail:'Przygotowano wiadomości'}],
  }}));
  await page.locator('nav [data-view=administration]').click();
  const activity=page.locator('#admin-logs');
  await activity.getByText('2 / 6',{exact:true}).waitFor();
  await activity.getByText('Przygotowano wiadomości',{exact:true}).waitFor();
  adminJobs=[];
  await activity.getByText('Brak aktywnych operacji.',{exact:true}).waitFor();
  await page.locator('nav [data-view=contacts]').click();
  await page.locator('[data-action=new-contact]').click();
  await page.locator('#contact-form [name=name]').fill('Keep this draft');
  jobs[0].completed=4;
  await page.evaluate(async()=>pollBackgroundProgress());
  assert.equal(await page.locator('#contact-form [name=name]').inputValue(),'Keep this draft');
  assert.equal(await page.locator('#background-progress progress').getAttribute('value'),'4');
  await page.locator('#modal > button.close').click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/progress-mobile.png'});
  const bounds=await page.locator('#background-progress').boundingBox();
  assert.ok(bounds.y+bounds.height<=844&&bounds.y>844/2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  jobs=[];await page.evaluate(async()=>pollBackgroundProgress());
  assert.equal(await page.locator('#background-progress').count(),0);
  // A single pending request has an indeterminate bar, including on another screen.
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/research',async route=>{await gate;await route.fulfill({json:{offer:'Fixture offer'}})});
  await page.evaluate(()=>{window.progressTestRequest=api('research',{url:'https://example.com'}).catch(()=>{})});
  await page.locator('#background-progress progress').waitFor();
  assert.equal(await page.locator('#background-progress progress').getAttribute('value'),null);
  await page.locator('nav [data-view=campaigns]').click();
  assert.equal(await page.locator('#background-progress').count(),1);
  release();await page.evaluate(async()=>window.progressTestRequest);
  await page.waitForFunction(()=>!document.querySelector('#background-progress'));
  await page.route('**/api/research',route=>route.fulfill({status:400,json:{error:'Fixture failure'}}));
  await page.evaluate(async()=>{try{await api('research',{})}catch{}});
  assert.equal(await page.locator('#background-progress').count(),0);
  let releasePreparation;
  const preparationGate=new Promise(resolve=>releasePreparation=resolve);
  await page.route('**/api/campaign/prepare',async route=>{await preparationGate;await route.fulfill({json:{ok:true}})});
  await page.evaluate(()=>{window.progressTestRequest=api('campaign/prepare',{id:42})});
  await page.locator('#background-progress').getByText('Przygotowywanie wiadomości',{exact:true}).waitFor();
  jobs=[{id:'campaign-prepare-fixture',kind:'campaign-prepare',campaign_id:42,label:'Przygotowywanie wiadomości',completed:3,total:4,cancellable:true}];
  await page.evaluate(async()=>pollBackgroundProgress());
  const preparation=page.locator('[data-background-task=campaign-prepare-fixture]');
  const percent=preparation.getByText('3 / 4 · 75%',{exact:true});
  await percent.waitFor();
  assert.equal(await page.locator('.background-progress-row').count(),1);
  const stop=preparation.getByRole('button',{name:'Przerwij',exact:true});
  assert.ok((await stop.boundingBox()).y>(await percent.boundingBox()).y);
  await page.route('**/api/background/cancel',async route=>{
   assert.deepEqual(route.request().postDataJSON(),{id:'campaign-prepare-fixture'});
   jobs[0].status='cancelling';
   await route.fulfill({json:{ok:true}});
  });
  await stop.click();
  const stopping=preparation.getByRole('button',{name:'Przerywanie…',exact:true});
  await stopping.waitFor();
  assert.equal(await stopping.isDisabled(),true);
  jobs=[];releasePreparation();
  await page.evaluate(async()=>window.progressTestRequest);
  await page.waitForFunction(()=>!document.querySelector('#background-progress'));
  await page.unroute('**/api/campaign/prepare');
  // Opening the Discover bell acknowledges one batch without losing the newest updates.
  await page.waitForFunction(()=>state?.seller_project);
  const bellProject=await page.evaluate(()=>state.seller_project.id);
  const seedNotification=eventNumber=>{
   const seeded=spawnSync('python',['-c',`
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    project, number = map(int, sys.argv[2:])
    db.execute("INSERT OR IGNORE INTO lead_searches (id,project_id,query,context,created,live) VALUES (1,?,'Bell fixture','{}',1,0)", (project,))
    db.execute("INSERT INTO lead_search_events (search_id,domain,kind,label,fingerprint,created) VALUES (1,'example.test','signal','New signal',?,1)", (str(number),))
`,path.join(data,'katie.sqlite3'),String(bellProject),String(eventNumber)],{encoding:'utf8'});
   assert.equal(seeded.status,0,seeded.stderr);
  };
  seedNotification(1);seedNotification(2);
  const discoverBell=page.locator('#lead-notification-bell'), bellBadge=page.locator('#lead-notification-count');
  await page.waitForFunction(()=>document.querySelector('#lead-notification-count').textContent==='2'&&!document.querySelector('#lead-notification-count').hidden);
  await discoverBell.click();
  await bellBadge.waitFor({state:'hidden'});
  await page.locator('#lead-notification-items [data-lead-notification]').getByText('Nowe · 2').waitFor();
  seedNotification(3);
  await page.waitForFunction(()=>document.querySelector('#lead-notification-count').textContent==='1'&&!document.querySelector('#lead-notification-count').hidden);
  await discoverBell.click();
  await discoverBell.click();
  await bellBadge.waitFor({state:'hidden'});
  await page.locator('#lead-notification-items [data-lead-notification]').getByText('Nowe · 1').waitFor();
  await discoverBell.click();
  await page.reload();
  await page.waitForFunction(()=>state?.seller_project);
  await bellBadge.waitFor({state:'hidden'});
  // Dashboard progress follows the selected search, including the request that creates it.
  const projectId=await page.evaluate(()=>state.seller_project.id);
  const search={id:1,query:'Fixture companies',live:true,stopped:0,saved:false,criteria:[],company_limit:5};
  const first={domain:'first.example',name:'First',origin:'agent',status:'qualified',evidence:[]};
  const second={domain:'second.example',name:'Second',origin:'agent',status:'pending',evidence:[]};
  let dashboard={project_id:projectId,notifications:[],searches:[],search:null,companies:[],jobs:[],active_agent_jobs:0};
  await page.route(/\/api\/lead-search\?/,route=>route.fulfill({json:dashboard}));
  let beginSearch;
  const startGate=new Promise(resolve=>{beginSearch=resolve});
  await page.route('**/api/lead-search/start',async route=>{await startGate;await route.fulfill({json:dashboard})});
  await page.locator('nav [data-view=dashboard]').click();
  await page.locator('#dashboard-audience').fill(search.query);
  await page.locator('#dashboard-search-form button[type=submit]').click();
  const searchBar=page.locator('[data-dashboard-search-progress]');
  await searchBar.getByText('Uruchamiam wyszukiwanie…',{exact:true}).waitFor();
  const bar=searchBar.locator('progress');
  assert.equal(await bar.getAttribute('value'),null);
  const stopSearch=searchBar.getByRole('button',{name:'Przerwij',exact:true});
  await stopSearch.waitFor();
  assert.equal(await page.locator('.lead-agent-status [data-lead-stop]').count(),0);
  assert.equal(await searchBar.evaluate(node=>getComputedStyle(node).borderTopStyle),'solid');
  dashboard={...dashboard,search,searches:[search],active_agent_jobs:1,jobs:[{kind:'discover',status:'running'}]};
  beginSearch();
  await searchBar.getByText('Wyszukiwanie nowych firm',{exact:true}).waitFor();
  await searchBar.getByText('0 / 1 · 0%',{exact:true}).waitFor();
  assert.equal(await bar.getAttribute('value'),'0');
  dashboard={...dashboard,companies:[first,second],jobs:[{kind:'evaluate',status:'running',domain:second.domain}]};
  await searchBar.getByText('Analiza firm',{exact:true}).waitFor();
  const completion=searchBar.getByText('1 / 2 · 50%',{exact:true});
  await completion.waitFor();
  assert.ok((await stopSearch.boundingBox()).y>(await completion.boundingBox()).y);
  assert.equal(await bar.getAttribute('value'),'1');
  assert.equal(await bar.getAttribute('max'),'2');
  await page.locator('[data-lead-layout=tiles]').click();
  const firstTile=page.locator('[data-company="first.example"]');
  const secondTile=page.locator('[data-company="second.example"]');
  const background=tile=>tile.evaluate(node=>getComputedStyle(node).backgroundColor);
  assert.notEqual(await background(firstTile),'rgb(237, 249, 242)');
  await page.evaluate(async()=>{
   await api('contacts',{name:'First Contact',email:'contact@another.example',company:'FIRST'});
   await refresh();
  });
  await firstTile.getByText('W kontaktach',{exact:true}).waitFor();
  assert.equal(await background(firstTile),'rgb(237, 249, 242)');
  assert.notEqual(await background(secondTile),'rgb(237, 249, 242)');
  await page.route('**/api/lead-search/contact-search',route=>route.fulfill({json:{contacts:[],enrichment:[
   {provider:'Chrome headless',status:'ok',added:0,urls:['https://first.example/contact']},
   {provider:'Hunter',status:'ok',added:0}
  ]}}));
  await firstTile.locator('summary').click();
  const hunterRequest=page.waitForRequest(request=>request.url().endsWith('/api/lead-search/contact-search'));
  assert.equal(await firstTile.getByRole('button',{name:/Zbadaj dane kontaktowe/}).count(),1);
  await firstTile.getByRole('button',{name:'Zbadaj dane kontaktowe',exact:true}).click();
  assert.equal((await hunterRequest).postDataJSON().provider,'auto');
  const trace=page.locator('#lead-contact-content .enrichment-trace');
  await trace.getByText('Chrome headless',{exact:true}).waitFor();
  await trace.getByText('Hunter',{exact:true}).waitFor();
  assert.equal(await trace.getByRole('link').getAttribute('href'),'https://first.example/contact');
  await page.locator('#modal').getByRole('button',{name:'Dodaj ręcznie',exact:true}).click();
  const manualContact=page.locator('#contact-form');
  assert.equal(await manualContact.locator('[name=company]').inputValue(),'First');
  assert.equal(await manualContact.locator('[name=website]').inputValue(),'first.example');
  await manualContact.locator('#contact-intake-text').evaluate(node=>{
   node.value='Kontakt: Anna Nowak\nE-mail: anna@first.example\nTel. 609 02 57 57\nul. Poranna 90A\n41-103 Siemianowice Śląskie\nwww.first.example';
   node.dispatchEvent(new Event('input',{bubbles:true}));
   node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true}));
  });
  await page.waitForFunction(()=>document.querySelector('#contact-form [name=email]')?.value==='anna@first.example');
  assert.equal(await manualContact.locator('[name=phone]').inputValue(),'609 02 57 57');
  assert.equal(await manualContact.locator('[name=address]').inputValue(),'ul. Poranna 90A\n41-103 Siemianowice Śląskie');
  await manualContact.getByRole('button',{name:'Zapisz kontakt',exact:true}).click();
  await page.waitForFunction(()=>state.contacts.some(contact=>contact.email==='anna@first.example'&&contact.research_data.website==='https://www.first.example'));
  assert.equal(await page.locator('#modal').isVisible(),false);
  await page.evaluate(()=>{
   const url=new URL(location.href);
   url.searchParams.set('contactIntake','selection-fixture');
   history.replaceState(null,'',url);
   window.postMessage({type:'KATIE_CONTACT_INTAKE',id:'selection-fixture',draft:{
    text:'Company: Selections Ltd\n350 5th Avenue\nNew York, NY 10118\nEmail: sales@selection.example',
    website:'https://selection.example'
   }},location.origin);
  });
  await page.waitForFunction(()=>document.querySelector('#contact-form [name=email]')?.value==='sales@selection.example');
  assert.equal(await manualContact.locator('[name=address]').inputValue(),'350 5th Avenue\nNew York, NY 10118');
  assert.equal(await manualContact.locator('[name=website]').inputValue(),'https://selection.example');
  assert.equal(new URL(page.url()).searchParams.has('contactIntake'),false);
  await manualContact.getByRole('button',{name:'Anuluj',exact:true}).click();
  const existingContact=await page.evaluate(()=>{
   const contact=state.contacts.find(row=>row.email==='anna@first.example');
   const url=new URL(location.href);
   url.searchParams.set('contactIntake','linked-selection-fixture');
   history.replaceState(null,'',url);
   window.postMessage({type:'KATIE_CONTACT_INTAKE',id:'linked-selection-fixture',draft:{
    text:'Phone: +1 212 555 0142\n350 5th Avenue\nNew York, NY 10118',
    target:{contactId:contact.id,projectId:state.seller_project.id,generation:state.simulation_generation||''}
   }},location.origin);
   return {id:contact.id,count:state.contacts.length};
  });
  const editContact=page.locator('#contact-edit-form');
  await editContact.getByText('Kontakt do uzupełnienia',{exact:true}).waitFor();
  assert.equal(await manualContact.count(),0);
  await page.waitForFunction(()=>document.querySelector('#contact-edit-form [name=phone]')?.value==='+1 212 555 0142');
  assert.equal(await editContact.locator('[name=email]').inputValue(),'anna@first.example');
  await editContact.getByRole('button',{name:'Zapisz kontakt',exact:true}).click();
  await page.waitForFunction(id=>state.contacts.some(row=>row.id===id&&row.research_data.address==='350 5th Avenue\nNew York, NY 10118'),existingContact.id);
  assert.equal(await page.evaluate(()=>state.contacts.length),existingContact.count);
  await page.route('**/api/contacts/parse',route=>{
   const {image,text}=route.request().postDataJSON();
   assert.match(image,/^data:image\/jpeg;base64,/);
   assert.equal(text,undefined);
   return route.fulfill({json:{transcript:'Image contact\nEmail: image@example.net', fields:{name:'Image contact',email:'image@example.net'}}});
  });
  await firstTile.getByRole('button',{name:'Dodaj kontakt ręcznie',exact:true}).click();
  await manualContact.locator('#contact-intake-text').evaluate(async input=>{
   const canvas=document.createElement('canvas');
   const blob=await new Promise(resolve=>canvas.toBlob(resolve));
   const clipboard=new DataTransfer();
   clipboard.items.add(new File([blob],'contact.png',{type:'image/png'}));
   input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));
  });
  await page.waitForFunction(()=>document.querySelector('#contact-form [name=email]')?.value==='image@example.net');
  assert.equal(await manualContact.locator('[data-contact-intake-image]').isVisible(),true);
  assert.match(await manualContact.locator('#contact-intake-text').inputValue(),/Image contact/);
  await manualContact.getByRole('button',{name:'Usuń obraz',exact:true}).click();
  assert.equal(await manualContact.locator('[data-contact-intake-image]').isVisible(),false);
  await manualContact.getByRole('button',{name:'Anuluj',exact:true}).click();
  await page.unroute('**/api/contacts/parse');
  await page.unroute('**/api/lead-search/contact-search');
  const researched=[],saved=[];
  await page.route('**/api/lead-search/contact-search',route=>{
   const company=route.request().postDataJSON();
   researched.push(company.domain);
   return route.fulfill({json:{id:100+researched.length,contacts:[{id:0,name:company.company+' Employee',
    email:'employee@'+company.domain}],enrichment:[]}});
  });
  await page.route('**/api/lead-search/contact-add',route=>{
   saved.push(route.request().postDataJSON());
   return route.fulfill({json:{added:1,existing:0}});
  });
  await page.locator('#lead-company-status').selectOption('no-contacts');
  assert.equal(await firstTile.isVisible(),false);
  assert.equal(await secondTile.isVisible(),true);
  await page.locator('#lead-company-status').selectOption('qualified');
  assert.equal(await secondTile.isVisible(),false);
  const menu=page.locator('[data-lead-contact-bulk]');
  await menu.locator('summary').click();
  await menu.getByRole('button',{name:'Zbadaj dane kontaktowe',exact:true}).click();
  const group=page.locator('#lead-contact-bulk-form');
  await group.getByText('Second',{exact:true}).waitFor();
  assert.deepEqual(researched,['first.example','second.example']);
  await group.locator('[data-select-bulk-contact-all]').check();
  await selectContactTags(group,'Wyniki zbiorcze');
  await group.getByRole('button',{name:'Zapisz w Kontaktach'}).click();
  await page.locator('#modal').waitFor({state:'hidden'});
  assert.deepEqual(saved.map(item=>[item.id,item.selected,item.tags]),[[101,[0],['Wyniki zbiorcze']],[102,[0],['Wyniki zbiorcze']]]);
  await page.unroute('**/api/lead-search/contact-search');
  const stoppedCompanies=[];
  let finishCurrentCompany;
  const currentCompany=new Promise(resolve=>finishCurrentCompany=resolve);
  await page.route('**/api/lead-search/contact-search',async route=>{
   const company=route.request().postDataJSON();
   stoppedCompanies.push(company.domain);
   await currentCompany;
   await route.fulfill({json:{id:200,contacts:[{id:0,name:'Partial result',email:'partial@example.net'}],enrichment:[]}});
  });
  await menu.locator('summary').click();
  await menu.getByRole('button',{name:'Zbadaj dane kontaktowe',exact:true}).click();
  const bulkProgress=page.locator('#lead-contact-bulk-body');
  await bulkProgress.getByRole('button',{name:'Przerwij',exact:true}).click();
  assert.equal(await bulkProgress.getByRole('button',{name:'Przerywanie…',exact:true}).isDisabled(),true);
  finishCurrentCompany();
  await bulkProgress.getByText('Badanie przerwane.',{exact:true}).waitFor();
  assert.deepEqual(stoppedCompanies,['first.example']);
  await group.locator('summary').click();
  await group.getByText('Partial result',{exact:false}).waitFor();
  await page.locator('#modal > button.close').click();
  const contacts=await page.evaluate(()=>state.contacts.filter(contact=>contact.name==='First Contact'));
  await page.route('**/api/lead-search/contact-tag-candidates',route=>route.fulfill({json:{contacts}}));
  await menu.locator('summary').click();
  await menu.getByRole('button',{name:'Dodaj tag do kontaktów'}).click();
  const tagForm=page.locator('#lead-contact-bulk-body form');
  await tagForm.getByText('First Contact',{exact:true}).waitFor();
  await selectContactTags(tagForm,'Zapisani odbiorcy');
  await tagForm.getByRole('button',{name:'Przypisz tagi'}).click();
  await page.waitForFunction(()=>state.contacts.some(contact=>contact.name==='First Contact'&&contact.tags.includes('Zapisani odbiorcy')));
  await page.locator('#lead-company-status').selectOption('all');
  await page.evaluate(async()=>{
   await api('contacts',{name:'Second Contact',email:'contact@public.example',company:'Second Decorations',website:'https://second.example/'});
   await refresh();
  });
  await secondTile.getByText('W kontaktach',{exact:true}).waitFor();
  assert.equal(await background(secondTile),'rgb(237, 249, 242)');
  dashboard={...dashboard,companies:[first,{...second,status:'uncertain'}],jobs:[{kind:'signals',status:'done'},{kind:'signals',status:'running'}]};
  await searchBar.getByText('Weryfikacja sygnałów projektu',{exact:true}).waitFor();
  await completion.waitFor();
  let releaseStop;
  let creationReleased=true;
  const stopGate=new Promise(resolve=>releaseStop=resolve);
  await page.route('**/api/lead-search/stop-all',async route=>{
   assert.equal(creationReleased,true,'Stopping must wait for the new search to be created');
   await stopGate;
   dashboard={...dashboard,search:{...search,stopped:1},jobs:[{kind:'signals',status:'cancelled'}],active_agent_jobs:0};
   await route.fulfill({json:{stopped_jobs:1}});
  });
  const stopRequest=page.waitForRequest(request=>request.url().endsWith('/api/lead-search/stop-all'));
  await stopSearch.click();
  await stopRequest;
  const stoppingSearch=searchBar.getByRole('button',{name:'Przerywanie…',exact:true});
  assert.equal(await stoppingSearch.isDisabled(),true);
  releaseStop();
  await searchBar.waitFor({state:'hidden'});
  await page.unroute('**/api/lead-search/start');
  let releaseCreation;
  const creationGate=new Promise(resolve=>releaseCreation=resolve);
  await page.route('**/api/lead-search/start',async route=>{
   await creationGate;
   creationReleased=true;
   dashboard={...dashboard,search,active_agent_jobs:1,jobs:[{kind:'discover',status:'running'}]};
   await route.fulfill({json:dashboard});
  });
  creationReleased=false;
  const newSearchRequest=page.waitForRequest(request=>request.url().endsWith('/api/lead-search/start'));
  await page.locator('#dashboard-search-form button[type=submit]').click();
  await newSearchRequest;
  await stopSearch.click();
  await stoppingSearch.waitFor();
  releaseCreation();
  await searchBar.waitFor({state:'hidden'});
  let providers=['Hunter','OpenAI'];
  await page.route('**/api/openai-usage',route=>route.fulfill({json:{operations:[],billable_providers:providers}}));
  const bell=page.locator('#openai-cost-bell');
  await page.locator('#openai-cost-bell.billable-active').waitFor();
  assert.equal(await bell.evaluate(node=>getComputedStyle(node).color),'rgb(180, 35, 24)');
  assert.match(await bell.getAttribute('aria-label'),/Hunter, OpenAI/);
  providers=[];
  await page.locator('#openai-cost-bell.billable-active').waitFor({state:'detached'});
  await page.goto('http://localhost:8792/#prospecting/okazje');
  const discoverCard=page.locator('[data-discover-company]').filter({hasText:'FIRST'});
  await discoverCard.getByText('W kontaktach',{exact:true}).waitFor();
  assert.equal(await background(discoverCard),'rgb(237, 249, 242)');
  await page.locator('nav [data-view=companies]').click();
  await page.getByRole('button',{name:'Second Decorations',exact:true}).click();
  const savedPerson=page.locator('#modal details').filter({hasText:'Second Contact'});
  await savedPerson.locator('summary').click();
  const contactSource=savedPerson.getByRole('link',{name:'https://second.example/',exact:true});
  await contactSource.waitFor();
  assert.equal(await contactSource.getAttribute('data-contact-source'),String(await page.evaluate(()=>state.contacts.find(x=>x.name==='Second Contact').id)));
  await savedPerson.getByRole('link',{name:'Otwórz w Kontaktach',exact:true}).click();
  await page.locator('#modal').getByRole('heading',{name:'Szczegóły kontaktu',exact:true}).waitFor();
  await page.locator('#contact-send-history').getByText('Brak wiadomości do tego kontaktu.',{exact:true}).waitFor();
  await page.locator('#modal > button.close').click();
  const savedContactRow=page.locator('#contacts-body tr').filter({hasText:'Second Contact'});
  await savedContactRow.getByRole('button',{name:'Blokuj',exact:true}).click();
  await savedContactRow.getByText('Zablokowany',{exact:true}).waitFor();
  await savedContactRow.getByRole('button',{name:'Odblokuj',exact:true}).click();
  await savedContactRow.getByText('Aktywna',{exact:true}).waitFor();
  await page.locator('nav [data-view=reports]').click();
  const errorReport=page.locator('.reports-errors');
  await errorReport.locator('.reports-error-bar').waitFor();
  assert.equal(await errorReport.locator('[data-log-error-total]').innerText(),'1');
  assert.equal(await errorReport.locator('.reports-error-bar').evaluate(bar=>getComputedStyle(bar).fill),'rgb(180, 71, 48)');
  const completedCampaign=await page.evaluate(async()=>{
   await api('campaigns',{name:'Completed queue',offer:'Services',audience_mode:'all',
    steps:[{delay_days:0,subject:'Prepared subject',body:'Prepared body'}]});
   await refresh();
   const id=state.campaigns.find(campaign=>campaign.name==='Completed queue').id;
   await api('campaign/prepare',{id});
   return id;
  });
  const markSent=spawnSync('python',['-c',`
import sqlite3, sys, time
with sqlite3.connect(sys.argv[1]) as connection:
    connection.execute("UPDATE campaigns SET status='paused' WHERE id=?", (int(sys.argv[2]),))
    connection.execute("UPDATE messages SET status='sent',sent_at=? WHERE campaign_id=?", (time.time(),int(sys.argv[2])))
  `,path.join(data,'katie.sqlite3'),String(completedCampaign)]);
  assert.equal(markSent.status,0,markSent.stderr.toString());
  await page.locator('nav [data-view=contacts]').click();
  await savedContactRow.getByRole('button',{name:'Szczegóły kontaktu',exact:true}).click();
  const historyCampaign=page.locator('#contact-send-history').getByRole('link',{name:'Completed queue',exact:true});
  assert.equal(await historyCampaign.getAttribute('href'),`#campaigns/${completedCampaign}`);
  await historyCampaign.click();
  await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator('#campaign-workspace-header').getByRole('heading',{name:'Completed queue',exact:true}).waitFor();
  await page.getByRole('button',{name:'Uruchom ponownie',exact:true}).click();
  await page.getByRole('button',{name:'Przygotuj ponowne uruchomienie',exact:true}).click();
  await page.locator('#modal').getByRole('heading',{name:'Sprawdź przed wysyłką'}).waitFor();
  await page.locator('#campaign-workspace-header').getByRole('heading',{name:'Ponownie: Completed queue'}).waitFor();
  assert.equal(await page.locator('[data-confirm-send]').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('Progress browser QA passed: real counters, indeterminate requests, cross-view display, form preservation, completion, failure and mobile.');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
