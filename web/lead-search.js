const leadSearchSelection = new Map();
const leadResultsLayoutKey = 'kaska-lead-results-layout';
const ownSignalTypes = new Set(['demo_request','pricing_visit','content_download']);
const leadCompanyStatuses = {
  qualified:'Zakwalifikowana', uncertain:'Brak pełnych dowodów', pending:'W analizie',
  rejected:'Nie spełnia kryteriów', preliminary:'Wstępny wynik z projektu', cancelled:'Analiza przerwana',
};
const signalCheckLabels = {
  not_started:'Oczekuje na uruchomienie', pending:'W kolejce', running:'Sprawdzam',
  confirmed:'Potwierdzony', unconfirmed:'Brak potwierdzenia', failed:'Błąd analizy', cancelled:'Przerwano',
  requires_source:'Wymaga danych z projektu', paused:'Aktualizacje wstrzymane',
};
const leadJobDetail = detail => detail?.startsWith('Extra data:') ? 'AI zwróciło wynik w nieprawidłowym formacie.' : detail;
let leadNotificationSelection = null;
let leadSearchPollActive = false;
let leadBellCursor = 0;
let leadBellEpoch;
let leadBellPending = null;
const leadUpdateKinds = {
  company:['Firmy','Nowa firma'], signal:['Sygnały','Sygnał'],
  qualification:['Kwalifikacje','Kwalifikacja'], contact:['Decydenci','Decydent'],
};

function leadSearchRead(id, notifications = false) {
  const params = new URLSearchParams();
  if (id) params.set('id', id);
  if (notifications) params.set('notifications', '1');
  return fetch('/api/lead-search?' + params, {cache:'no-store'}).then(async response => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  });
}

function leadSearchNotification(row, selected = false) {
  const parts = [[row.companies,'Firmy'],[row.signals,'Sygnały'],[row.qualifications,'Kwalifikacje'],[row.contacts,'Decydenci']]
    .filter(([count]) => count).map(([count,label]) => `<span>${label} ${count}</span>`);
  return `<button type="button" class="lead-alert-item" data-lead-notification="${row.id}" data-project-id="${row.project_id}" data-lead-unread ${selected?'aria-current="true"':''}>
    <span class="lead-alert-title"><strong data-no-translate>${esc(row.query)}</strong><span class="badge"><span>Nowe</span> · ${row.count}</span></span>
    <small><span data-no-translate>${esc(row.project_name)}</span> · ${parts.join(' · ')}</small>
  </button>`;
}

function renderLeadBellCount(notifications) {
  const bell = $('#lead-notification-bell');
  const count = notifications.reduce((total, row) => total + row.count, 0);
  const badge = $('#lead-notification-count');
  badge.textContent = count;
  badge.hidden = !count;
  bell.setAttribute('aria-label', (count ? count + ' · ' : '') + translateUiText('Powiadomienia Discover'));
}

function renderLeadBellItems(notifications) {
  const content = $('#lead-notification-items');
  const markup = notifications.map(row => leadSearchNotification(row)).join('') || '<p class="hint">Brak nowych informacji.</p>';
  if (content._markup !== markup) {
    content.innerHTML = markup;
    content._markup = markup;
  }
}

function leadSearchBell(data) {
  if (data.project_id !== state?.seller_project.id || leadBellPending === simulationEpoch) return;
  if (leadBellEpoch !== simulationEpoch) {
    leadBellEpoch = simulationEpoch;
    leadBellCursor = 0;
  }
  const cursor = data.bell_seen_event ?? 0;
  if (cursor < leadBellCursor) return;
  leadBellCursor = cursor;
  const notifications = data.bell_notifications ?? data.notifications;
  renderLeadBellCount(notifications);
  if (!$('#lead-bell-menu').open) renderLeadBellItems(notifications);
}

$('#lead-bell-menu').addEventListener('toggle', async event => {
  if (!event.currentTarget.open || !state || leadBellPending === simulationEpoch) return;
  const epoch = simulationEpoch;
  leadBellPending = epoch;
  renderLeadBellCount([]);
  try {
    const result = await api('lead-search/bell', {});
    if (epoch !== simulationEpoch) return;
    leadBellEpoch = epoch;
    leadBellCursor = result.bell_seen_event;
    renderLeadBellItems(result.notifications);
    syncLanguages();
  } catch (error) {
    if (epoch === simulationEpoch) toast(error.message);
  } finally {
    if (leadBellPending === epoch) leadBellPending = null;
    void pollLeadSearch();
  }
});

function dashboardLeadResults() {
  return `<section class="panel lead-search-results" id="dashboard-lead-results" hidden><div class="panel-head">
      <h2>Wyniki wyszukiwania</h2><div class="actions">
        <button type="button" class="link" data-view="lead-discover">Nowe wyniki w Discover</button>
        <button type="button" class="secondary" data-lead-more hidden>Znajdź więcej firm</button>
        <button type="button" class="secondary" data-lead-signals hidden>Sprawdź sygnały projektu</button>
        <button type="button" class="link" data-view="prospecting">Wyszukiwanie kontaktów</button>
      </div></div>
      <div class="lead-run-controls" hidden><label for="lead-run-select">Wyszukiwanie</label><select id="lead-run-select"></select>
        <button type="button" class="secondary" data-lead-save>Zapisz wyszukiwanie</button></div>
      <div id="lead-query-criteria"></div><p id="lead-run-progress" role="status"></p>
      <div class="lead-agent-status" hidden>
        <details><summary>Praca agentów</summary><p class="hint" data-lead-other-jobs hidden></p><ul></ul>
          <button type="button" class="secondary" data-lead-job-more>Pokaż więcej zadań</button></details>
      </div>
      <div class="lead-results-layout" role="group" aria-label="Widok wyników">
        <label class="lead-status-filter" for="lead-company-status"><span>Status firmy</span>
          <select id="lead-company-status"><option value="all">Wszystkie statusy</option>
            ${Object.entries(leadCompanyStatuses).map(([status,label])=>`<option value="${status}">${label}</option>`).join('')}
          </select>
        </label>
        <small class="hint" data-lead-status-count role="status" hidden></small>
        <details class="lead-contact-bulk" data-lead-contact-bulk hidden>
          <summary>Operacje zbiorcze</summary>
          <div class="actions">
            <button type="button" class="secondary" data-lead-contact-search-all>Zbadaj dane kontaktowe</button>
            <button type="button" class="secondary" data-lead-contact-tag-all>Dodaj tag do kontaktów</button>
          </div>
        </details>
        <button type="button" class="secondary" data-lead-priority hidden>Najmocniejsze sygnały na górę</button>
        <button type="button" class="secondary" data-lead-layout="list" aria-pressed="true">Lista</button>
        <button type="button" class="secondary" data-lead-layout="tiles" aria-pressed="false">Kafelki</button>
      </div>
      <div id="lead-company-results" data-layout="list"></div>
      <p class="empty" data-lead-status-empty hidden>Brak firm o wybranym statusie.</p>
    </section>`;
}

