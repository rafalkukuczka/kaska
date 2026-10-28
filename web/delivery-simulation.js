function deliverySimulationRuns(projectId=state.seller_project.id){return fetchedSimulation(projectId).deliveryRuns||={}}
function simulationReplyText(language){return ({pl:'Dziękuję za wiadomość. Oferta wygląda interesująco. Proszę o więcej informacji i propozycję terminu krótkiej rozmowy.',en:'Thank you for reaching out. This looks interesting. Please send more details and suggest a time for a short call.',de:'Vielen Dank für Ihre Nachricht. Das klingt interessant. Bitte senden Sie weitere Informationen und einen Terminvorschlag.',fr:'Merci pour votre message. Votre offre semble intéressante. Pourriez-vous envoyer plus de détails et proposer un rendez-vous ?',es:'Gracias por su mensaje. La oferta parece interesante. Envíe más información y proponga una hora para conversar.',it:'Grazie per il messaggio. La proposta sembra interessante. Potete inviare maggiori dettagli e proporre un appuntamento?'})[language]||simulationReplyText('en')}
function simulationConditionsMatch(rules,contact,position){
 try{return (typeof rules==='string'?JSON.parse(rules):rules||[]).every(rule=>{
  if(rule.before_step!==undefined&&rule.before_step!==position)return true;
  const value=String(contact?.[rule.field]||'').trim().toLocaleLowerCase(),target=String(rule.value||'').toLocaleLowerCase();
  return ({is_set:!!value,is_not_set:!value,contains:value.includes(target),equals:value===target,not_contains:!value.includes(target)})[rule.operator]===true;
 })}catch{return false}
}
function advanceDeliverySimulation(run,now=Date.now()){
 const elapsed=run.elapsed+(run.status==='active'?now-run.at:0);let changed=false;
 const contacts=[...new Set(run.messages.filter(m=>m.original_status==='queued'||m.original_status==='sending').map(m=>m.contact_id))];
 for(const [index,contactId] of contacts.entries()){
  const messages=run.messages.filter(m=>m.contact_id===contactId).sort((a,b)=>a.position-b.position);
  const first=messages.find(m=>m.original_status==='queued'||m.original_status==='sending');
  const replyAt=index*1500+6500,replyId=`sim-reply-${run.campaign_id}-${contactId}`;
  const replied=index%2===0&&elapsed>=replyAt;
  let skipped=false;
  for(const message of messages){
   if(!['queued','sending'].includes(message.original_status))continue;
   const start=index*1500+(message.position-first.position)*10000;
   const contact=state?.contacts?.find(contact=>contact.id===contactId)||run.contacts?.[contactId]||{email:message.email};
   if(message.delivery_skipped||skipped||(message.status!=='sent'&&elapsed>=start&&!simulationConditionsMatch(run.conditions,contact,message.position))){
    skipped=true;message.delivery_skipped=true;if(message.status!=='cancelled'){message.status='cancelled';message.error='Pominięto odbiorcę: niespełniony warunek sekwencji.';changed=true}continue;
   }
   let status=replied&&message.position>first.position?'cancelled':elapsed>=start+3500?'sent':elapsed>=start?'sending':'queued';
   if(run.status!=='active'&&status==='sending')status='queued';
   message.delivery_replied=replied&&message.position===first.position;
   if(status!==message.status){message.status=status;message.sent_at=status==='sent'?(run.created+start+3500)/1000:null;changed=true}
  }
  if(replied&&first.status==='sent'&&!run.replies.some(reply=>reply.id===replyId)){
   run.replies.push({id:replyId,contact_id:contactId,email:first.email,subject:'Re: '+first.subject,body:simulationReplyText(run.language),received:now/1000,simulated:true,delivery_simulated:true});changed=true;
  }
 }
 return changed;
}
function demoInboxReplies(snapshot){
 const project=snapshot.seller_project,results=fetchedSimulation(project.id);
 if(!results.inboxDemoCreated){results.inboxDemoCreated=Date.now();saveSimulationResults()}
 const polish=(snapshot.preferences?.message_language||'pl')==='pl';
 const examples=polish?[
  ['Anna Kowalska','Re: Propozycja współpracy','Dzień dobry, dziękuję za wiadomość. Propozycja wygląda interesująco. Czy możemy umówić krótką rozmowę w przyszłym tygodniu?'],
  ['Piotr Nowak','Re: Szczegóły oferty','Dziękuję za kontakt. Proszę o orientacyjny koszt oraz przykłady podobnych realizacji. Przekażę je osobie odpowiedzialnej za ten obszar.'],
  ['Marta Wiśniewska','Re: Termin rozmowy','Obecnie kończymy inny projekt. Proszę wrócić do nas za miesiąc — wtedy będziemy mogli omówić szczegóły.']
 ]:[
  ['Anna Kowalska','Re: Working together','Thank you for reaching out. Your proposal looks interesting. Could we arrange a short call next week?'],
  ['Piotr Nowak','Re: Offer details','Thank you for your message. Please send an estimated cost and examples of similar work. I will forward them to the person responsible.'],
  ['Marta Wiśniewska','Re: Meeting availability','We are currently finishing another project. Please contact us again next month so we can discuss the details.']
 ];
 return examples.map(([contact_name,subject,body],index)=>({id:`demo-inbox-${project.id}-${index}`,contact_id:null,contact_name,email:['anna','piotr','marta'][index]+'@firma-demo.example',subject,body,received:results.inboxDemoCreated/1000-index*900,simulated:true,delivery_simulated:true,demo_inbox:true}));
}
function applyDeliverySimulation(snapshot){
 const runs=deliverySimulationRuns(snapshot.seller_project.id);
 for(const run of Object.values(runs))advanceDeliverySimulation(run);
 snapshot.campaigns=snapshot.campaigns.map(c=>({...c,status:runs[c.id]?.status||(c.status==='active'?'paused':c.status),delivery_simulated:!!runs[c.id]}));
 const messages=new Map(Object.values(runs).flatMap(run=>run.messages).map(message=>[message.id,message]));
 snapshot.messages=snapshot.messages.map(message=>messages.has(message.id)?{...message,...messages.get(message.id),delivery_simulated:true}:message);
 const replies=Object.values(runs).flatMap(run=>run.replies);
 snapshot.replies=(replies.length?replies:demoInboxReplies(snapshot)).sort((a,b)=>b.received-a.received);
 return snapshot;
}
function simulationCampaignMessagePage(id,data){
 if(!monitoringSimulation)return data;
 const run=deliverySimulationRuns()[id];if(!run)return data;
 advanceDeliverySimulation(run);
 const messages=new Map(run.messages.map(message=>[message.id,message]));
 return {...data,messages:data.messages.map(message=>messages.has(message.id)?{...message,...messages.get(message.id),delivery_simulated:true}:message)};
}
async function simulateCampaignStatus(item){
 const projectId=state.seller_project.id,epoch=simulationEpoch,runs=deliverySimulationRuns(projectId);
 if(!['active','paused'].includes(item.status))throw Error('Nieprawidłowy status');
 let run=runs[item.id];
 if(!run){
  let messages=[];
  for(let page=1;;page++){
   const response=await fetch('/api/campaign/messages?'+new URLSearchParams({campaign_id:item.id,page,page_size:100})),data=await response.json();
   if(!response.ok)throw Error(data.error);
   messages.push(...data.messages);
   if(messages.length>=data.total)break;
  }
  if(epoch!==simulationEpoch||projectId!==state.seller_project.id)throw Error('Zmieniono projekt lub tryb aplikacji.');
  if(!messages.length)throw Error(translateUiText('Najpierw przygotuj i sprawdź wiadomości'));
  run=runs[item.id]={campaign_id:item.id,status:'paused',elapsed:0,at:Date.now(),created:Date.now(),language:state.campaigns.find(c=>c.id===item.id)?.language||'pl',messages:messages.sort((a,b)=>a.contact_id-b.contact_id||a.position-b.position).map(message=>({...message,original_status:message.status})),replies:[]};
  run.conditions=state.campaigns.find(c=>c.id===item.id)?.conditions||[];
  run.contacts=Object.fromEntries(state.contacts.map(contact=>[contact.id,{email:contact.email,company:contact.company,role:contact.role}]));
 }
 if(run.status==='active'){advanceDeliverySimulation(run);run.elapsed+=Date.now()-run.at}
 run.status=item.status;run.at=Date.now();advanceDeliverySimulation(run);saveSimulationResults();
 return {simulated:true};
}
function pauseDeliverySimulations(){
 for(const project of Object.values(simulationResults))for(const run of Object.values(project.deliveryRuns||{}))if(run.status==='active'){
  advanceDeliverySimulation(run);run.elapsed+=Date.now()-run.at;run.status='paused';run.at=Date.now();
 }
 saveSimulationResults();
}
let deliverySimulationSignature='';
setInterval(()=>{
 if(!monitoringSimulation||!state)return;
 const runs=deliverySimulationRuns();for(const run of Object.values(runs))advanceDeliverySimulation(run);
 const signature=state.seller_project.id+JSON.stringify(Object.values(runs).map(run=>[run.status,run.messages.map(m=>m.status),run.replies.length]));
 if(signature===deliverySimulationSignature)return;deliverySimulationSignature=signature;
 applyDeliverySimulation(state);saveSimulationResults();
 for(const run of Object.values(runs)){
  const page=campaignMessagePages.get(run.campaign_id);if(page){const data=simulationCampaignMessagePage(run.campaign_id,{messages:page.messages});page.messages=data.messages}
 }
 if(!$('#modal').open){if(view==='campaigns'&&selectedCampaign){renderCampaignMessages(selectedCampaign);renderCampaignWorkspaceLive(selectedCampaign)}else if(['inbox','dashboard','campaigns'].includes(view))render()}
},1000);
