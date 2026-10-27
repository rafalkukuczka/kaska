const appIconPaths={
 dashboard:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
 compass:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM16 8l-3 5-5 3 3-5Z',
 search:'M21 21l-5-5M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z',
 users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87',
 send:'m22 2-7 20-4-9-9-4ZM22 2 11 13',
 activity:'M2 12h4l3-9 6 18 3-9h4',
 inbox:'M4 4h16l2 12v4H2v-4ZM2 16h6l2 3h4l2-3h6',
 book:'M12 5v16M12 5C9 2 5 2 2 3v16c4-1 7-1 10 2 3-3 6-3 10-2V3c-3-1-7-1-10 2Z',
 plug:'M8 2v5M16 2v5M6 7h12v4a6 6 0 0 1-12 0ZM12 17v5',
 sliders:'M4 3v4M4 11v10M12 3v10M12 17v4M20 3v2M20 9v12M1 7h6M9 17h6M17 5h6',
 plus:'M12 5v14M5 12h14', trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
 play:'m8 4 12 8-12 8Z',pause:'M8 4v16M16 4v16',
 edit:'m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5',
 left:'M19 12H5M11 6l-6 6 6 6',right:'M5 12h14M13 6l6 6-6 6',
 import:'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
 refresh:'M20 7a9 9 0 1 0 1 9M20 2v5h-5',
 mail:'M3 5h18v14H3ZM3 5l9 7 9-7',
 save:'M3 3h15l3 3v15H3ZM7 3v6h10V3M7 21v-8h10v8',
 eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
 project:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM5 19a7 7 0 0 1 14 0'
};
function decorateAppIcons(){
 const nav={dashboard:'dashboard',discover:'compass',prospecting:'search',contacts:'users',campaigns:'send',signals:'activity',inbox:'inbox',library:'book',settings:'plug',administration:'sliders'};
 const actions={'new-contact':'plus','new-campaign':'plus',prepare:'send','delete-campaign':'trash',import:'import','upload-csv':'import',message:'edit',back:'left','connect-gmail':'mail',sync:'refresh'};
 const builder={'import-project':'project','add-step':'plus',prev:'left',next:'right','header-next':'right',exit:'left','save-draft':'save',preview:'eye'};
 document.querySelectorAll('nav [data-view],button[data-action],button[data-builder],#current-seller-project,[data-monitor-delete],[data-monitor-events],[data-message-delete],[data-monitor-sources]').forEach(element=>{
  const name=element.closest('nav')?nav[element.dataset.view]:element.id==='current-seller-project'?'project':element.hasAttribute('data-monitor-delete')||element.hasAttribute('data-message-delete')?'trash':element.hasAttribute('data-monitor-events')?'activity':element.hasAttribute('data-monitor-sources')?'sliders':element.dataset.action==='campaign-status'?(element.dataset.status==='active'?'play':'pause'):actions[element.dataset.action]||builder[element.dataset.builder];
  if(!name||element.querySelector('[data-app-icon]'))return;
  for(const node of element.childNodes)if(node.nodeType===Node.TEXT_NODE&&node.textContent.trim()){
   node.textContent=node.textContent.replace(/^\s*[◫✧♙↗⚡✉⚙⌕⌑↻←→+]\s*[\s\u00a0]*/u,'');break;
  }
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('data-app-icon',name);svg.setAttribute('class','app-icon');
  path.setAttribute('d',appIconPaths[name]);svg.append(path);element.prepend(svg);element.classList.add('has-app-icon');
 });
}
let appIconsPending=false;
const appIconObserver=new MutationObserver(()=>{if(appIconsPending)return;appIconsPending=true;queueMicrotask(()=>{appIconsPending=false;decorateAppIcons()})});
document.addEventListener('DOMContentLoaded',()=>{decorateAppIcons();appIconObserver.observe(document.body,{childList:true,subtree:true})});