function bindDashboardLeadSearch(root, project) {
  const form = $('#dashboard-search-form');
  const input = $('#dashboard-audience');
  const companyLimit = form.elements.company_limit;
  const button = form.querySelector('button[type=submit]');
  root._searchProgress = form.querySelector('[data-dashboard-search-progress]');
  const query = () => (input.value.trim() || sellerProject().audience || sellerProject().offer || '').trim().slice(0,1200);
  const sync = () => { button.disabled = Boolean(root._starting || root._stopping || query().length < 2); };
  root._run = leadSearchSelection.get(project.id);
  root._syncSearch = sync;
  const results = root.querySelector('#lead-company-results');
  const layouts = root.querySelectorAll('[data-lead-layout]');
  root.querySelector('#lead-company-status').addEventListener('change', () => filterLeadCompanies(root));
  function selectLayout(layout) {
    results.dataset.layout = layout === 'tiles' ? 'tiles' : 'list';
    layouts.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.leadLayout === results.dataset.layout)));
  }
  try { selectLayout(localStorage.getItem(leadResultsLayoutKey)); } catch {}
  layouts.forEach(button => button.addEventListener('click', () => {
    selectLayout(button.dataset.leadLayout);
    try { localStorage.setItem(leadResultsLayoutKey, results.dataset.layout); } catch {}
  }));
  input.addEventListener('input', () => {
    setSearchRefinement(project,input.value);
    sync();
  });
  companyLimit.addEventListener('change', () => {
    try { localStorage.setItem(dashboardCompanyLimitKey(project.id),companyLimit.value); } catch {}
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = query();
    const limit = Number(companyLimit.value);
    if (root._starting || root._stopping || text.length < 2) return;
    root._starting = true;
    renderDashboardSearchProgress(root);
    root._startRequest = run(button, async () => {
      await flushSellerProject();
      if (root._stopping || !root.isConnected || state.seller_project.id !== project.id) return;
      window.postMessage({type:'KATIE_LEAD_BROWSER_POLL'}, location.origin);
      const data = await api('lead-search/start', {query:text,company_limit:limit});
      if (!root.isConnected) return;
      root._run = data.search.id;
      root._generation = (root._generation || 0) + 1;
      leadSearchSelection.set(project.id,root._run);
      renderLeadSearchResults(root,data);
      leadSearchBell(data);
    }).finally(() => {
      root._starting = false;
      root._startRequest = null;
      renderDashboardSearchProgress(root);
      sync();
    });
  });
  $('#lead-run-select').addEventListener('change', event => {
    root._run = Number(event.target.value);
    root._generation = (root._generation || 0) + 1;
    leadSearchSelection.set(project.id,root._run);
    void pollLeadSearch();
  });
  root.querySelector('[data-lead-save]').addEventListener('click', event => {
    const button = event.currentTarget;
    void run(button, async () => {
      await api('lead-search/save',{id:root._run,saved:button.dataset.saved !== 'true'});
      await pollLeadSearch();
    });
  });
  root.querySelector('[data-lead-signals]').addEventListener('click', event => {
    void run(event.currentTarget, async () => {
      await api('lead-search/signals',{id:root._run});
      await pollLeadSearch();
    });
  });
  root.querySelector('[data-lead-more]').addEventListener('click', event => {
    void run(event.currentTarget, async () => {
      await api('lead-search/more',{id:root._run});
      toast('Rozszerzam wyszukiwanie.');
      await pollLeadSearch();
    });
  });
  root.querySelector('[data-lead-job-more]').addEventListener('click', event => {
    const tasks = event.currentTarget.closest('.lead-agent-status');
    tasks._limit += 24;
    tasks._renderItems();
  });
  root._searchProgress.querySelector('[data-lead-stop]').addEventListener('click', () => {
    if (root._stopping) return;
    const startRequest = root._startRequest;
    const wasStarting = root._starting;
    root._stopping = true;
    renderDashboardSearchProgress(root);
    sync();
    void run(null, async () => {
      try {
        // Wait for an in-flight creation request before stopping the new search.
        await startRequest;
        const result = await api('lead-search/stop-all',{});
        toast(translateUiText(result.stopped_jobs ? 'Przerwano wszystkie wyszukiwania agentowe.' :
          wasStarting ? 'Wyszukiwanie przerwane' : 'Brak wyszukiwań agentowych do przerwania.'));
        if (!root.isConnected || state.seller_project.id !== project.id) return;
        const generation = root._generation = (root._generation || 0) + 1;
        const data = await leadSearchRead(root._run);
        if (!root.isConnected || generation !== root._generation || data.project_id !== project.id) return;
        renderLeadSearchResults(root,data);
        leadSearchBell(data);
        syncLanguages();
      } finally {
        root._stopping = false;
        if (root.isConnected) renderDashboardSearchProgress(root);
        sync();
      }
    });
  });
  root.addEventListener('click', event => {
    const bulk = event.target.closest('[data-lead-contact-search-all], [data-lead-contact-tag-all]');
    if (bulk && root._run && root._contactCompanies?.length) {
      if (bulk.hasAttribute('data-lead-contact-search-all')) void researchAllLeadContacts(root._run, root._contactCompanies, project.id);
      else void tagLeadContacts(root._run, project.id);
      bulk.closest('details').open = false;
      return;
    }
    const button = event.target.closest('[data-lead-contact-search]');
    const company = button?.closest('[data-company]');
    if (company && root._run) void researchLeadContacts(root._run, company, project.id);
    const privateButton = event.target.closest('[data-lead-private-signal]');
    const privateCompany = privateButton?.closest('[data-company]');
    if (privateCompany && root._run) recordLeadProjectSignal(root,privateCompany);
  });
  root.querySelector('[data-lead-priority]').addEventListener('click', () => {
    const companies = [...results.querySelectorAll('[data-company]')];
    companies.sort((left,right) => Number(right.dataset.priority)-Number(left.dataset.priority));
    companies.forEach(item => results.append(item));
  });
  sync();
  void pollLeadSearch();
}

function filterLeadCompanies(root) {
  const status = root.querySelector('#lead-company-status').value;
  const companies = [...root.querySelectorAll('#lead-company-results > [data-company]')];
  let visible = 0;
  for (const company of companies) {
    company.hidden = status !== 'all' && company.dataset.status !== status;
    if (!company.hidden) visible++;
  }
  const count = root.querySelector('[data-lead-status-count]');
  const text = `${translateUiText('Widoczne firmy')} ${visible} / ${companies.length}`;
  if (count.textContent !== text) count.textContent = text;
  count.hidden = status === 'all' || !companies.length;
  root.querySelector('[data-lead-status-empty]').hidden = !companies.length || visible > 0;
}

