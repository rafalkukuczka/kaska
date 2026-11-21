let companyRequest;

async function renderCompanies() {
 const projectId=state.seller_project.id;
 companyRequest?.abort();
 const request=new AbortController();
 companyRequest=request;
 $('#content').innerHTML=renderTop('Firmy','Kontakty, kwalifikacja i sygnały sprzedażowe w bieżącym projekcie.')+
  '<section class="panel"><label for="company-search">Szukaj po nazwie lub domenie</label><input id="company-search" type="search"><p role="status" data-company-status>Wczytuję firmy…</p><div data-company-results></div></section>';
 const root=$('[data-company-results]'),status=$('[data-company-status]'),search=$('#company-search');
 const isCurrent=()=>root.isConnected&&view==='companies'&&state.seller_project.id===projectId&&!request.signal.aborted;
 let selection=0;
 try {
  const response=await fetch('/api/companies',{signal:request.signal,cache:'no-store'});
  const rows=await response.json();
  if(!isCurrent())return;
  if(!response.ok)throw Error(rows.error||'Nie udało się wczytać firm.');
  let page=0;
  const show=()=>{
   const query=search.value.trim().toLocaleLowerCase();
   const matches=rows.filter(row=>[row.name,row.domain].some(value=>value.toLocaleLowerCase().includes(query)));
   status.textContent=uiLanguage==='en'?`${matches.length} companies`:`Firmy: ${matches.length}`;
   root.innerHTML=matches.length?`<div class="table-wrap"><table><thead><tr><th>Firma</th><th>Dopasowanie kontaktów</th><th>Sygnały z ostatnich 30 dni</th><th>Kontakty</th></tr></thead><tbody>${matches.slice(page*25,(page+1)*25).map(row=>`<tr>
    <td><button type="button" class="link" data-company-key="${esc(row.key)}" data-no-translate>${esc(row.name)}</button><small data-no-translate>${esc(row.domain)}</small></td>
    <td>${companyFit(row.fit)}</td><td>${row.recent_signals}</td><td>${row.contact_count}</td></tr>`).join('')}</tbody></table></div>
    ${matches.length>25?`<div class="actions"><button type="button" class="secondary" data-company-page="-1" ${page===0?'disabled':''}>Wstecz</button><span>${page+1} / ${Math.ceil(matches.length/25)}</span><button type="button" class="secondary" data-company-page="1" ${(page+1)*25>=matches.length?'disabled':''}>Dalej</button></div>`:''}`
    :empty('Brak firm','Firmy pojawią się po zapisaniu kontaktów, wyszukaniu osób lub znalezieniu okazji w projekcie.');
   syncLanguages();
  };
  search.oninput=()=>{page=0;show()};
  root.onclick=event=>{
   const button=event.target.closest('button');
   if(button?.dataset.companyKey)void run(button,async()=>{
    const current=++selection;
    const url='/api/companies?'+new URLSearchParams({key:button.dataset.companyKey});
    const response=await fetch(url,{signal:request.signal,cache:'no-store'}).catch(error=>{
     if(isCurrent())throw error;
    });
    if(!response)return;
    const detail=await response.json();
    if(!isCurrent()||current!==selection)return;
    if(!response.ok)throw Error(detail.error||'Nie udało się wczytać firmy.');
    showCompany(detail);
   });
   if(button?.dataset.companyPage){page+=Number(button.dataset.companyPage);show()}
  };
  show();
 }catch(error){if(isCurrent())status.textContent=error.message}
}

function companyFit(fit){
 if(!fit.matched&&!fit.uncertain&&!fit.rejected)return 'Brak oceny';
 if(uiLanguage==='en')return [fit.matched&&`${fit.matched} matched`,fit.uncertain&&`${fit.uncertain} to review`,
  fit.rejected&&`${fit.rejected} rejected`].filter(Boolean).join(' · ');
 return [fit.matched&&`${fit.matched} dopasowanych`,fit.uncertain&&`${fit.uncertain} do sprawdzenia`,
  fit.rejected&&`${fit.rejected} odrzuconych`].filter(Boolean).join(' · ');
}

function showCompany(company){
 const links=(sources,contactId)=>{
  const items=(sources||[]).map(url=>sourceLink(url,url,contactId)).filter(Boolean);
  return items.length?`<ul>${items.map(link=>`<li>${link}</li>`).join('')}</ul>`:'';
 };
 const assessments={matched:'Dopasowany',uncertain:'Do sprawdzenia',rejected:'Odrzucony'};
 const decisions={interested:'Interesujący',rejected:'Odrzucony',new:'Do sprawdzenia'};
 modal(`<h2 data-no-translate>${esc(company.name)}</h2><p class="hint" data-no-translate>${esc(company.domain)}</p>
  <p><strong>Dopasowanie kontaktów</strong> · ${companyFit(company.fit)}</p>
  <p><strong>Sygnały aktualnej potrzeby</strong> · ${company.recent_signals} z ostatnich 30 dni</p>
  <h3>Kontakty i oceny z Leadów</h3>${company.contacts.map(person=>`<details class="signal-card"><summary><strong data-no-translate>${esc(person.name)}</strong> · ${person.saved?'W kontaktach':'Kandydat'}${person.qualification?' · '+assessments[person.qualification]:''}</summary>
  <p data-no-translate>${esc(person.email)} · ${esc(person.role)}</p>
  ${person.created?`<p class="hint">${esc(new Date(person.created*1000).toLocaleDateString(uiLanguage==='en'?'en-GB':'pl-PL'))}</p>`:''}
  ${person.fit_reason?`<p data-no-translate>${esc(person.fit_reason)}</p>`:''}
  ${person.missing_data?`<p data-no-translate>${esc(person.missing_data)}</p>`:''}
  ${links(person.sources,person.contact_id)}</details>`).join('')||'<p>Brak kontaktów.</p>'}
  <h3>Sygnały z Odkrywaj</h3>${company.signals.map(signal=>`<details class="signal-card"><summary><strong data-no-translate>${esc(signal.title)}</strong> · ${decisions[signal.decision]}</summary>
  <p class="hint">${signal.published_date?'Publikacja '+esc(signal.published_date):''} ${signal.event_date?'Zdarzenie '+esc(signal.event_date):''}</p>
  <p data-no-translate>${esc(signal.summary)}</p><blockquote data-no-translate>${esc(signal.quote)}</blockquote>
  ${links(signal.sources)}</details>`).join('')||'<p>Brak zapisanych sygnałów.</p>'}`);
 syncLanguages();
}
