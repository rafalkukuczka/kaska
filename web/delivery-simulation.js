function deliverySimulationRuns(projectId=state.seller_project.id){return fetchedSimulation(projectId).deliveryRuns||={}}
function simulationReplyText(language){return ({pl:'Dziękuję za wiadomość. Oferta wygląda interesująco. Proszę o więcej informacji i propozycję terminu krótkiej rozmowy.',en:'Thank you for reaching out. This looks interesting. Please send more details and suggest a time for a short call.',de:'Vielen Dank für Ihre Nachricht. Das klingt interessant. Bitte senden Sie weitere Informationen und einen Terminvorschlag.',fr:'Merci pour votre message. Votre offre semble intéressante. Pourriez-vous envoyer plus de détails et proposer un rendez-vous ?',es:'Gracias por su mensaje. La oferta parece interesante. Envíe más información y proponga una hora para conversar.',it:'Grazie per il messaggio. La proposta sembra interessante. Potete inviare maggiori dettagli e proporre un appuntamento?'})[language]||simulationReplyText('en')}
function advanceDeliverySimulation(run,now=Date.now()){
 const elapsed=run.elapsed+(run.status==='active'?now-run.at:0);let changed=false;
 const contacts=[...new Set(run.messages.filter(m=>m.original_status==='queued'||m.original_status==='sending').map(m=>m.contact_id))];
 for(const [index,contactId] of contacts.entries()){
  const messages=run.messages.filter(m=>m.contact_id===contactId).sort((a,b)=>a.position-b.position);
  const first=messages.find(m=>m.original_status==='queued'||m.original_status==='sending');
  const replyAt=index*1500+6500,replyId=`sim-reply-${run.campaign_id}-${contactId}`;
  const replied=index%2===0&&elapsed>=replyAt;
  for(const message of messages){
   if(!['queued','sending'].includes(message.original_status))continue;
   const start=index*1500+(message.position-first.position)*10000;
   let status=replied&&message.position>first.position?'cancelled':elapsed>=start+3500?'sent':elapsed>=start?'sending':'queued';
   if(run.status!=='active'&&status==='sending')status='queued';
   message.delivery_replied=replied&&message.position===first.position;
   if(status!==message.status){message.status=status;message.sent_at=status==='sent'?(run.created+start+3500)/1000:null;changed=true}
  }
  if(replied&&!run.replies.some(reply=>reply.id===replyId)){
   run.replies.push({id:replyId,contact_id:contactId,email:first.email,subject:'Re: '+first.subject,body:simulationReplyText(run.language),received:now/1000,simulated:true,delivery_simulated:true});changed=true;
  }
 }
 return changed;
}
function applyDeliverySimulation(snapshot){
 const runs=deliverySimulationRuns(snapshot.seller_project.id);
 for(const run of Object.values(runs))advanceDeliverySimulation(run);
 snapshot.campaigns=snapshot.campaigns.map(c=>({...c,status:runs[c.id]?.status||(c.status==='active'?'paused':c.status),delivery_simulated:!!runs[c.id]}));
 const messages=new Map(Object.values(runs).flatMap(run=>run.messages).map(message=>[message.id,message]));
 snapshot.messages=snapshot.messages.map(message=>messages.has(message.id)?{...message,...messages.get(message.id),delivery_simulated:true}:message);
 snapshot.replies=[...Object.values(runs).flatMap(run=>run.replies),...snapshot.replies.filter(reply=>!reply.delivery_simulated)].sort((a,b)=>b.received-a.received);
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
 if(!$('#modal').open){if(view==='campaigns'&&selectedCampaign)renderCampaignMessages(selectedCampaign);else if(['inbox','dashboard','campaigns'].includes(view))render()}
},1000);