function leadSearchCompany(company, node, hasOwnSignals, criterionCount, hasContacts) {
  if (!node) {
    node = document.createElement('details');
    node.className = 'lead-search-company';
    node.dataset.company = company.domain;
    node.innerHTML = '<summary><strong></strong><span></span><small class="hint lead-company-qualification" hidden></small><small class="hint lead-company-domain"></small><small class="saved-company-badge" hidden></small></summary><div class="lead-company-details"></div>';
  }
  node.classList.toggle('has-saved-contact', hasContacts);
  const contactBadge = node.querySelector('.saved-company-badge');
  contactBadge.hidden = !hasContacts;
  const contactLabel = translateUiText('W kontaktach');
  if (contactBadge.textContent !== contactLabel) contactBadge.textContent = contactLabel;
  const row = JSON.stringify([company,hasOwnSignals,criterionCount,uiLanguage]);
  if (node._row === row) return node;
  node._row = row;
  node.dataset.priority = company.priority?.level==='high' ? 2 : company.priority ? 1 : 0;
  node.querySelector('summary strong').textContent = company.name;
  const preliminary = company.origin !== 'agent' && ['pending','uncertain','local'].includes(company.status);
  node.dataset.status = preliminary ? 'preliminary' : company.status;
  node.querySelector('summary span').textContent = translateUiText(leadCompanyStatuses[node.dataset.status] || company.status);
  const qualification = node.querySelector('.lead-company-qualification');
  const evidence = company.evidence.filter(item => item.criterion >= 0);
  const confirmed = new Set(evidence.filter(item => item.result === 'confirmed').map(item => item.criterion)).size;
  qualification.hidden = company.status !== 'qualified' || !criterionCount;
  qualification.textContent = `${translateUiText('Potwierdzone kryteria')} ${confirmed}/${criterionCount}`;
  node.querySelector('.lead-company-domain').textContent = company.domain;
  const origin = company.origin === 'agent' ? 'Wynik odkryty przez agenta' : 'Dane z projektu';
  node.querySelector('.lead-company-details').innerHTML = `
    <div class="actions">
      <button type="button" class="secondary" data-lead-contact-search>Zbadaj dane kontaktowe</button>
      ${manualContactButton(company.name,company.domain)}
      ${hasOwnSignals ? '<button type="button" class="link" data-lead-private-signal>Dodaj własny sygnał</button>' : ''}
    </div>
    ${evidence.length ? '<h3>Dowody dopasowania do kryteriów</h3>' : ''}
    ${evidence.map(item => `<div class="lead-company-evidence"><strong data-no-translate>${esc(item.label)}</strong>
      <blockquote data-no-translate>${esc(item.quote)}</blockquote><p class="hint">${sourceLink(item.url,'Otwórz źródło')} · ${new Date(item.observed*1000).toLocaleDateString()}</p></div>`).join('')}
    ${company.priority ? `<div class="lead-company-evidence"><strong>Dlaczego teraz</strong>
      <p data-no-translate>${esc(company.priority.reason)}</p>
      ${company.priority.url ? sourceLink(company.priority.url,'Otwórz źródło') : '<p class="hint">Dane projektu</p>'}
    </div>` : ''}
    ${company.profile?.identity ? `<div class="lead-company-evidence">
      <strong>Identyfikacja spółki</strong> · <span data-no-translate>${esc(company.profile.identity.number)}</span>
      <p>${sourceLink(company.profile.identity.url,'Dane rejestrowe z Impressum')} · ${sourceLink(company.profile.identity.register_url,'Sprawdź w rejestrze')}</p>
    </div>` : ''}
    ${company.profile?.jobs?.length ? `<details><summary><span>Aktywne oferty pracy</span> · ${company.profile.active_jobs}</summary>
      <ul>${company.profile.jobs.map(job => `<li>${sourceLink(job.url,job.title)}
      ${job.technology?.length ? ` · <span data-no-translate>${esc(job.technology.join(', '))}</span>` : ''}
      <small data-no-translate>${esc(job.provider)}${job.published ? ' · '+esc(job.published) : ''}</small></li>`).join('')}</ul>
    </details>` : ''}
    <p class="hint">${origin}</p>
    ${company.snippet ? `<p data-no-translate>${esc(company.snippet)}</p>` : ''}
    ${company.url ? `<p>${sourceLink(company.url,'Źródło wyniku')}</p>` : ''}
    ${company.signals?.length ? '<h3>Sygnały z katalogu projektu</h3>' : ''}
    ${(company.signals || []).map(item => `<div class="lead-company-evidence"><strong data-no-translate>${esc(item.title)}</strong>
      <p class="hint"><span>${esc(item.label)}</span> · <span>${item.date_kind==='event'?'Data zdarzenia':item.date_kind==='active'?'Potwierdzono aktywność':'Data publikacji'}</span> · ${esc(item.source_date)}</p>
      <blockquote data-no-translate>${esc(item.quote)}</blockquote>${item.url ? sourceLink(item.url,'Otwórz źródło') : '<p class="hint">Dane projektu</p>'}</div>`).join('')}
    ${company.signal_checks?.length ? `<h3>Analiza katalogu sygnałów</h3><dl class="lead-signal-checks">
      ${company.signal_checks.map(check => `<div><dt>${esc(check.label)}</dt>
        <dd><span>${esc(signalCheckLabels[check.status] || check.status)}</span>${check.detail ? `<small>${esc(leadJobDetail(check.detail))}</small>` : ''}</dd></div>`).join('')}
      </dl>` : ''}
    ${company.evidence.filter(item => item.result === 'contact').map(item => `<div class="lead-company-evidence"><strong data-no-translate>${esc(item.label)}</strong>
      <blockquote data-no-translate>${esc(item.quote)}</blockquote><p class="hint">${sourceLink(item.url,'Otwórz źródło')} · ${new Date(item.observed*1000).toLocaleDateString()}</p></div>`).join('')}
    ${company.contact ? `<p><strong>Decydent</strong> · <span data-no-translate>${esc(company.contact)}</span></p>` : ''}`;
  return node;
}

