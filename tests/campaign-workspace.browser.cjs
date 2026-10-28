const {chromium}=require('playwright');
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const data=fs.mkdtempSync(path.resolve('test-results/campaign-workspace-'));
 const server=spawn('python',['tests/browser_server.py'],{env:{...process.env,APP_PORT:'8813',APP_DATA_DIR:data,SMTP_HOST:'',SMTP_FROM:'',IMAP_HOST:'',OPENAI_API_KEY:'',HUNTER_API_KEY:''},stdio:'pipe'});let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Katie:'))resolve()});server.on('error',reject);server.on('exit',c=>reject(Error('Server exit '+c)));setTimeout(()=>reject(Error('Server timeout')),10000).unref()});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],sends=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/campaign/status'))sends.push(request.url())});
  await page.addInitScript(()=>localStorage.setItem('kaska-simulation','off'));
  await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
  await page.goto('http://localhost:8813');await page.waitForFunction(()=>state?.seller_project);
  const id=await page.evaluate(async()=>{
   for(let i=1;i<=31;i++)await api('contacts',{name:'Person '+String(i).padStart(2,'0'),email:`person${i}@workspace.example`,company:'Example',tags:['Clients']});
   await refresh();const ids=state.contacts.slice(0,9).map(contact=>contact.id);
   await api('campaigns',{name:'Workspace campaign',offer:'Services for companies',audience_mode:'selected',contact_ids:ids,steps:[{delay_days:0,subject:'First {{name}}',body:'Hello {{name}}'},{delay_days:3,subject:'Follow-up {{name}}',body:'Next message'}]});await refresh();return state.campaigns[0].id;
  });
  await page.locator('nav [data-view=campaigns]').click();await page.locator('[data-action=campaign]').click();
  await page.waitForFunction(()=>campaignWorkspace(selectedCampaign).data&&!campaignWorkspace(selectedCampaign).loading);
  assert.equal(await page.locator('[data-campaign-summary=Odbiorcy]').innerText(),'9');
  assert.equal(await page.locator('[data-campaign-summary=Kroki]').innerText(),'2');
  assert.equal(await page.locator('[data-campaign-summary=Wiadomości]').innerText(),'0');
  assert.equal(await page.locator('.campaign-person').count(),9);
  assert.equal(await page.locator('#campaign-messages').isVisible(),false);
  await page.locator('#campaign-workspace-header [data-action=prepare]').click();
  await page.waitForFunction(()=>campaignWorkspace(selectedCampaign).data?.summary.messages===18&&!campaignWorkspace(selectedCampaign).loading);
  assert.equal(await page.locator('.campaign-person').count(),9);
  await page.locator('.campaign-person>summary').first().click();
  assert.equal(await page.locator('.campaign-person[open] .campaign-person-message').count(),2);
  await page.locator('.campaign-person[open] [data-action=message]').first().click();
  await page.locator('#message-form textarea').waitFor();assert.ok((await page.locator('#message-form textarea').inputValue()).includes('Person'));
  await page.locator('#modal>.close').click();
  await page.locator('[data-campaign-review]').click();
  await page.locator('#campaign-messages tbody tr').first().waitFor();
  assert.equal(await page.locator('#campaign-messages tbody tr').count(),18);
  assert.equal(await page.locator('#campaign-workspace-header [data-action=campaign-status][data-status=active]').isVisible(),true);
  await page.locator('[data-campaign-tab=sequence]').click();
  assert.equal(await page.locator('.campaign-sequence-step').count(),2);
  await page.locator('.campaign-sequence-step>summary').first().click();
  await page.locator('[data-campaign-tab=sequence]').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-campaign-tab=messages]').getAttribute('aria-selected'),'true');
  const seed=spawnSync('python',['-c',`
import sqlite3,sys,time
c=sqlite3.connect(sys.argv[1]);cid=int(sys.argv[2])
c.execute("UPDATE messages SET status='sent',sent_at=? WHERE campaign_id=? AND position=0",(time.time(),cid))
contact=c.execute('SELECT MIN(contact_id) FROM messages WHERE campaign_id=?',(cid,)).fetchone()[0]
c.execute("UPDATE contacts SET status='replied' WHERE id=?",(contact,))
c.execute("UPDATE messages SET status='cancelled' WHERE campaign_id=? AND contact_id=? AND position=1",(cid,contact))
c.execute("INSERT INTO replies(contact_id,subject,body,received,uid,project_id,campaign_id) VALUES(?,'Re','Interested',?,'workspace-reply',1,?)",(contact,time.time(),cid))
c.execute("UPDATE campaigns SET status='paused' WHERE id=?",(cid,));c.commit()
`,path.join(data,'katie.sqlite3'),String(id)],{encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);
  await page.evaluate(async()=>refresh());await page.locator('[data-campaign-tab=results]').click();
  await page.waitForFunction(()=>campaignWorkspace(selectedCampaign).data?.summary.replies===1);
  assert.deepEqual(await page.locator('.campaign-result-metrics strong').allInnerTexts(),['9','9','1','11.1%']);
  await page.screenshot({path:'test-results/campaign-workspace-results-desktop.png',fullPage:true});
  await page.locator('[data-campaign-tab=recipients]').click();
  assert.equal(await page.locator('.campaign-person').count(),9);
  await page.screenshot({path:'test-results/campaign-workspace-recipients-desktop.png',fullPage:true});
  await page.locator('[data-action=back]').click();
  const other=await page.evaluate(async()=>{await api('campaigns',{name:'Large audience',offer:'Services',steps:[{delay_days:0,subject:'Hello',body:'Hello'}]});await refresh();return state.campaigns[0].id});
  await page.locator(`[data-action=campaign][data-id="${other}"]`).click();
  await page.waitForFunction(()=>campaignWorkspace(selectedCampaign).data?.total===30); // one contact has replied
  await page.locator('[data-campaign-recipient-size]').selectOption('10');
  await page.waitForFunction(()=>!campaignWorkspace(selectedCampaign).loading&&campaignWorkspace(selectedCampaign).size===10);
  assert.equal(await page.locator('.campaign-person').count(),10);
  await page.locator('[data-campaign-recipient-page="2"]').click();
  await page.waitForFunction(()=>campaignWorkspace(selectedCampaign).data?.page===2);
  assert.equal(await page.locator('.campaign-person').count(),10);
  await page.route('**/api/campaign/workspace?**',route=>route.fulfill({status:500,json:{error:'Fixture unavailable'}}));
  await page.evaluate(()=>loadCampaignWorkspace(selectedCampaign));
  await page.locator('[data-campaign-workspace-retry]').waitFor();
  await page.unroute('**/api/campaign/workspace?**');await page.locator('[data-campaign-workspace-retry]').click();
  await page.waitForFunction(()=>!campaignWorkspace(selectedCampaign).loading&&!campaignWorkspace(selectedCampaign).error);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'test-results/campaign-workspace-mobile.png',fullPage:true});
  await page.locator('#ui-language').selectOption('en');await page.getByRole('tab',{name:'Recipients',exact:true}).waitFor();
  await page.evaluate(async()=>chooseSellerProject('seller-projects/create',{name:'Private workspace'}));
  assert.equal(await page.locator('.campaign-person').count(),0);
  assert.deepEqual(sends,[]);assert.deepEqual(errors,[]);
  console.log('Campaign workspace QA passed: 9 unique recipients / 18 messages, staged actions, grouped preview, four tabs, results from real data, paging, retry, keyboard navigation, English, mobile and project isolation; no sends.');
 }finally{if(browser)await browser.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
