const https = require('node:https');
const { isIP } = require('node:net');

async function readPublicContactPage() {
  const source = location.origin + location.pathname;
  const visible = node => node.getClientRects().length && getComputedStyle(node).visibility === 'visible';
  const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 250) : '';
  const emails = value => (String(value || '').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi) || [])
    .map(email => email.toLowerCase()).filter(email => email.length <= 254);
  const phone = value => {
    const text = clean(value).replace(/^tel:/i, '').split(';')[0];
    return /^\+?[0-9 ()./\-]{7,45}$/.test(text) && text.replace(/\D/g, '').length >= 7 ? text : '';
  };
  if (/^(captcha|access denied|just a moment|verify.*human)\b/i.test(document.title) ||
      document.querySelector('#challenge-form')) return { source, blocked: true };
  const reveal = /^(dane kontaktowe|pokaż (kontakt|dane kontaktowe|numer telefonu|adres e-mail)|contact details|contact info|show (contact details|contact info|phone number|email address)|kontaktdaten|kontaktdaten anzeigen)$/i;
  const buttons = Array.from(document.querySelectorAll('button, details > summary')).filter(node =>
    visible(node) && !node.closest('form') && node.getAttribute('type') !== 'submit' &&
    reveal.test(clean(node.getAttribute('aria-label') || node.innerText))).slice(0, 3);
  for (const node of buttons) {
    if (node.parentElement instanceof HTMLDetailsElement) node.parentElement.open = true;
    else if (node.getAttribute('aria-expanded') !== 'true') node.click();
  }
  if (buttons.length) await new Promise(resolve => setTimeout(resolve, 450));
  const found = new Map();
  const add = (value, fields = {}) => {
    for (const email of emails(value)) {
      const previous = found.get(email) || {};
      found.set(email, { email, name: previous.name || clean(fields.name), company: previous.company || clean(fields.company),
        role: previous.role || clean(fields.role), phone: previous.phone || phone(fields.phone) });
    }
  };
  const visit = (entry, depth = 0) => {
    if (!entry || typeof entry !== 'object' || depth > 4) return;
    if (Array.isArray(entry)) { entry.slice(0, 30).forEach(value => visit(value, depth + 1)); return; }
    if ([entry['@type']].flat().some(type => typeof type === 'string' && /(?:^|\/)Person$/.test(type))) {
      add(entry.email, { name: entry.name, role: entry.jobTitle, company: entry.worksFor?.name, phone: entry.telephone });
    }
    visit(entry['@graph'], depth + 1);
    visit(entry.mainEntity, depth + 1);
  };
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 15)) {
    if (script.textContent.length > 100000) continue;
    try { visit(JSON.parse(script.textContent)); } catch { /* Ignore malformed structured data. */ }
  }
  for (const link of Array.from(document.querySelectorAll('a[href^="mailto:" i]')).filter(visible).slice(0, 50)) {
    const card = link.closest('.h-card, .vcard, [itemtype$="/Person"]');
    const text = selector => card?.querySelector(selector)?.innerText;
    const tel = card?.querySelector('a[href^="tel:" i]');
    let address = link.getAttribute('href').slice(7).split('?')[0];
    try { address = decodeURIComponent(address); } catch { /* Keep the original address. */ }
    add(address, { name: text('[itemprop="name"], .p-name, .fn'), role: text('[itemprop="jobTitle"], .p-job-title, .title'),
      company: text('[itemprop="worksFor"], .p-org, .org'), phone: tel?.innerText || tel?.getAttribute('href') });
  }
  add(document.body?.innerText.slice(0, 50000));
  if (found.size === 1) {
    const links = Array.from(document.querySelectorAll('a[href^="tel:" i]')).filter(visible);
    if (links.length === 1) {
      const entry = found.values().next().value;
      entry.phone ||= phone(links[0].innerText) || phone(links[0].getAttribute('href'));
    }
  }
  return { source, contacts: [...found.values()].slice(0, 20), selection: {} };
}

