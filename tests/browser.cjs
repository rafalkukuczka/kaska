const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

(async()=>{
  const data=fs.mkdtempSync(path.resolve('test-results/dashboard-browser-'));
  const server=spawn('python',['tests/browser_server.py'],{env:{...process.env,APP_PORT:'8788',APP_DATA_DIR:data,SMTP_HOST:'',SMTP_FROM:'',IMAP_HOST:'',OPENAI_API_KEY:'',HUNTER_API_KEY:'browser-fixture-only'},stdio:'pipe'});
  let browser;
  try{
    await new Promise((resolve,reject)=>{
      server.stdout.on('data',data=>{if(data.toString().includes('Katie:'))resolve()});
      server.on('error',reject);
      server.on('exit',code=>reject(Error('Server exit '+code)));
      setTimeout(()=>reject(Error('Server timeout')),10000).unref();
    });
    const options={headless:true};
    if(process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
    browser=await chromium.launch(options);
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>localStorage.setItem('kaska-monitoring-simulation','off'));
    await page.goto('http://localhost:8788');
    await page.waitForFunction(()=>typeof state!=='undefined'&&state?.csrf);

    await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
    assert.equal(await page.locator('.dashboard-welcome').isVisible(),true);
    assert.equal(await page.locator('.dashboard-stats').isVisible(),true);
    assert.equal(await page.evaluate(()=>typeof renderProspecting==='function'&&typeof renderContactsView==='function'),true);
    await page.locator('#dashboard-audience').fill('Manufacturers operating in Poland');
    assert.equal(await page.locator('#dashboard-search-form button[type=submit]').isDisabled(),false);

    await page.locator('nav [data-view="contacts"]').click();
    await page.getByRole('heading',{name:'Kontakty',exact:true}).waitFor();
    await page.getByRole('button',{name:'Dodaj kontakt'}).click();
    await page.locator('#contact-form [name="name"]').fill('Dashboard QA');
    await page.locator('#contact-form [name="email"]').fill('dashboard-qa@example.com');
    await page.getByRole('button',{name:'Zapisz kontakt'}).click();
    await page.getByRole('cell',{name:'Dashboard QA dashboard-qa@example.com'}).waitFor();

    await page.locator('nav [data-view="campaigns"]').click();
    await page.getByRole('heading',{name:'Kampanie',exact:true}).waitFor();
    await page.locator('nav [data-view="prospecting"]').click();
    await page.getByRole('heading',{name:'Leady',exact:true}).waitFor();
    await page.locator('nav [data-view="dashboard"]').click();
    await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log('Browser smoke passed: dashboard render/search, contacts CRUD, campaign and prospecting navigation, mobile layout.');
  }finally{
    if(browser)await browser.close();
    server.kill();
  }
})().catch(error=>{console.error(error);process.exitCode=1});