function recordLeadProjectSignal(root,company) {
  const id=root._run, projectId=state.seller_project.id;
  const types=root._ownSignalTypes || [];
  modal(`<h2>Dodaj własny sygnał</h2><p data-no-translate>${esc(company.querySelector('summary strong').textContent)}</p>
    <form id="lead-project-signal-form">
      <label>Typ sygnału<select name="kind">${types.map(item=>`<option value="${esc(item.key)}">${esc(item.label)}</option>`).join('')}</select></label>
      <label>Data zdarzenia<input type="date" name="date" required></label>
      <label>Opis z formularza lub CRM<textarea name="detail" minlength="6" maxlength="600" required></textarea></label>
      <button class="primary" type="submit">Zapisz sygnał</button>
    </form>`);
  const form=$('#lead-project-signal-form');
  form.addEventListener('submit',event=>{
    event.preventDefault();
    void run(event.submitter,async()=>{
      if(state.seller_project.id!==projectId)return;
      await api('lead-search/project-signal',{...Object.fromEntries(new FormData(form)),id,domain:company.dataset.company});
      $('#modal').close();
      toast('Zapisano sygnał projektu.');
      await pollLeadSearch();
    });
  });
}

function leadContactChoices(data, field) {
  return data.contacts.map(person => `<article class="lead-contact-choice">
    <label class="check"><input type="checkbox" name="${field}" value="${esc(person.id)}">
      <span data-no-translate><strong>${esc(person.name)}</strong> · ${esc(person.email)}</span></label>
    ${person.role ? `<p class="hint" data-no-translate>${esc(person.role)}</p>` : ''}
    ${person.existing ? '<span class="badge gray">Już w kontaktach</span>' : ''}
    ${contactResearchDetails(person.attributes,true,person.existing?.id)}
  </article>`).join('');
}

function searchLeadContactData(searchId, company, projectId) {
  return api('lead-search/contact-search',{search_id:searchId,domain:company.domain,company:company.name,project_id:projectId,provider:'auto'});
}

function saveLeadContactData(data, company, projectId, selected, tags) {
  const item = {id:data.id,project_id:projectId,confirm_company:true,selected,tags};
  return data.simulated
    ? api('discover/contacts/add-simulation',{...item,company,contacts:data.contacts.filter(person=>selected.includes(person.id))})
    : api('lead-search/contact-add',item);
}

function leadContactSelection(fields, field) {
  return fields.getAll(field).map(Number);
}

async function researchLeadContacts(searchId, company, projectId) {
  const name = company.querySelector('summary strong').textContent.slice(0,200);
  const domain = company.dataset.company;
  const epoch = simulationEpoch;
  modal(`<h2>Dane kontaktowe</h2><p data-no-translate>${esc(name)} · ${esc(domain)}</p>
    <div id="lead-contact-content"><p class="hint" role="status">${monitoringSimulation?'Przygotowuję dane symulowane…':'Czytam stronę źródłową firmy w Chrome headless…'}</p></div>
    <div class="actions contact-intake-manual">${manualContactButton(name,domain,'Dodaj ręcznie')}</div>`);
  const panel = $('#lead-contact-content');
  const current = () => panel.isConnected && $('#modal').open && state.seller_project.id === projectId && simulationEpoch === epoch;
  try {
    const data = await searchLeadContactData(searchId,{domain,name},projectId);
    if (!current()) return;
    const log = renderEnrichmentTrace(data.enrichment);
    if (!data.contacts.length) {
      panel.innerHTML = log+'<p class="hint">Brak kontaktów z udokumentowanym adresem służbowym dla tej firmy.</p>';
      return;
    }
    panel.innerHTML = log+`<form id="lead-contact-save-form">
      ${data.simulated ? '<p class="notice">To przykładowe kontakty. Zapis trafi do kopii danych w symulacji.</p>' : ''}
      ${data.suggested_roles ? `<p class="hint"><span>Sugerowane stanowiska</span> · <span data-no-translate>${esc(data.suggested_roles)}</span></p>` : ''}
      <fieldset class="lead-contact-select"><legend>Wybierz kontakty do zapisania</legend>
      ${leadContactChoices(data,'selected')}</fieldset>
      ${contactTagsControl('', 'lead-contact-tags')}
      <div class="actions"><button class="primary" type="submit">Zapisz w Kontaktach</button>
      <button type="button" class="secondary close">Anuluj</button></div>
    </form>`;
    const form = panel.querySelector('form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      void run(event.submitter, async () => {
        if (!current()) return;
        const fields = new FormData(form);
        const selected = leadContactSelection(fields,'selected');
        const tags = contactTags(fields.get('tags'));
        if (!selected.length) throw new Error('Wybierz kontakty z wyników wyszukiwania.');
        if (!tags.length) throw new Error('Dodaj co najmniej jeden tag.');
        const saved = await saveLeadContactData(data,name,projectId,selected,tags);
        if (current()) $('#modal').close();
        await refresh();
        toast(`${translateUiText('Dodano kontaktów')} ${saved.added} · ${translateUiText('Uzupełniono istniejących')} ${saved.existing}`);
      });
    });
  } catch (error) {
    if (current()) panel.innerHTML = `<p class="error" role="alert">${esc(error.message)}</p>`;
  }
}

