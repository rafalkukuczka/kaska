// Compatibility for saved browser drafts and links from before projects were introduced.
(()=>{
 const rename=value=>value.replaceAll('profiles','projects').replaceAll('Profiles','Projects').replaceAll('profile','project').replaceAll('Profile','Project');
 function convert(value){
  if(Array.isArray(value))return value.map(convert);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[rename(key),key==='name'&&typeof item==='string'&&/^(Profil|Profile) \d+$/.test(item)?'Projekt '+item.split(' ').at(-1):convert(item)]));
  return value;
 }
 for(const storageName of ['localStorage','sessionStorage'])try{
  const storage=window[storageName];
  for(const key of Object.keys(storage)){
   if(!key.startsWith('kaska-')&&!key.startsWith('campaign-builder-'))continue;
   const target=rename(key),original=storage.getItem(key);let value=original;
   try{value=JSON.stringify(convert(JSON.parse(original)))}catch{}
   if(target===key){if(value!==original)storage.setItem(key,value)}
   else if(storage.getItem(target)===null){storage.setItem(target,value);storage.removeItem(key)}
  }
 }catch{}
 if(location.hash==='#profile')history.replaceState(null,'','#project');
})();
