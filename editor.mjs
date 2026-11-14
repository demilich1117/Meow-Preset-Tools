import {element, button, dialog, isolate} from './dom.mjs';
import {diagnosePreset, variableKey, variableLabel} from './analysis.mjs';
import {variableReferences} from './variables.mjs';
import {openMove} from './actions-ui.mjs';
import {insertRow} from './operations.mjs';

export function enhanceEditor(win,host,getManager,drafts,notice,getEditor=()=>null) {
  const doc=win.document, life=new AbortController();
  let field,tools,panel,timer,expanded,placement,creation,disposed=false,refreshEditor=()=>{};
  function readField(){getEditor(field)?.flush({selection:true});return field.value;}
  function focusField(){const native=getEditor(field);if(native)native.focus();else field.focus();}
  function selectRange(start,end){
    if(getEditor(field))enlarge({selection:[start,end]});
    else{field.focus();field.setSelectionRange(start,end);}
  }
  const prefs=()=>host.context().extensionSettings.meow_preset_tools??{};
  const currentId=()=>doc.querySelector('#completion_prompt_manager_popup_entry_form_save')?.dataset.pmPrompt;
  function quietKey(e) {
    if(prefs().quietMacros===false)return;
    if((!e.ctrlKey&&!e.metaKey&&!e.altKey&&['Enter','Tab','ArrowUp','ArrowDown'].includes(e.key))||(e.ctrlKey&&e.code==='Space'))e.stopImmediatePropagation();
  }
  function syncQuiet() {
    if(disposed)return;
    const quiet=prefs().quietMacros!==false;
    let native;try{native=getEditor(field);}catch{/* The assistance panel reports unavailable adapters. */}
    doc.body.classList.toggle('mpt-quiet-macros',quiet&&(doc.activeElement===field||native?.wrapper.contains(doc.activeElement)||expanded?.body.contains(doc.activeElement)));
    const toggle=tools?.querySelector('.mpt-macro-toggle');
    if(toggle){toggle.textContent='宏自动提示：'+(quiet?'关':'开');toggle.setAttribute('aria-pressed',String(!quiet));}
  }
  function captureCreation(){
    const id=currentId();if(!id||getManager()?.getPromptById(id)){creation=null;return;}
    if(creation?.id===id)return;
    try{creation={id,expected:drafts.snapshot()};}catch{creation=null;}
  }
  function saveNew(event){
    const id=currentId();if(!id||getManager()?.getPromptById(id))return;
    event.preventDefault();event.stopImmediatePropagation();if(placement)return;
    captureCreation();
    const prompt={identifier:id,system_prompt:false,marker:false};getManager().updatePromptWithPromptEditForm(prompt);
    const nameField=doc.querySelector('#completion_prompt_manager_popup_entry_form_name');
    if(!prompt.name.trim()){nameField?.setCustomValidity('请填写新条目的名称');nameField?.reportValidity();nameField?.focus();return;}
    nameField?.setCustomValidity('');
    if(!creation){notice('预设已变化，请重新打开新条目');return;}
    const expected=creation.expected;
    placement=openMove(win,drafts,[],notice,()=>{placement=null;},{newPrompt:prompt,onChoose:position=>{
      if(currentId()!==id)throw Error('编辑条目已变化，请返回检查');
      const latest={identifier:id,system_prompt:false,marker:false};getManager().updatePromptWithPromptEditForm(latest);
      if(JSON.stringify(latest)!==JSON.stringify(prompt))throw Error('正文或设置已变化，请返回后重新选择位置');
      const manager=getManager();manager.hidePopup();
      try{
        drafts.apply(p=>insertRow(p,prompt,{orderId:expected.orderId,...position}),'新增条目',expected);
        manager.clearEditForm();creation=null;notice('已创建并插入「'+prompt.name+'」'+(position.enabled?'（启用）':'（停用）')+'，可撤销');
      }catch(e){manager.showPopup();throw e;}
    }});
  }
  function enlarge({selection,insert}={}) {
    if(expanded||field.disabled)return;
    let original;try{original=readField();}catch(e){notice(e.message);return;}
    const id=currentId(),snapshot=host.snapshot();
    expanded=dialog(win,'展开正文',()=>{expanded=null;syncQuiet();});expanded.root.classList.add('mpt-expanded-editor');
    const textarea=element(doc,'textarea','mpt-expanded-text');textarea.value=original;textarea.setAttribute('aria-label','展开后的条目正文');
    textarea.addEventListener('keydown',quietKey,{capture:true});
    expanded.body.append(textarea);
    const d=expanded;
    d.actions.append(button(doc,'应用回编辑框',()=>{
      try {
        const now=host.snapshot();
        if(now.name!==snapshot.name||now.epoch!==snapshot.epoch||currentId()!==id||readField()!==original||field.disabled)throw Error('原编辑内容已变化，请先复制当前正文，再重新打开');
        if(textarea.value!==original){field.value=textarea.value;getEditor(field)?.reset();field.dispatchEvent(new win.Event('input',{bubbles:true}));}
        d.close();focusField();
      }catch(e){d.status.textContent=e.message;}
    },'mpt-primary'));textarea.focus();
    if(selection)textarea.setSelectionRange(...selection);
    if(insert!==undefined)textarea.setRangeText(insert,field.selectionStart,field.selectionEnd,'end');
  }
  function mount() {
    if(disposed)return;
    const candidate=doc.querySelector('#completion_prompt_manager_popup_entry_form_prompt');
    if(!candidate||(candidate===field&&tools?.isConnected))return;
    tools?.remove();panel?.remove();field=candidate;
    field.addEventListener('keydown',quietKey,{capture:true,signal:life.signal});
    doc.querySelector('#completion_prompt_manager_popup_entry_form_name')?.addEventListener('input',e=>e.target.setCustomValidity(''),{signal:life.signal});
    tools=element(doc,'div','mpt-editor-tools');isolate(tools);
    const toggle=button(doc,'',()=>{
      const ctx=host.context();ctx.extensionSettings.meow_preset_tools={...prefs(),quietMacros:prefs().quietMacros===false};
      ctx.saveSettingsDebounced();syncQuiet();focusField();
    },'mpt-macro-toggle');
    const count=element(doc,'small','mpt-word-count');
    tools.append(toggle,button(doc,'展开正文',enlarge),count);
    panel=element(doc,'details','mpt-editor-assist');isolate(panel);
    panel.append(element(doc,'summary','','查找与变量工具'));
    const find=element(doc,'input','mpt-input');find.type='search';find.placeholder='在正文中查找';find.setAttribute('aria-label','查找条目正文');
    const feedback=element(doc,'p','mpt-help');feedback.setAttribute('role','status');
    function next() {
      const query=find.value;if(!query)return;
      try{readField();}catch(e){feedback.textContent=e.message;return;}
      let index=field.value.indexOf(query,field.selectionEnd);
      if(index<0)index=field.value.indexOf(query);
      if(index<0){feedback.textContent='没有找到这段文字';return;}
      selectRange(index,index+query.length);feedback.textContent='已定位到第 '+(field.value.slice(0,index).split('\n').length)+' 行';
    }
    find.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();next();}});
    const findRow=element(doc,'div','mpt-inline');findRow.append(find,button(doc,'下一个',next));
    const variable=element(doc,'select','mpt-input');variable.setAttribute('aria-label','已有变量');
    const insert=button(doc,'插入 get',()=>{
      const selected=variable.selectedOptions[0],name=selected?.dataset.name,scope=selected?.dataset.scope;
      if(!name||field.disabled)return;
      const macro='{{get'+(scope==='global'?'global':'')+'var::'+name+'}}';
      try{if(getEditor(field)){enlarge({insert:macro});return;}}catch(e){feedback.textContent=e.message;return;}
      field.focus();
      if(!doc.execCommand('insertText',false,macro)){field.setRangeText(macro,field.selectionStart,field.selectionEnd,'end');field.dispatchEvent(new win.Event('input',{bubbles:true}));}
    });
    const variableRow=element(doc,'div','mpt-inline');variableRow.append(variable,insert);
    const results=element(doc,'div','mpt-variable-results');
    const note=element(doc,'p','mpt-help','按当前正文做静态检查；不会执行宏。聊天、脚本和世界书中的变量需结合实际使用核对。');
    const nativeNote=element(doc,'p','mpt-help');
    panel.append(nativeNote,findRow,feedback,variableRow,results,note);field.before(tools,panel);
    function update() {
      try{readField();}catch(e){results.textContent=e.message;return;}
      count.textContent=field.value.length.toLocaleString()+' 字符';
      if(!panel.open)return;
      nativeNote.textContent=getEditor(field)?'TT 代码编辑器已启用：此处定位与插入会在展开正文中预览，应用后同步回原编辑器；也可使用 TT 自带的查找替换。':'';
      try {
        const s=host.snapshot(),p=s.active,id=currentId(),prompt=p.prompts.find(p=>p.identifier===id);
        if(!prompt){results.textContent='保存时选择插入位置，即可创建并加入列表。';return;}
        prompt.content=field.value;
        const report=diagnosePreset(p,getManager()?.activeCharacter?.id),selected=variable.value;
        variable.replaceChildren(new win.Option('选择已有变量…',''));
        for(const ref of [...new Map(report.refs.map(r=>[variableKey(r),r])).values()]){
          const option=new win.Option(variableLabel(ref),variableKey(ref));option.dataset.name=ref.name;option.dataset.scope=ref.scope;variable.append(option);
        }
        if([...variable.options].some(o=>o.value===selected))variable.value=selected;
        insert.disabled=field.disabled||!variable.value;results.replaceChildren();
        const relevant=i=>i.ref.identifier===id||i.definitions.some(r=>r.identifier===id);
        const issues=report.issues.filter(relevant),notes=report.notes.filter(relevant);
        if(!issues.length)results.append(element(doc,'p','mpt-help',notes.length?'已识别 '+notes.length+' 条初始化链，未发现待核对项。':'未发现固定变量名的缺失或覆盖提示。'));
        for(const issue of issues){
          const row=element(doc,'div','mpt-variable-warning');
          row.append(element(doc,'strong','',variableLabel(issue.ref)),element(doc,'span','',issue.message),
            element(doc,'small','',[...new Set([issue.ref,...issue.definitions].map(r=>r.sourceName+(r.enabled?'':'（停用）')))].join('、')));results.append(row);
        }
        const refs=variableReferences(field.value);
        if(refs.length){
          const links=element(doc,'div','mpt-variable-links');
          for(const ref of refs){links.append(button(doc,(ref.kind==='get'?'读取':ref.kind==='set'?'写入':'更新')+' · '+ref.name,()=>{
            selectRange(ref.start,ref.end);
          }));}results.append(links);
        }
      }catch(e){results.textContent=e.message;}
    }
    refreshEditor=update;
    variable.addEventListener('change',()=>{insert.disabled=field.disabled||!variable.value;});
    panel.addEventListener('toggle',update);
    field.addEventListener('focus',update,{signal:life.signal});
    field.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(update,180);},{signal:life.signal});
    // The native editor reuses this form for every prompt without replacing it.
    const nativeSave=doc.querySelector('#completion_prompt_manager_popup_entry_form_save');
    if(nativeSave){nativeSave.addEventListener('click',saveNew,{capture:true,signal:life.signal});observer.observe(nativeSave,{attributes:true,attributeFilter:['data-pm-prompt']});}
    syncQuiet();update();
  }
  const observer=new win.MutationObserver(records=>{
    if(records.some(r=>r.type==='attributes')){panel && (panel.open=false);captureCreation();}
    if(!field?.isConnected||!tools?.isConnected)mount();
  });
  observer.observe(doc.body,{childList:true,subtree:true});
  doc.addEventListener('focusin',syncQuiet,{signal:life.signal});
  doc.addEventListener('input',e=>{
    let native;try{native=getEditor(field);}catch{return;}
    if(native?.wrapper.contains(e.target)){clearTimeout(timer);timer=setTimeout(refreshEditor,180);}
  },{signal:life.signal});
  doc.addEventListener('focusout',()=>queueMicrotask(syncQuiet),{signal:life.signal});
  mount();
  return {dispose(){disposed=true;observer.disconnect();life.abort();clearTimeout(timer);expanded?.close();placement?.close();tools?.remove();panel?.remove();doc.body.classList.remove('mpt-quiet-macros');}};
}