function download(url, address, method, limit, timeout, charge) {
  return new Promise((resolve, reject) => {
    const family = isIP(address);
    const request = https.request(url, {
      method, family, agent: false, lookup: (_host, _options, done) => done(null, address, family),
      headers: { 'user-agent': 'KaskaContactResearch/1.0', 'accept-encoding': 'identity' },
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > limit || !charge(chunk.length)) request.destroy(Error('Odpowiedź ze strony jest zbyt duża.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const headers = { ...response.headers };
        for (const name of ['connection', 'transfer-encoding', 'content-length', 'set-cookie']) delete headers[name];
        resolve({ status: response.statusCode, headers, body: Buffer.concat(chunks) });
      });
    });
    const deadline = setTimeout(() => request.destroy(Error('Strona odpowiedziała za późno.')), timeout);
    request.once('close', () => clearTimeout(deadline));
    request.once('error', reject);
    request.end();
  });
}

async function readContactPages(browser, { url, hosts, source = readPublicContactPage.toString(), followLinks = true }, fetchPage = download) {
  const addresses = new Map(Object.entries(hosts));
  const allowed = value => {
    const address = new URL(value);
    return address.protocol === 'https:' && !address.port && !address.username && !address.password &&
      addresses.has(address.hostname);
  };
  const context = await browser.newContext({ offline: true, serviceWorkers: 'block', acceptDownloads: false });
  const deadline = Date.now() + 23000;
  let budget = 10_000_000;
  let requests = 0;
  const redirects = new Map();
  const charge = size => {
    if (size > budget) return false;
    budget -= size;
    return true;
  };
  try {
    await context.routeWebSocket('**', route => route.close());
    await context.route('**/*', async route => {
      const request = route.request();
      const url = request.url();
      const timeout = Math.min(deadline - Date.now(), 6000);
      if (timeout <= 0 || ++requests > 60 || budget <= 0 || !allowed(url) ||
          !['GET', 'HEAD'].includes(request.method()) || ['image','font','media'].includes(request.resourceType())) {
        return route.abort();
      }
      try {
        const result = await fetchPage(url, addresses.get(new URL(url).hostname), request.method(), Math.min(budget, 2_000_000), timeout, charge);
        const location = result.headers.location;
        if (result.status >= 300 && result.status < 400 && location) {
          const next = new URL(location, url).href;
          if (!request.isNavigationRequest() || !allowed(next)) return route.abort();
          // Start the next navigation explicitly so it goes through the same pinned transport.
          redirects.set(url, next);
          return route.fulfill({ status: 200, contentType: 'text/html', body: '' });
        }
        await route.fulfill(result);
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const pages = [];
    const visited = new Set();
    const queue = followLinks ? [...new Set([url, new URL('/', url).href])] : [url];
    while (queue.length && pages.length < 4 && visited.size < 10 && deadline > Date.now()) {
      const target = queue.shift();
      if (visited.has(target)) continue;
      visited.add(target);
      try {
        const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: Math.min(deadline - Date.now(), 7000) });
        const redirect = redirects.get(page.url());
        if (redirect) {
          queue.unshift(redirect);
          continue;
        }
        if (!response?.ok() || !allowed(page.url())) continue;
        const { frameTree } = await cdp.send('Page.getFrameTree');
        const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
          frameId: frameTree.frame.id, worldName: 'kaska-contact-research',
        });
        const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
          contextId: executionContextId, expression: `(${source})(true)`,
          awaitPromise: true, returnByValue: true, timeout: 2000,
        });
        const candidate = result.value;
        if (exceptionDetails || !candidate) continue;
        if (candidate.blocked) continue;
        pages.push({ ...candidate, source: page.url().split('#')[0] });
        if (followLinks && pages.length === 1) {
          const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).filter(anchor =>
            /(?:kontakt|contact|team|zesp[oó]ł|impressum|our-people|people|staff)/i.test(anchor.innerText + ' ' + anchor.pathname)
          ).slice(0, 30).map(anchor => anchor.origin + anchor.pathname));
          queue.unshift(...[...new Set(links)].filter(link => allowed(link) && !visited.has(link)));
        }
      } catch {
        if (page.isClosed()) break;
      }
    }
    if (!pages.length) throw Error('Nie udało się odczytać publicznej strony. Sprawdź adres lub otwórz stronę w widocznym Chrome.');
    return { pages };
  } finally {
    await context.close();
  }
}

module.exports = { readContactPages };