async function researchAllLeadContacts(searchId, companies, projectId) {
  const epoch = simulationEpoch;
  modal(`<h2>Zbadaj dane kontaktowe</h2><p class="hint">Badanie obejmuje wszystkie firmy z bieżącego wyszukiwania. Zamknięcie okna zatrzyma uruchamianie kolejnych badań.</p>
    <div id="lead-contact-bulk-body">
      <div class="dashboard-search-progress">
        <div class="background-progress-heading">
          <strong role="status"><span>Badanie firmy</span> <span data-bulk-current-company data-no-translate></span></strong>
          <div class="background-progress-actions">
            <span role="status" data-bulk-progress-count></span>
            <button type="button" class="link danger" data-stop-contact-research>Przerwij</button>
          </div>
        </div>
        <progress aria-label="Zbadane firmy" value="0" max="${companies.length}"></progress>
        <p class="hint" role="status" data-bulk-stopping hidden>Po bieżącym badaniu pokażę zebrane wyniki.</p>
      </div>
    </div>`);
  const panel = $('#lead-contact-bulk-body');
  const current = () => panel.isConnected && $('#modal').open && state.seller_project.id===projectId && simulationEpoch===epoch;
  const results = [];
  const companyName = panel.querySelector('[data-bulk-current-company]');
  const count = panel.querySelector('[data-bulk-progress-count]');
  const progress = panel.querySelector('progress');
  const stop = panel.querySelector('[data-stop-contact-research]');
  let stopped = false;
  stop.onclick = () => {
    stopped = true;
    stop.disabled = true;
    stop.textContent = translateUiText('Przerywanie…');
    panel.querySelector('[data-bulk-stopping]').hidden = false;
  };
  const completion = () => `${results.length} / ${companies.length} · ${progressPercent(results.length,companies.length)}`;
  syncLanguages();
  for (const company of companies) {
    if (!current()) return;
    if (stopped) break;
    companyName.textContent = company.name;
    count.textContent = completion();
    progress.value = results.length;
    try { results.push({company,data:await searchLeadContactData(searchId,company,projectId)}); }
    catch (error) { results.push({company,error:error.message}); }
  }
  if (!current()) return;
  const groups = results.map(({company,data,error},index) => `<details class="lead-contact-select">
    <summary><strong data-no-translate>${esc(company.name)}</strong> · ${data?.contacts.length??0}</summary>
    ${error?`<p class="error" data-no-translate>${esc(error)}</p>`:renderEnrichmentTrace(data?.enrichment)}
    ${data?leadContactChoices(data,'company-'+index):''}<p data-bulk-contact-save-error="${index}" role="alert"></p>
  </details>`).join('');
  const anyContacts = results.some(row=>row.data?.contacts.length);
  panel.innerHTML = `<p role="status">${stopped&&results.length<companies.length?'<strong>Badanie przerwane.</strong> ':''}<span>Zbadane firmy</span> ${completion()}</p>
    <form id="lead-contact-bulk-form">${groups}
    ${anyContacts?`<label class="check"><input type="checkbox" data-select-bulk-contact-all><span>Zaznacz wszystkie kontakty</span></label>
      ${contactTagsControl('', 'lead-bulk-research-tags')}
      <div class="actions"><button class="primary">Zapisz w Kontaktach</button></div>`:'<p>Brak kontaktów do zapisania.</p>'}</form>`;
  syncLanguages();
  if (!anyContacts) return;
  const form = panel.querySelector('form');
  const all = form.querySelector('[data-select-bulk-contact-all]');
  all.onchange = () => { for (const input of form.querySelectorAll('input[name^="company-"]:enabled')) input.checked=all.checked; };
  form.onsubmit = event => {
    event.preventDefault();
    void run(event.submitter,async()=>{
      const fields = new FormData(form),tags = contactTags(fields.get('tags'));
      const selections = results.map((row,index)=>({row,index,selected:leadContactSelection(fields,'company-'+index)}))
        .filter(entry=>entry.selected.length);
      if (!selections.length) throw Error('Wybierz kontakty z wyników wyszukiwania.');
      if (!tags.length) throw Error('Dodaj co najmniej jeden tag.');
      let added=0,existing=0,failed=false;
      for (const {row,index,selected} of selections) {
        if (!current()) break;
        const status=form.querySelector('[data-bulk-contact-save-error="'+index+'"]');
        try {
          const saved=await saveLeadContactData(row.data,row.company.name,projectId,selected,tags);
          added+=saved.added;existing+=saved.existing;
          for(const input of form.querySelectorAll('input[name="company-'+index+'"]')){
            if(selected.includes(Number(input.value))){input.checked=false;input.disabled=true}
          }
          status.textContent='';
        } catch(error) { failed=true;status.textContent=error.message;status.closest('details').open=true; }
      }
      if (current()&&!failed) $('#modal').close();
      await refresh();
      toast(`${translateUiText('Dodano kontaktów')} ${added} · ${translateUiText('Uzupełniono istniejących')} ${existing}`);
    });
  };
}

async function tagLeadContacts(searchId, projectId) {
  const epoch=simulationEpoch;
  modal('<h2>Dodaj tag do kontaktów</h2><div id="lead-contact-bulk-body"><p role="status">Wczytuję kontakty…</p></div>');
  const panel=$('#lead-contact-bulk-body');
  const current=()=>panel.isConnected&&$('#modal').open&&state.seller_project.id===projectId&&simulationEpoch===epoch;
  try{
    const {contacts}=await api('lead-search/contact-tag-candidates',{search_id:searchId,project_id:projectId});
    if(!current())return;
    if(!contacts.length){panel.textContent='Firmy z tego wyszukiwania nie mają zapisanych kontaktów.';return}
    panel.innerHTML=`<form><fieldset class="lead-contact-select"><legend>Kontakty zapisane w bazie · ${contacts.length}</legend>
      ${contacts.map(contact=>`<label class="check lead-contact-choice"><input type="checkbox" name="ids" value="${contact.id}" checked>
      <span data-no-translate><strong>${esc(contact.name)}</strong> · ${esc(contact.email)}</span></label>`).join('')}
      </fieldset>${contactTagsControl('', 'lead-bulk-existing-tags')}<button class="primary">Przypisz tagi</button></form>`;
    const form=panel.querySelector('form');
    form.onsubmit=event=>{
      event.preventDefault();
      void run(event.submitter,async()=>{
        if(!current())return;
        const fields=new FormData(form),ids=leadContactSelection(fields,'ids'),tags=contactTags(fields.get('tags'));
        if(!ids.length||!tags.length)throw Error('Wybierz kontakty i co najmniej jeden tag.');
        let updated=0;
        for(let start=0;start<ids.length&&current();start+=2000){
          const saved=await api('contacts/tags/bulk',{ids:ids.slice(start,start+2000),tags,project_id:projectId});
          updated+=saved.updated;
        }
        if(current())$('#modal').close();
        await refresh();
        toast(translateUiText('Zaktualizowano kontakty:')+' '+updated);
      });
    };
    syncLanguages();
  }catch(error){if(current())panel.textContent=error.message}
}

function dashboardSearchProgress(data, active) {
  if (monitoringSimulation) return null;
  const otherWork = data.active_agent_jobs ? {label:'Praca agentów'} : null;
  if (!data.search?.live || data.search.stopped) return otherWork;
  const pendingDiscovery = active.filter(job => job.kind === 'discover').length;
  if (pendingDiscovery) {
    const completed = data.jobs.filter(job => job.kind === 'discover' && ['done','failed'].includes(job.status)).length;
    return {label:'Wyszukiwanie nowych firm', completed, total:completed + pendingDiscovery};
  }
  const remaining = new Set(active.filter(job => job.kind === 'research' || job.kind === 'evaluate').map(job => job.domain));
  if (remaining.size) {
    const total = data.companies.length;
    const completed = data.companies.filter(company => company.status !== 'pending' && !remaining.has(company.domain)).length;
    return {label:'Analiza firm', completed, total};
  }
  if (active.some(job => job.kind === 'signals')) {
    const completed = data.jobs.filter(job => job.kind === 'signals' && ['done','failed'].includes(job.status)).length;
    const pending = active.filter(job => job.kind === 'signals').length;
    return {label:'Weryfikacja sygnałów projektu', completed, total:completed + pending};
  }
  return otherWork;
}

