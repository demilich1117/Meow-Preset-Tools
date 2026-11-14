import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Isolated projection, not a native TT runtime. The ST server supplies the
// remaining UI/context/transport. Upstream files and build stay in output/.
const modules=new Set([
  '/scripts/PromptManager.js','/scripts/prompt-manager-order-utils.js',
  '/scripts/util/latest-task-scheduler.js','/scripts/prompt-injections.js',
  '/scripts/tauri/codemirror-editor.js','/tauri/main/back-navigation.js',
  '/tauri/main/services/back-navigation/back-handler-stack.js',
]);
export async function projectTt(route,pathname,root){
  if(modules.has(pathname)){
    let body=await readFile(resolve(root,'output/tt-source/src'+pathname),'utf8');
    if(pathname.endsWith('codemirror-editor.js'))body+='\ninitializeCodeMirrorEditor({codemirror_editor_enabled:false});';
    await route.fulfill({body,contentType:'text/javascript'});return true;
  }
  if(pathname==='/mpt-test/editor.bundle.js'){
    await route.fulfill({body:await readFile(resolve(root,'output/tt-runtime/editor.bundle.js')),contentType:'text/javascript'});return true;
  }
  if(pathname==='/lib.js'||pathname==='/scripts/dom-handlers.js'){
    const response=await route.fetch();let body=await response.text();
    if(pathname==='/lib.js')body+='\nexport function getCodeMirrorEditor(){return import("/mpt-test/editor.bundle.js");}';
    else if(!body.includes('export function getEditorName('))body+='\nexport function getEditorName(source){return source.getAttribute("aria-label")||"Prompt";}';
    await route.fulfill({response,body});return true;
  }
  if(pathname==='/'){
    const response=await route.fetch();let body=await response.text();
    // TT's added form controls; keep them hidden for ordinary list checks.
    const fields='<div id="completion_prompt_manager_attach_block" hidden><select id="completion_prompt_manager_popup_entry_form_attach_role"><option>user</option><option>system</option><option>assistant</option></select><input id="completion_prompt_manager_popup_entry_form_attach_index" value="1"><select id="completion_prompt_manager_popup_entry_form_attach_side"><option>end</option><option>start</option></select></div>';
    body=body.replace('</body>',fields+'</body>');await route.fulfill({response,body});return true;
  }
  return false;
}

export async function checkTtEditor(page,bar,list,output){
  await page.evaluate(async()=>{
    const back=await import('/tauri/main/back-navigation.js');back.installBackNavigationBridge();
    const cm=await import('/scripts/tauri/codemirror-editor.js');cm.initializeCodeMirrorEditor({codemirror_editor_enabled:true});
  });
  // Native Android back closes HTML dialogs without dispatching cancel.
  await bar.getByRole('button',{name:'分组',exact:true}).click();
  await page.evaluate(()=>window.__TAURITAVERN_HANDLE_BACK__());
  await page.getByRole('dialog',{name:'预设分组',exact:true}).waitFor({state:'detached'});
  await bar.getByRole('button',{name:'分组',exact:true}).click();
  await page.getByRole('dialog',{name:'预设分组',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
  await bar.getByLabel('搜索原生预设条目').fill('时间');
  await list.locator('[data-pm-identifier=clock] .prompt-manager-edit-action').click();
  const cm=page.locator('#completion_prompt_manager_popup_edit .cm-content');
  await cm.fill('{{setvar::TT新变量::最新正文}}\n代码编辑器中未保存的段落');
  await page.locator('.mpt-editor-assist summary').click();
  await page.getByLabel('已有变量',{exact:true}).selectOption(JSON.stringify(['local','TT新变量']));
  await page.getByRole('button',{name:'插入 get',exact:true}).click();
  const expanded=page.getByRole('dialog',{name:'展开正文',exact:true}),text=page.getByLabel('展开后的条目正文');
  if(!(await text.inputValue()).includes('{{getvar::TT新变量}}'))throw Error('TT insertion lost current editor value/selection');
  await expanded.getByRole('button',{name:'应用回编辑框',exact:true}).click();
  if(!(await cm.textContent()).includes('{{getvar::TT新变量}}'))throw Error('Expanded changes did not return to TT editor');
  await page.getByLabel('查找条目正文').fill('段落');await page.getByRole('button',{name:'下一个',exact:true}).click();
  if(await text.evaluate(n=>n.value.slice(n.selectionStart,n.selectionEnd))!=='段落')throw Error('TT find failed');
  await page.evaluate(()=>window.__TAURITAVERN_HANDLE_BACK__());await expanded.waitFor({state:'detached'});
  await page.getByRole('button',{name:'展开正文',exact:true}).click();
  await text.fill('{{setvar::TT新变量::展开修改}}\n应用后继续原生输入');
  await expanded.getByRole('button',{name:'应用回编辑框',exact:true}).click();
  await cm.press('Control+End');await cm.press('End');await cm.pressSequentially(' TT');
  await page.locator('#completion_prompt_manager_popup_edit').screenshot({path:resolve(output,'tt-codemirror.png')});
  await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
  const value=await page.evaluate(()=>SillyTavern.getContext().chatCompletionSettings.prompts.find(p=>p.identifier==='clock').content);
  if(value!=='{{setvar::TT新变量::展开修改}}\n应用后继续原生输入 TT')throw Error('TT native save did not flush latest content: '+value);
  await bar.getByLabel('搜索原生预设条目').fill('');
}
