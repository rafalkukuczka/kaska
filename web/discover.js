function sourceLink(url,label=url,contactId){
 const context=contactId>0?` data-contact-source="${contactId}" data-project-id="${state.seller_project.id}" data-simulation-generation="${esc(state.simulation_generation||'')}"`:'';
 return (contactId>0?/^https?:\/\//i:/^https:\/\//i).test(url)?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="link"${context}>${esc(label)}</a>`:'';
}
function dashboardActionsPanel(){
 let counts=state.dashboard_actions||{};
 if(monitoringSimulation)counts={leads:(state.prospecting?.candidates||[]).filter(person=>!state.contacts.some(contact=>contact.email===person.email)).length,campaigns:state.campaigns.filter(c=>['draft','paused'].includes(c.status)&&state.messages.some(m=>m.campaign_id===c.id&&m.status==='queued')).length,replies:state.replies.length};
 return `<section class="panel dashboard-actions"><h2>Co wymaga Twojej uwagi?</h2><div class="workflow-actions">${[['leads','Leady do sprawdzenia','prospecting','Sprawdź osoby, adresy i tagi'],['campaigns','Kampanie do sprawdzenia','campaigns','Sprawdź treść i harmonogram przed wysyłką'],['replies','Odpowiedzi w projekcie','inbox','Przejdź do rozmów']].map(([key,label,target,description])=>`<button type="button" class="workflow-action" data-view="${target}"><strong>${counts[key]||0}</strong><span>${label}</span><small>${description}</small></button>`).join('')}</div></section>`;
}