function renderDashboardSearchProgress(root) {
  const panel = root._searchProgress;
  const progress = (root._starting ? {label:'Uruchamiam wyszukiwanie…'} : root._lastSearchProgress) ||
    (root._stopping ? {label:'Praca agentów'} : null);
  panel.hidden = !progress;
  if (!progress) return;
  const label = panel.querySelector('#dashboard-search-stage'), bar = panel.querySelector('progress');
  const completion = panel.querySelector('[data-dashboard-search-completion]');
  const stop = panel.querySelector('[data-lead-stop]');
  const text = translateUiText(progress.label);
  if (label.textContent !== text) label.textContent = text;
  const counter = progress.total ? `${progress.completed} / ${progress.total} · ${progressPercent(progress.completed,progress.total)}` : translateUiText('W trakcie…');
  if (completion.textContent !== counter) completion.textContent = counter;
  stop.disabled = Boolean(root._stopping);
  const action = translateUiText(root._stopping ? 'Przerywanie…' : 'Przerwij');
  if (stop.textContent !== action) stop.textContent = action;
  stop.title = translateUiText('Zatrzymuje aktywne wyszukiwania');
  if (progress.total) {
    bar.max = progress.total;
    bar.value = progress.completed;
  } else {
    bar.removeAttribute('value');
    bar.removeAttribute('max');
  }
}

function renderLeadSearchResults(root, data) {
  const run = data.search;
  root.hidden = !run && !data.active_agent_jobs;
  const controls = root.querySelector('.lead-run-controls');
  controls.hidden = !run;
  const progress = root.querySelector('#lead-run-progress');
  const list = root.querySelector('#lead-company-results');
  root._contactCompanies = data.companies.map(company=>({name:company.name,domain:company.domain}));
  root.querySelector('[data-lead-contact-bulk]').hidden = !run || !root._contactCompanies.length;
  root.querySelector('.lead-results-layout').hidden = !run;
  const active = data.jobs.filter(job => ['pending','running'].includes(job.status));
  const failed = data.jobs.filter(job => job.status === 'failed');
  root._lastSearchProgress = dashboardSearchProgress(data, active);
  renderDashboardSearchProgress(root);
  renderLeadAgentActivity(root, data, active, failed);
  if (!run) {
    progress.textContent = translateUiText('Wpisz, kogo szukasz w tym projekcie.');
    root.querySelector('[data-lead-status-empty]').hidden = true;
    return;
  }
  root._run = run.id;
  const select = controls.querySelector('select');
  const options = data.searches.map(item => `<option value="${item.id}" ${item.id === run.id ? 'selected' : ''}>${item.saved ? '★ ' : ''}${esc(item.query)}</option>`).join('');
  if (select._options !== options) {
    select.innerHTML = options;
    select._options = options;
  }
  const save = controls.querySelector('[data-lead-save]');
  save.dataset.saved = Boolean(run.saved);
  save.textContent = translateUiText(run.saved ? 'Usuń z zapisanych' : 'Zapisz wyszukiwanie');
  const criteria = run.criteria.map(item => `<span class="badge gray" data-no-translate>${esc(item.label)}${item.alternatives.length > 1 ? ' · ' + esc(item.alternatives.join(' / ')) : ''}</span>`).join(' ');
  const criteriaNode = root.querySelector('#lead-query-criteria');
  if (criteriaNode._markup !== criteria) {
    criteriaNode.innerHTML = criteria;
    criteriaNode._markup = criteria;
  }
  const findMore = root.querySelector('[data-lead-more]');
  findMore.hidden = !run.live || Boolean(run.stopped) || data.companies.length >= 100;
  findMore.disabled = monitoringSimulation || active.some(job => job.kind === 'discover');
  const signalButton = root.querySelector('[data-lead-signals]');
  signalButton.hidden = !run.live || Boolean(run.stopped) || !data.companies.length || !data.signal_types?.length;
  const signalUpdatesPaused = data.signal_updates_enabled === false;
  signalButton.disabled = signalUpdatesPaused || monitoringSimulation || active.some(job => job.kind === 'signals');
  signalButton.title = signalUpdatesPaused ? translateUiText('Włącz aktualizacje sygnałów w Discover.') : '';
  const text = run.stopped ? 'Wyszukiwanie przerwane' : !run.live ? 'Wyniki z projektu · bez pracy agentów' :
    active.length ? (monitoringSimulation ? 'Praca agentów wstrzymana w trybie symulacji' : 'Agenci pracują w tle') :
    'Wyszukiwanie zakończone';
  const checks = data.companies.flatMap(company => company.signal_checks || []);
  const withoutSource = checks.filter(check => check.status === 'requires_source').length;
  const publicChecks = checks.filter(check => !ownSignalTypes.has(check.kind));
  const checked = publicChecks.filter(check => ['confirmed','unconfirmed'].includes(check.status)).length;
  const summary = `<strong>${text}</strong> · ${data.companies.length} <span>firm</span>${run.company_limit ? ' · <span>Limit</span> '+run.company_limit : ''}
    ${active.length ? ' · '+active.length+' <span>zadań w toku</span>' : ''}
    ${failed.length ? ' · '+failed.length+' <span>zadań wymaga sprawdzenia</span>' : ''}
    ${run.live && signalUpdatesPaused ? ' · <span>Aktualizacje sygnałów wyłączone</span>' : ''}
    ${publicChecks.length ? `<br><span>Sprawdzone sygnały publiczne</span> ${checked} / ${publicChecks.length}` : ''}
    ${withoutSource ? `${publicChecks.length ? ' · ' : '<br>'}${withoutSource} <span>sygnałów wymaga źródła danych</span>` : ''}`;
  if (progress._markup !== summary) { progress.innerHTML = summary; progress._markup = summary; }
  if (list._run !== run.id) { list.replaceChildren(); list._run = run.id; }
  let empty = list.querySelector('.empty');
  if (data.companies.length) empty?.remove();
  else if (!empty) list.innerHTML = '<p class="empty">Na razie brak pasujących firm.</p>';
  root._ownSignalTypes = (data.signal_types || []).filter(item=>ownSignalTypes.has(item.key));
  root.querySelector('[data-lead-priority]').hidden = !data.companies.some(company=>company.priority);
  const known = new Map(Array.from(list.children).map(node => [node.dataset.company,node]));
  const hasSavedContact = savedCompanyContacts();
  for (const company of data.companies) {
    const node = leadSearchCompany(company, known.get(company.domain),root._ownSignalTypes.length>0,run.criteria.length,hasSavedContact(company.name,company.domain));
    if (!node.isConnected) list.append(node);
  }
  const reveal = root._reveal?.searchId===run.id ? root._reveal : null;
  const target = reveal?.domain && [...list.children].find(node=>node.dataset.company===reveal.domain);
  if (target) root.querySelector('#lead-company-status').value = 'all';
  filterLeadCompanies(root);
  if (reveal) {
    root._reveal = null;
    list.querySelector('[data-lead-target]')?.removeAttribute('data-lead-target');
    if (target) {
      target.open = true;
      target.setAttribute('data-lead-target','');
      target.querySelector('summary').focus({preventScroll:true});
      target.scrollIntoView({block:'start'});
    } else {
      root.scrollIntoView({block:'start'});
      if (reveal.domain) toast(translateUiText('Nie znaleziono firmy w wynikach tego wyszukiwania.'));
    }
  }
}

