// Local read-only reference inspection. No application data is changed.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
(async()=>{
 const server=spawn('python',['-m','http.server','8790','--bind','127.0.0.1','--directory','.reference'],{stdio:'ignore'});
 let browser;
 try{
  await new Promise(r=>setTimeout(r,1000));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto('http://127.0.0.1:8790/meet-katie.mp4');
  await page.evaluate(async()=>{const blob=await fetch('/meet-katie.mp4').then(r=>r.blob());const v=document.querySelector('video');v.src=URL.createObjectURL(blob);v.load()});
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2,{},{timeout:20000});
  const duration=await page.locator('video').evaluate(v=>v.duration);
  console.log('Duration:',duration);
  await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.id='frames';const v=document.querySelector('video');canvas.width=v.videoWidth;canvas.height=v.videoHeight;canvas.style='position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:white;z-index:99';document.body.append(canvas)});
  for(let i=0;i<10;i++){
   const at=Math.min(duration-.1,Math.max(.1,duration*i/10));
   await page.locator('video').evaluate(async(v,t)=>{v.muted=true;v.currentTime=t;await v.play()},at);
   await page.waitForTimeout(350);
   await page.evaluate(()=>{const v=document.querySelector('video');v.pause();document.querySelector('canvas').getContext('2d').drawImage(v,0,0)});
   await page.screenshot({path:`.reference/frame-${String(i).padStart(2,'0')}.png`});
  }
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
