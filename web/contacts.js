function contactTags(value){
 if(value&&typeof value==='object'&&!Array.isArray(value))value=value.tags??value.target_group??'';
 if(typeof value==='string'){try{if(value.startsWith('['))value=JSON.parse(value)}catch{}}
 const values=Array.isArray(value)?value:String(value||'').split(';'),seen=new Set();
 return values.map(tag=>String(tag).normalize('NFC').trim()).filter(tag=>{const key=tag.toLocaleLowerCase();if(!tag||seen.has(key))return false;seen.add(key);return true});
}
function contactTagsControl(value='',id='contact-tags'){
 const selected=contactTags(value),known=new Map();
 [...(state.contact_tags||[]),...selected].forEach(tag=>{if(!known.has(tag.toLocaleLowerCase()))known.set(tag.toLocaleLowerCase(),tag)});
 return `<section class="contact-tag-control" data-contact-tag-control><label for="${esc(id)}-select" class="contact-tag-label">Tagi kontaktu</label><select id="${esc(id)}-select" data-contact-tag-select><option value="">Wybierz istniejący tag…</option>${[...known.values()].sort((a,b)=>a.localeCompare(b)).map(tag=>`<option data-contact-tag-option value="${esc(tag)}" data-no-translate ${selected.some(value=>value.toLocaleLowerCase()===tag.toLocaleLowerCase())?'disabled':''}>${esc(tag)}</option>`).join('')}</select><div class="contact-tag-selected" data-selected-contact-tags>${contactTagChips(selected)}</div><div class="contact-tag-add"><input type="text" data-new-contact-tag maxlength="3000" aria-label="${esc(translateUiText('Nowy tag'))}" placeholder="Nowy tag"><button type="button" class="secondary" data-add-contact-tag>+ Dodaj tag</button></div><p class="hint">Wybierz tag z listy lub dodaj nowy. Możesz przypisać wiele tagów.</p><input id="${esc(id)}" name="tags" type="hidden" value="${esc(selected.join('; '))}"></section>`;
}
function contactTagChips(tags){return tags.map(tag=>`<span class="contact-tag-chip"><span data-no-translate>${esc(tag)}</span><button type="button" class="link" data-remove-contact-tag="${esc(tag)}" aria-label="${esc(translateUiText('Usuń tag')+': '+tag)}">×</button></span>`).join('')}
let adminTagsOpen=false;
function applyTagAdministrationChange(result){
 if(!result.old_name)return;
 const key=result.old_name.toLocaleLowerCase(),replace=value=>contactTags(contactTags(value).flatMap(tag=>tag.toLocaleLowerCase()===key?(result.name?[result.name]:[]):[tag]));
 for(const project of Object.values(simulationResults))for(const contact of project.contacts||[]){contact.tags=replace(contact);contact.target_group=contact.tags.join('; ')}
 for(const panel of discoverContactPanels.values())for(const email of Object.keys(panel.contactTags))panel.contactTags[email]=replace(panel.contactTags[email]);
 try{const draft=JSON.parse(localStorage.getItem(builderDraftKey())||'null');if(draft){draft.audience_tags=replace(draft.audience_tags||draft.target_group||'');localStorage.setItem(builderDraftKey(),JSON.stringify(draft))}}catch{}
 if(contactGroupFilter==='group:'+result.old_name)contactGroupFilter=result.name?'group:'+result.name:'all';
 saveSimulationResults();
}
function renderAdministration(){
 const rows=state.tag_catalog||[];
 $('#content').innerHTML=renderTop('Administracja','Zarządzaj ustawieniami wspólnymi dla wszystkich projektów.')+`<details class="panel" id="admin-tags" ${adminTagsOpen?'open':''}><summary><strong>Edycja tagów</strong> <span class="badge gray">${rows.length}</span></summary><p class="hint">Dodawaj tagi do wyboru w kontaktach i kampaniach. Zmiana nazwy aktualizuje wszystkie przypisania.</p><form id="admin-add-tag" class="actions"><label for="admin-new-tag">Nowy tag</label><input id="admin-new-tag" name="name" maxlength="100" required><button class="primary" type="submit">+ Dodaj tag</button></form><div class="table-wrap"><table class="admin-tags-table"><thead><tr><th>Tag</th><th>Kontakty</th><th>Kampanie</th><th>Działanie</th></tr></thead><tbody>${rows.map(row=>`<tr><td><input data-admin-tag-name="${row.id}" value="${esc(row.name)}" maxlength="100" aria-label="${esc(translateUiText('Nazwa tagu'))}" data-no-translate></td><td>${row.contacts}</td><td>${row.campaigns}</td><td><div class="actions"><button type="button" class="secondary" data-admin-tag-save="${row.id}">Zapisz</button><button type="button" class="link danger" data-admin-tag-delete="${row.id}">Usuń tag</button></div></td></tr>`).join('')||'<tr><td colspan="4">Brak tagów. Dodaj pierwszy tag.</td></tr>'}</tbody></table></div></details>`;
 renderLanguageSettings();
 const panel=$('#admin-tags');panel.ontoggle=()=>{if(panel.isConnected)adminTagsOpen=panel.open};
 $('#admin-add-tag').onsubmit=event=>{event.preventDefault();run(event.submitter,async()=>{await api('admin/tags',{action:'create',name:event.target.elements.name.value});await refresh();toast(translateUiText('Tag dodany.'))})};
 document.querySelectorAll('[data-admin-tag-save]').forEach(button=>button.onclick=()=>run(button,async()=>{const result=await api('admin/tags',{action:'rename',id:Number(button.dataset.adminTagSave),name:$(`[data-admin-tag-name="${button.dataset.adminTagSave}"]`).value});applyTagAdministrationChange(result);await refresh();toast(translateUiText('Tag zmieniony.'))}));
 document.querySelectorAll('[data-admin-tag-delete]').forEach(button=>button.onclick=()=>{
  const tag=rows.find(row=>row.id===Number(button.dataset.adminTagDelete));
  modal(`<h2>Usunąć tag?</h2><p data-no-translate><strong>${esc(tag.name)}</strong></p><p>Tag zostanie usunięty z katalogu, kontaktów i wyboru odbiorców kampanii. Kontakty pozostaną w bazie.</p>${tag.campaigns?'<p class="notice">Powiązane aktywne kampanie zostaną wstrzymane, a oczekujące wiadomości anulowane. Przed dalszą wysyłką sprawdź odbiorców.</p>':''}<div class="actions"><button type="button" class="primary danger" data-admin-tag-confirm>Usuń tag</button><button type="button" class="secondary close">Anuluj</button></div>`);
  $('[data-admin-tag-confirm]').onclick=event=>run(event.currentTarget,async()=>{const result=await api('admin/tags',{action:'delete',id:tag.id});applyTagAdministrationChange(result);$('#modal').close();await refresh();toast(translateUiText('Tag usunięty.'))});
 });
}
function syncContactTagControl(root,values){
 const storage=root.querySelector('[name=tags]'),selected=contactTags(values??storage.value);
 storage.value=selected.join('; ');
 root.querySelector('[data-selected-contact-tags]').innerHTML=contactTagChips(selected);
 root.querySelectorAll('[data-contact-tag-option]').forEach(option=>option.disabled=selected.some(tag=>tag.toLocaleLowerCase()===option.value.toLocaleLowerCase()));
 root.querySelector('[data-contact-tag-select]').value='';
 storage.dispatchEvent(new Event('input',{bubbles:true}));
}
document.addEventListener('change',event=>{
 if(!event.target.matches('[data-contact-tag-select]')||!event.target.value)return;
 const root=event.target.closest('[data-contact-tag-control]');
 const selected=contactTags([...contactTags(root.querySelector('[name=tags]').value),event.target.value]);
 if(selected.length>30){event.target.value='';toast('Kontakt może mieć maksymalnie 30 tagów.');return}
 syncContactTagControl(root,selected);
});
function addContactTag(root){
 const input=root.querySelector('[data-new-contact-tag]'),tags=contactTags(input.value),options=[...root.querySelectorAll('[data-contact-tag-option]')];
 if(!tags.length)return;
 if(tags.some(tag=>tag.length>100||/[\u0000-\u001f\u007f]/.test(tag))){toast('Tag: maksymalnie 100 znaków.');return}
 const chosen=contactTags([...contactTags(root.querySelector('[name=tags]').value),...tags.map(tag=>options.find(option=>option.value.toLocaleLowerCase()===tag.toLocaleLowerCase())?.value||tag)]);
 if(chosen.length>30){toast('Kontakt może mieć maksymalnie 30 tagów.');return}
 for(const tag of tags){
  const existing=options.find(option=>option.value.toLocaleLowerCase()===tag.toLocaleLowerCase());
  if(existing)continue;
  const option=document.createElement('option');option.dataset.contactTagOption='';option.setAttribute('data-no-translate','');option.value=tag;option.textContent=tag;
  root.querySelector('[data-contact-tag-select]').append(option);options.push(option);
 }
 input.value='';syncContactTagControl(root,chosen);input.focus();
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-add-contact-tag]');if(button)addContactTag(button.closest('[data-contact-tag-control]'))});
document.addEventListener('click',event=>{const button=event.target.closest('[data-remove-contact-tag]');if(!button)return;const root=button.closest('[data-contact-tag-control]');syncContactTagControl(root,contactTags(root.querySelector('[name=tags]').value).filter(tag=>tag!==button.dataset.removeContactTag))});
document.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('[data-new-contact-tag]')){event.preventDefault();addContactTag(event.target.closest('[data-contact-tag-control]'))}});
document.addEventListener('click',event=>{
 if(!event.target.closest('[data-action=sales-glossary]'))return;
 modal(`<h2>${esc(translateUiText('Słownik sprzedaży'))}</h2><dl class="sales-glossary" data-no-translate>${salesGlossaryEntries.map(([pl,en,descriptionPl,descriptionEn])=>`<dt><strong>${esc(uiLanguage==='en'?en:pl)}</strong>${pl!==en?` <small>(${esc(uiLanguage==='en'?pl:en)})</small>`:''}</dt><dd>${esc(uiLanguage==='en'?descriptionEn:descriptionPl)}</dd>`).join('')}</dl><p class="hint"><a href="https://www.salesforce.com/blog/small-business/prospect-vs-lead/" target="_blank" rel="noopener noreferrer">Salesforce · Lead / Prospect / Sales opportunity ↗</a></p>`);
});
function contactGroupForm(id){
 const contact=state.contacts.find(c=>c.id===id);if(!contact)return;
 modal(`<h2>Tagi kontaktu</h2><p data-no-translate>${esc(contact.name)} · ${esc(contact.email)}</p><form id="contact-group-form">${contactTagsControl(contact.tags||'')}<p class="hint">Pozostaw puste, aby usunąć wszystkie tagi kontaktu.</p><div class="actions"><button class="primary">Zapisz tagi</button><button type="button" class="secondary close">Anuluj</button></div></form>`);
 $('#contact-group-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{await api('contact/tags',{id,tags:e.target.elements.tags.value});$('#modal').close();await refresh();toast('Tagi kontaktu zapisane.')})};
}
function bulkContactTagsPanel({id,count,tags,tagId,clearAttribute,applyAttribute,extra=''}){
 return `<div id="${id}" class="contact-bulk-panel"><div class="actions"><span><span>Zaznaczono kontaktów:</span> <strong id="${id==='contact-bulk-panel'?'contact-bulk-count':'lead-bulk-count'}">${count}</strong></span><button type="button" class="link" ${clearAttribute}>Odznacz wszystkie</button></div>${contactTagsControl(tags,tagId)}<p class="hint">Tagi zostaną dodane do zaznaczonych osób. Dotychczasowe tagi i statusy pozostaną zachowane. Checkbox w nagłówku zaznacza tylko widoczne kontakty.</p><button type="button" class="primary" ${applyAttribute}>Przypisz tagi do zaznaczonych</button>${extra}</div>`;
}
function renderContactsView(){
 const scope=state.seller_project.id+':'+monitoringSimulation;
 if(contactBulkScope!==scope){contactBulkSelected.clear();contactBulkScope=scope}
 const known=new Set(state.contacts.map(contact=>contact.id));for(const id of contactBulkSelected)if(!known.has(id))contactBulkSelected.delete(id);
 if(document.activeElement?.closest('#contact-bulk-panel')?.querySelector('[data-contact-tag-select]')&&document.activeElement.matches('input,select'))return;
 $('#content').innerHTML=renderTop('Kontakty','Twoja baza. Twoje relacje.',`<div class="actions"><button class="secondary" data-action="import">Import CSV</button><button class="primary" data-action="new-contact">+ Dodaj kontakt</button></div>`)+`<section class="panel"><div class="filters"><input id="search" class="search" value="${esc(contactSearch)}" placeholder="Szukaj osoby, firmy, adresu lub tagu…" aria-label="Szukaj kontaktu"><select id="contact-group-filter" aria-label="Filtr tagów"><option value="all">Wszystkie tagi</option><option value="ungrouped">Bez tagów</option>${(state.contact_tags||[]).map(tag=>`<option value="${esc('group:'+tag)}" data-no-translate>${esc(tag)}</option>`).join('')}</select></div><label class="contact-bulk-toggle"><input type="checkbox" data-contact-bulk-toggle ${contactBulkMode?'checked':''} ${contactBulkBusy?'disabled':''}><span>Operacje zbiorcze</span></label>${contactBulkMode?bulkContactTagsPanel({id:'contact-bulk-panel',count:contactBulkSelected.size,tags:contactBulkTags,tagId:'bulk-contact-tags',clearAttribute:'data-contact-bulk-clear',applyAttribute:'data-contact-bulk-apply'}):''}<div class="table-wrap"><table><thead><tr>${contactBulkMode?`<th class="contact-bulk-check"><input type="checkbox" data-contact-bulk-all aria-label="${esc(translateUiText('Zaznacz wszystkie widoczne kontakty'))}" ${contactBulkBusy?'disabled':''}></th>`:''}<th>Osoba</th><th>Firma / stanowisko</th><th>Tagi</th><th>Status</th><th>Działanie</th></tr></thead><tbody id="contacts-body"></tbody></table></div></section>`;
 $('#contact-group-filter').value=contactGroupFilter;if($('#contact-group-filter').selectedIndex<0){contactGroupFilter='all';$('#contact-group-filter').value='all'}
 renderContacts(contactSearch);
 $('#search').oninput=event=>{contactSearch=event.target.value;renderContacts(contactSearch)};
 $('#contact-group-filter').onchange=event=>{contactGroupFilter=event.target.value;renderContacts(contactSearch)};
 $('[data-contact-bulk-toggle]').onchange=event=>{if(contactBulkBusy)return;contactBulkMode=event.target.checked;contactBulkSelected.clear();renderContactsView()};
 const clear=$('[data-contact-bulk-clear]');if(clear)clear.onclick=()=>{contactBulkSelected.clear();renderContacts(contactSearch)};
 const apply=$('[data-contact-bulk-apply]');if(apply)apply.onclick=()=>run(null,applyBulkContactTags);
 if(contactBulkBusy)$('#contact-bulk-panel')?.querySelectorAll('input,select,button').forEach(input=>input.disabled=true);
}
function syncContactBulkControls(){
 const count=$('#contact-bulk-count');if(count)count.textContent=contactBulkSelected.size;
 const visible=visibleContacts(),selected=visible.filter(contact=>contactBulkSelected.has(contact.id)).length,all=$('[data-contact-bulk-all]');
 if(all){all.checked=!!visible.length&&selected===visible.length;all.indeterminate=selected>0&&selected<visible.length;all.disabled=contactBulkBusy||!visible.length}
 const apply=$('[data-contact-bulk-apply]');if(apply)apply.disabled=contactBulkBusy||!contactBulkSelected.size||!contactBulkTags.length;
 const clear=$('[data-contact-bulk-clear]');if(clear)clear.disabled=contactBulkBusy||!contactBulkSelected.size;
}
document.addEventListener('input',event=>{if(event.target.name==='tags'&&event.target.closest('#contact-bulk-panel')){contactBulkTags=contactTags(event.target.value);syncContactBulkControls()}});
document.addEventListener('change',event=>{
 if(contactBulkBusy)return;
 if(event.target.matches('[data-contact-bulk-id]')){const id=Number(event.target.dataset.contactBulkId);event.target.checked?contactBulkSelected.add(id):contactBulkSelected.delete(id);syncContactBulkControls()}
 if(event.target.matches('[data-contact-bulk-all]')){for(const contact of visibleContacts())event.target.checked?contactBulkSelected.add(contact.id):contactBulkSelected.delete(contact.id);renderContacts(contactSearch)}
});
async function applyBulkContactTags(){
 if(contactBulkBusy)return;
 const ids=[...contactBulkSelected],tags=[...contactBulkTags],project_id=state.seller_project.id;
 if(!ids.length||!tags.length)throw Error(translateUiText('Wybierz kontakty i co najmniej jeden tag.'));
 if(state.contacts.filter(contact=>ids.includes(contact.id)).some(contact=>contactTags([...contactTags(contact),...tags]).length>30))throw Error(translateUiText('Kontakt może mieć maksymalnie 30 tagów.'));
 contactBulkBusy=true;renderContactsView();
 try{
  const stored=ids.filter(id=>id>0),local=ids.filter(id=>id<0);
  if(stored.length)await api('contacts/tags/bulk',{ids:stored,tags});
  if(local.length)await api('contacts/tags/bulk',{ids:local,tags,project_id});
  contactBulkSelected.clear();await refresh();toast(translateUiText('Zaktualizowano kontakty:')+' '+ids.length);
 }finally{contactBulkBusy=false;if(view==='contacts')renderContactsView()}
}
function visibleContacts(q=contactSearch){q=q.toLowerCase();return state.contacts.filter(c=>(contactGroupFilter==='all'||(contactGroupFilter==='ungrouped'?!contactTags(c).length:contactTags(c).some(tag=>'group:'+tag===contactGroupFilter)))&&[c.name,c.email,c.company,c.role,contactTags(c).join(' ')].join(' ').toLowerCase().includes(q))}
function renderContacts(q){$('#contacts-body').innerHTML=visibleContacts(q).map(c=>`<tr>${contactBulkMode?`<td class="contact-bulk-check"><input type="checkbox" data-contact-bulk-id="${c.id}" aria-label="Zaznacz kontakt" ${contactBulkSelected.has(c.id)?'checked':''} ${contactBulkBusy?'disabled':''}></td>`:''}<td><strong>${esc(c.name)}</strong>${c.simulated?'<span class="badge warn">Symulacja</span>':''}<small>${esc(c.email)}</small></td><td>${esc(c.company)||'—'}<small>${esc(c.role)}</small></td><td><span data-no-translate>${contactTags(c).map(tag=>`<span class="badge gray">${esc(tag)}</span>`).join(' ')||esc(translateUiText('Bez tagów'))}</span><br><button class="link" data-action="contact-group" data-id="${c.id}">Edytuj tagi</button></td><td>${badge(c.status)}</td><td><button class="link" data-action="contact-status" data-id="${c.id}" data-status="paused">Wstrzymaj</button><button class="link" data-action="contact-status" data-id="${c.id}" data-status="unsubscribed">Rezygnacja</button></td></tr>`).join('')||'<tr><td colspan="'+(contactBulkMode?6:5)+'">'+translateUiText('Brak kontaktów. Dodaj osobę lub zaimportuj plik CSV.')+'</td></tr>';syncContactBulkControls()}

