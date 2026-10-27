async function selectContactTags(root,value){
 const picker=root.locator('[data-contact-tag-control]').first();
 while(await picker.locator('[data-remove-contact-tag]').count())await picker.locator('[data-remove-contact-tag]').first().click();
 for(const tag of value.split(';').map(tag=>tag.trim()).filter(Boolean)){
  const options=await picker.locator('[data-contact-tag-option]').all();let existing;
  for(const option of options)if((await option.getAttribute('value')).toLocaleLowerCase()===tag.toLocaleLowerCase()){existing=option;break}
  if(existing){if(!await existing.isDisabled())await picker.locator('[data-contact-tag-select]').selectOption(await existing.getAttribute('value'))}
  else{await picker.locator('[data-new-contact-tag]').fill(tag);await picker.locator('[data-new-contact-tag]').press('Enter')}
 }
}
module.exports={selectContactTags};