function renderLeadAgentActivity(root, data, active, failed) {
  const tasks = root.querySelector('.lead-agent-status');
  const stage = {discover:'Wyszukiwanie nowych firm',research:'Zbieranie materiałów',evaluate:'Weryfikacja kryteriów',signals:'Weryfikacja sygnałów projektu'};
  const completedBrowser = data.jobs.filter(job => job.kind === 'research' && job.executor === 'chrome' && job.detail && job.status === 'done');
  const completedDiscovery = data.jobs.filter(job => job.kind === 'discover' && job.detail && job.status === 'done');
  const completedSignals = data.jobs.filter(job => job.kind === 'signals' && job.status === 'done');
  const stopped = data.jobs.filter(job => job.status === 'cancelled');
  const activity = [...active,...failed,...stopped,...completedDiscovery,...completedSignals,...completedBrowser];
  tasks.hidden = !activity.length && !data.active_agent_jobs;
  const otherJobs = Math.max(0, data.active_agent_jobs - active.length);
  const other = tasks.querySelector('[data-lead-other-jobs]');
  other.hidden = !otherJobs;
  other.textContent = translateUiText('Aktywne zadania w innych wyszukiwaniach') + ' · ' + otherJobs;
  const id = data.search?.id ?? null;
  if (tasks._run !== id) {
    tasks._run = id;
    tasks._limit = 12;
  }
  const signalLabels = new Map((data.signal_types || []).map(item => [item.key,item.label]));
  tasks._renderItems = () => {
    const taskText = activity.slice(0,tasks._limit).map(job =>
      `<li>${stage[job.kind]}${signalLabels.has(job.signal_kind) ? ' · '+esc(signalLabels.get(job.signal_kind)) : ''}
        ${job.domain && job.kind !== 'discover' ? ' · '+esc(job.domain) : ''}
        ${job.executor === 'chrome' && job.status === 'running' ? ' · Chrome headless' : ''}
        ${job.detail ? ' · '+esc(leadJobDetail(job.detail)) : ''}</li>`).join('');
    if (tasks._markup !== taskText) { tasks.querySelector('ul').innerHTML = taskText; tasks._markup = taskText; }
    tasks.querySelector('[data-lead-job-more]').hidden = activity.length <= tasks._limit;
  };
  tasks._renderItems();
}

function renderLeadDiscoverPage() {
  const project = state.seller_project;
  if ($('#lead-discover-feed')?.dataset.project === String(project.id)) return;
  $('#content').innerHTML = renderTop('<span data-no-translate>Discover</span>','Nowe informacje z wyszukiwań w tym projekcie.')+`
    <section class="lead-discover-grid" id="lead-discover-feed" data-project="${project.id}">
      <div class="panel"><h2>Wyszukiwania z aktualizacjami</h2>
        <label class="check lead-signal-updates"><input type="checkbox" data-lead-signal-updates aria-describedby="lead-signal-updates-hint" disabled><span>Aktualizuj sygnały w Discover</span></label>
        <p class="hint" id="lead-signal-updates-hint">Wyłącz, aby wstrzymać sprawdzanie sygnałów w tym projekcie i oszczędzać tokeny OpenAI. Włączenie wznawia oczekujące analizy.</p>
        <div id="lead-discover-groups"></div></div>
      <div class="panel"><div class="panel-head"><h2>Aktualizacje</h2><button type="button" class="secondary" data-lead-read hidden>Oznacz wszystkie jako przeczytane</button></div>
        <div class="lead-discover-filters" hidden>
          <label><span>Widok aktualizacji</span><select data-lead-update-scope><option value="all">Wszystkie aktualizacje</option><option value="unread">Tylko nowe</option></select></label>
          <label><span>Typ aktualizacji</span><select data-lead-update-kind><option value="all">Wszystkie typy</option>
            ${Object.entries(leadUpdateKinds).map(([kind,[label]])=>`<option value="${kind}">${label}</option>`).join('')}</select></label>
        </div>
        <div id="lead-discover-events"></div></div>
    </section><button type="button" class="link" data-view="discover">Otwórz katalog okazji</button>`;
  const root = $('#lead-discover-feed');
  const updates = root.querySelector('[data-lead-signal-updates]');
  updates.addEventListener('change', () => {
    const enabled = updates.checked;
    root._savingSignalUpdates = true;
    void run(updates, async () => {
      try {
        const saved = await api('lead-search/signal-updates',{project_id:project.id,enabled});
        if (!root.isConnected || state.seller_project.id !== project.id) return;
        root._generation = (root._generation || 0) + 1;
        root._data.signal_updates_enabled = saved.enabled;
        updates.checked = saved.enabled;
      } catch (error) {
        updates.checked = !enabled;
        throw error;
      }
    }).finally(() => { root._savingSignalUpdates = false; });
  });
  root.querySelector('[data-lead-read]').addEventListener('click', event =>
    run(event.currentTarget, () => markLeadNotifications(root)));
  for (const [field,control] of [['scope','[data-lead-update-scope]'],['kind','[data-lead-update-kind]']]) {
    const select = root.querySelector(control);
    select.addEventListener('change', () => {
      if (!leadNotificationSelection || !root._data) return;
      leadNotificationSelection[field] = select.value;
      renderLeadDiscoverEvents(root, root._data);
      syncLanguages();
    });
  }
  void pollLeadSearch();
}

async function markLeadNotifications(root) {
  const { search, events } = root._data || {};
  const newest = events?.find(event => event.unread);
  const selection = leadNotificationSelection;
  if (search?.id !== selection?.id || !newest) return;
  await api('lead-search/read',{id:search.id,through:newest.id});
  await loadLeadDiscoverSelection(root,selection);
}

