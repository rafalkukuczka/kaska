const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

fs.mkdirSync('test-results', { recursive: true });
const dir = fs.mkdtempSync(path.resolve('test-results/headless-'));
const hook = path.join(dir, 'playwright-fixture.cjs');
fs.writeFileSync(hook, `
  const { chromium } = require(${JSON.stringify(require.resolve('playwright'))});
  const launch = chromium.launchPersistentContext.bind(chromium);
  chromium.launchPersistentContext = async (profile, options) => {
    if (!options.headless || !options.chromiumSandbox) throw new Error('Expected sandboxed headless Chrome');
    const context = await launch(profile, options);
    await context.route('https://fixture.test/**', route => route.fulfill({
      contentType: 'text/html',
      body: route.request().url().endsWith('/next') ? '<h1>Contact</h1>' :
        '<a href="/next" target="_blank">Open</a><script>window.siteVariable=1</script>',
    }));
    return context;
  };
`);

const test = `
from pathlib import Path
import sys
import time
from manual_headless import HeadlessBrowser

browser = HeadlessBrowser(Path.cwd(), Path(sys.argv[1]))

def rpc(method, **args):
    return browser.request({'method': method, 'args': args})

def wait(check):
    for _ in range(50):
        if result := check():
            return result
        time.sleep(.1)
    raise AssertionError('Timed out waiting for Chrome')

def script(tab, expression):
    return rpc('script', tabId=tab, source=expression, args=[])[0]['result']

try:
    source = rpc('create', url='https://fixture.test/')['id']
    wait(lambda: rpc('get', id=source)['url'] == 'https://fixture.test/')
    result = script(source, '''async () => {
      if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, {once:true}));
      window.scenarioState = 7;
      return { isolated: window.siteVariable === undefined, link: document.querySelector("a").textContent };
    }''')
    assert result == {'isolated': True, 'link': 'Open'}, result
    assert script(source, '() => window.scenarioState') == 7
    script(source, '() => { document.querySelector("a").click(); return true }')

    def popup():
        return next((event['args'][0]['tabId'] for event in rpc('events', after=0)['events']
                     if event['name'] == 'target' and event['args'][0]['sourceTabId'] == source), None)

    child = wait(popup)
    wait(lambda: rpc('get', id=child)['url'] == 'https://fixture.test/next')
    assert script(child, '() => document.querySelector("h1").textContent') == 'Contact'
    rpc('close', id=child)
    assert all(tab['id'] not in (source, child) for tab in rpc('query'))
    print('Verified headless Chrome, isolated scripting, popup tracking, and closing task tabs.')
finally:
    browser.close()
`;

const result = spawnSync('python', ['-c', test, dir], {
  stdio: 'inherit',
  timeout: 45000,
  env: { ...process.env, NODE_OPTIONS: `--require="${hook.split(path.sep).join('/')}"` },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
