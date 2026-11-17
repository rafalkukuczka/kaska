const readline = require('node:readline');

const profile = process.argv[2];
let context;
let launching;
let visible = false;
let nextTab = Date.now() * 1000;
let nextEvent = Date.now() * 1000;
let activeTab;
const tabs = new Map();
const ids = new WeakMap();
const events = [];

function emit(name, ...args) {
  nextEvent = Math.max(Date.now() * 1000, nextEvent + 1);
  events.push({ id: nextEvent, name, args });
  if (events.length > 500) events.shift();
}

function describe(tab) {
  return {
    id: tab.id, windowId: 1, url: tab.page.url(), pendingUrl: tab.pendingUrl,
    status: tab.loading ? 'loading' : 'complete', incognito: false, active: activeTab === tab.id,
    openerTabId: tab.opener,
  };
}

function register(page, opener) {
  const existing = ids.get(page);
  const source = tabs.get(opener);
  if (existing) {
    const tab = tabs.get(existing);
    if (tab && opener && !tab.opener) {
      tab.opener = opener;
      tab.group = source?.group ?? tab.id;
      tab.domain = source?.domain;
      emit('target', { sourceTabId: opener, sourceFrameId: 0, tabId: existing });
    }
    return tab;
  }
  const id = ++nextTab;
  const tab = { id, page, opener, group: source?.group ?? id, domain: source?.domain, loading: page.url() === 'about:blank' };
  tabs.set(tab.id, tab);
  ids.set(page, tab.id);
  activeTab = tab.id;
  emit('created', describe(tab));
  page.on('popup', popup => register(popup, tab.id));
  const mainNavigation = request => {
    try { return request.isNavigationRequest() && request.frame() === page.mainFrame(); }
    catch { return false; }
  };
  page.on('request', request => {
    if (!mainNavigation(request)) return;
    tab.pendingUrl = request.url();
    tab.loading = true;
    emit('updated', tab.id, { status: 'loading' }, describe(tab));
  });
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    tab.pendingUrl = undefined;
    emit('committed', { tabId: tab.id, frameId: 0, url: frame.url() });
    emit('updated', tab.id, { url: frame.url() }, describe(tab));
  });
  page.on('load', () => {
    tab.loading = false;
    emit('updated', tab.id, { status: 'complete' }, describe(tab));
  });
  page.on('requestfailed', request => {
    if (!mainNavigation(request)) return;
    if (tab.pendingUrl === request.url()) tab.pendingUrl = undefined;
    emit('error', { tabId: tab.id, frameId: 0, error: request.failure()?.errorText || 'Błąd nawigacji' });
  });
  page.on('close', () => {
    tabs.delete(tab.id);
    if (activeTab === tab.id) activeTab = [...tabs.keys()].at(-1);
    emit('removed', tab.id, { windowId: 1, isWindowClosing: false });
  });
  return tab;
}

async function start(headless) {
  if (context) return context;
  if (!launching) {
    launching = (async () => {
      let chromium;
      try {
        ({ chromium } = require('playwright'));
      } catch {
        throw Error('Brakuje Playwright. W katalogu Kaśki uruchom npm install --no-save playwright.');
      }
      const executablePath = process.env.KATIE_HEADLESS_CHROME_PATH;
      const options = { headless, chromiumSandbox: true, timeout: 30000, viewport: { width: 1440, height: 960 } };
      const browser = await chromium.launchPersistentContext(profile,
        executablePath ? { ...options, executablePath } : { ...options, channel: 'chrome' })
        .catch(() => { throw Error('Nie udało się uruchomić Chrome. Zainstaluj Chrome lub ustaw KATIE_HEADLESS_CHROME_PATH.'); });
      context = browser;
      visible = !headless;
      browser.on('page', page => {
        register(page);
        void page.opener().then(opener => {
          if (opener && ids.has(opener)) register(page, ids.get(opener));
        }).catch(() => undefined);
      });
      browser.on('close', () => {
        if (context === browser) {
          context = undefined;
          visible = false;
        }
      });
      for (const page of browser.pages()) register(page);
      return browser;
    })().finally(() => { launching = undefined; });
  }
  return launching;
}

function urlForTask(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Karta zadania wymaga adresu HTTPS.');
  return url.href;
}

function getTab(id) {
  const tab = tabs.get(id);
  if (!tab || tab.page.isClosed()) throw Error('Karta headless została zamknięta.');
  return tab;
}

function domain(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

async function script({ tabId, source, args }) {
  const tab = getTab(tabId);
  const opener = tabs.get(tab.opener);
  const expected = tab.domain ?? opener?.domain;
  const url = new URL(tab.page.url());
  if (visible || !expected || url.protocol !== 'https:' || domain(url.href) !== expected) {
    throw Error('Karta headless opuściła domenę scenariusza.');
  }
  tab.domain = expected;
  if (typeof source !== 'string' || !Array.isArray(args)) throw Error('Nieprawidłowy skrypt karty.');
  const { result, exceptionDetails } = await (async () => {
    const cdp = await (tab.cdp ??= context.newCDPSession(tab.page));
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id, worldName: 'katie-manual-headless',
    });
    return cdp.send('Runtime.evaluate', {
      contextId: executionContextId,
      expression: `(() => {
        const host = ${JSON.stringify(expected)};
        if (location.protocol !== 'https:' || ![host, 'www.' + host].includes(location.hostname)) {
          throw new Error('Karta headless opuściła domenę scenariusza.');
        }
        return (${source})(...${JSON.stringify(args)});
      })()`,
      awaitPromise: true, returnByValue: true,
    });
  })().catch(error => {
    if (/context|target.*closed|frame.*not found/i.test(error.message)) throw Error('Execution context was destroyed.');
    throw error;
  });
  if (exceptionDetails) throw Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return [{ frameId: 0, result: result.value }];
}

async function handle(method, args) {
  switch (method) {
    case 'events': return { events: events.filter(event => event.id > (args.after || 0)) };
    case 'get': return describe(getTab(args.id));
    case 'query': return [...tabs.values()].filter(tab => !args.active || tab.id === activeTab).map(describe);
    case 'script': return script(args);
    case 'close': {
      const group = tabs.get(args.id)?.group;
      if (group) await Promise.all([...tabs.values()].filter(tab => tab.group === group).map(tab => tab.page.close()));
      return {};
    }
    case 'login': {
      const url = urlForTask(args.url);
      if (context && !visible) await context.close();
      const browser = await start(false);
      const page = browser.pages()[0] || await browser.newPage();
      void page.goto(url, { waitUntil: 'commit' }).catch(() => undefined);
      return {};
    }
    case 'create': {
      const url = urlForTask(args.url);
      if (visible) throw Error('Zamknij okno logowania, aby wznowić tryb headless.');
      const browser = await start(true);
      if (visible) throw Error('Zamknij okno logowania, aby wznowić tryb headless.');
      const page = await browser.newPage(), tab = register(page);
      tab.domain = domain(url);
      tab.pendingUrl = url;
      void page.goto(url, { waitUntil: 'commit' }).catch(() => undefined);
      return describe(tab);
    }
    default: throw Error('Nieznane polecenie Chrome headless.');
  }
}

const input = readline.createInterface({ input: process.stdin });
input.on('line', async line => {
  const request = JSON.parse(line);
  try {
    const result = await handle(request.method, request.args);
    process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ id: request.id, error: error.message }) + '\n');
  }
});
input.on('close', async () => {
  await (context || await launching?.catch(() => undefined))?.close().catch(() => undefined);
  process.exit();
});