function renderLeadDiscoverFeed(root, data) {
  root._data = data;
  if (!root._savingSignalUpdates) {
    const updates = root.querySelector('[data-lead-signal-updates]');
    updates.disabled = typeof data.signal_updates_enabled !== 'boolean';
    updates.checked = data.signal_updates_enabled === true;
  }
  const groups = root.querySelector('#lead-discover-groups');
  const notifications = data.notifications.filter(row => row.project_id === data.project_id);
  const active = new Set(notifications.map(row => row.id));
  const others = data.searches.filter(item => !active.has(item.id));
  const selectedId = leadNotificationSelection?.id;
  const groupMarkup = notifications.map(row => leadSearchNotification(row,row.id===selectedId)).join('') +
    (others.length ? `<details ${others.some(row=>row.id===selectedId)?'open':''}><summary>Historia wyszukiwań</summary>${others.map(item => `<button type="button" class="lead-alert-item" data-lead-notification="${item.id}" ${item.id===selectedId?'aria-current="true"':''}><strong data-no-translate>${esc(item.query)}</strong></button>`).join('')}</details>` : '');
  if (groups._markup !== groupMarkup) {
    const opened = groups.querySelector('details')?.open;
    groups.innerHTML = groupMarkup || '<p class="hint">Brak nowych informacji.</p>';
    if (opened && groups.querySelector('details')) groups.querySelector('details').open = true;
    groups._markup = groupMarkup;
  }
  renderLeadDiscoverEvents(root,data);
}

function renderLeadDiscoverEvents(root, data) {
  const events = root.querySelector('#lead-discover-events');
  const search = data.search;
  const selection = leadNotificationSelection;
  const selected = search && search.id===selection?.id;
  const {scope='all',kind='all'} = selection || {};
  const visible = data.events.filter(item => (scope!=='unread'||item.unread) && (kind==='all'||item.kind===kind));
  root.querySelector('.lead-discover-filters').hidden = !selected;
  root.querySelector('[data-lead-update-scope]').value = scope;
  root.querySelector('[data-lead-update-kind]').value = kind;
  root.querySelector('[data-lead-read]').hidden = !selected || !data.events.some(item => item.unread);
  const when = new Intl.DateTimeFormat(uiLanguage==='en'?'en-GB':'pl-PL',
    {dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Warsaw'});
  const markup = selected ? `<div class="line lead-discover-query"><strong data-no-translate>${esc(search.query)}</strong>
    <button type="button" class="link" data-lead-open="${search.id}">Otwórz wyniki</button></div>
    ${visible.length ? `<ul class="lead-event-list">${visible.map(item => {
      const content = `<span class="lead-alert-title"><strong data-no-translate>${esc(item.label)}</strong>${item.unread?'<span class="badge">Nowe</span>':''}</span>
        <small class="hint"><span>${esc(leadUpdateKinds[item.kind]?.[1]||'Aktualizacja')}</span>${item.domain?` · <span data-no-translate>${esc(item.domain)}</span>`:''}
        · <time data-no-translate>${esc(when.format(item.created*1000))}</time></small>`;
      return `<li ${item.unread?'class="lead-event-unread"':''}>${item.domain?
        `<button type="button" class="lead-event-link" data-lead-open="${search.id}" data-lead-domain="${esc(item.domain)}">${content}<span class="lead-event-arrow" aria-hidden="true">↗</span></button>`:content}</li>`;
    }).join('')}</ul>` :
      `<p class="hint">${data.events.length?'Brak aktualizacji pasujących do filtra.':'Brak aktualizacji dla tego wyszukiwania.'}</p>`}` :
    '<p class="hint">Wybierz wyszukiwanie, aby przejrzeć jego aktualizacje.</p>';
  if (events._markup !== markup) { events.innerHTML = markup; events._markup = markup; }
}

async function loadLeadDiscoverSelection(root, selected) {
  const generation = root._generation = (root._generation || 0) + 1;
  const data = await leadSearchRead(selected.id);
  if (!root.isConnected || root._generation!==generation || leadNotificationSelection!==selected || selected.project!==data.project_id) return;
  leadSearchBell(data);
  renderLeadDiscoverFeed(root,data);
  syncLanguages();
}

async function pollLeadSearch() {
  if (!state || leadSearchPollActive) return;
  leadSearchPollActive = true;
  const project = state.seller_project.id;
  const epoch = simulationEpoch;
  const currentView = view;
  if (currentView === 'dashboard' && !monitoringSimulation) window.postMessage({type:'KATIE_LEAD_BROWSER_POLL'}, location.origin);
  const root = $('#dashboard-lead-results') || $('#lead-discover-feed');
  const generation = root?._generation;
  if (leadNotificationSelection?.project !== project) leadNotificationSelection = null;
  const selection = leadNotificationSelection;
  try {
    const data = await leadSearchRead(currentView === 'lead-discover' ? selection?.id : root?._run,
      !['dashboard','lead-discover'].includes(currentView));
    if (epoch!==simulationEpoch || state.seller_project.id !== project || data.project_id !== project || (root?.isConnected && generation!==root._generation)) return;
    leadSearchBell(data);
    if (root?.isConnected && currentView === view && generation === root._generation && selection === leadNotificationSelection) {
      if (currentView === 'dashboard' && !root._starting) renderLeadSearchResults(root,data);
      if (currentView === 'lead-discover') renderLeadDiscoverFeed(root,data);
    }
  } catch (error) {
    if (root?.isConnected) {
      const feedback = root.querySelector('#lead-run-progress,#lead-discover-events');
      if (feedback) feedback.textContent = error.message;
    }
  } finally {
    leadSearchPollActive = false;
  }
}

document.addEventListener('click', event => {
  const fromBell = event.target.closest('[data-lead-notifications-open]');
  const notification = event.target.closest('[data-lead-notification]') ||
    (fromBell && $('#lead-notification-items [data-lead-notification]'));
  const open = event.target.closest('[data-lead-open]');
  if (open) {
    const searchId = Number(open.dataset.leadOpen);
    leadSearchSelection.set(state.seller_project.id, searchId);
    view = 'dashboard';
    render();
    const results = $('#dashboard-lead-results');
    results._reveal = {searchId,domain:open.dataset.leadDomain};
    if (results._run!==searchId) {
      results._run = searchId;
      results._generation = (results._generation || 0) + 1;
    }
    void pollLeadSearch();
  }
  if (!notification) {
    if (fromBell) { $('#lead-bell-menu').open=false; view='lead-discover'; render(); }
    if (event.target.closest('[data-view="lead-discover"]') || !event.target.closest('#lead-bell-menu')) $('#lead-bell-menu').open = false;
    return;
  }
  $('#lead-bell-menu').open = false;
  void run(null, async () => {
    const selected = {id:Number(notification.dataset.leadNotification),
      project:Number(notification.dataset.projectId) || state.seller_project.id,
      scope:notification.hasAttribute('data-lead-unread')?'unread':'all',kind:'all'};
    if (selected.project !== state.seller_project.id) {
      await chooseSellerProject('seller-projects/select',{project_id:selected.project});
      if (state.seller_project.id !== selected.project) return;
    }
    leadNotificationSelection = selected;
    view = 'lead-discover';
    render();
    await loadLeadDiscoverSelection($('#lead-discover-feed'),selected);
  });
});

setInterval(() => { void pollLeadSearch(); }, 2500);
