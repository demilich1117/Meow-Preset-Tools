import {element,button,dialog,isolate} from './dom.mjs';
import {displayGroups,groupRuns,groupPreferenceKey} from './prompt-groups.mjs';
import {orderFor} from './entries.mjs';
import {duplicateRows,detachRows,moveRows} from './operations.mjs';
import {openMove,openGroups} from './actions-ui.mjs';

export function enhanceList(win,host,drafts,getManager) {
  const doc=win.document,life=new AbortController(),selected=new Set(),originalSort=new Map();
  let disposed=false,frame=0,list,bar,scope='',snapshot,groups=[],query='',picking=false,anchor,modal,sorting=false,dragEnded=0;
  let message='',busy=false,search,count,status,undo,save,batch,pick,dragBefore,moving,placement;
  let modelDirty=true,viewState={},nativeRows=[],prompts=new Map(),groupById=new Map(),searchIndex=new Map(),foldStates={};
  let placementTitle,placementSide,placementPreview,placementConfirm,empty,clearSearch;
  const headings=new Map();
  let marker,pendingFocus;
  const make=(tag,cls,text)=>element(doc,tag,cls,text);
  const prefs=()=>host.context().extensionSettings.meow_preset_tools??{};
  function setPrefs(patch){const ctx=host.context();ctx.extensionSettings.meow_preset_tools={...prefs(),...patch};ctx.saveSettingsDebounced();}
  function folded(group){const value=foldStates[group.id];return typeof value==='boolean'?value:group.collapsed;}
  function fold(value,subset=groups){
    const folds={...prefs().folds},states={...folds[scope]};for(const g of subset)states[g.id]=typeof value==='boolean'?value:!folded(g);
    folds[scope]=states;foldStates=states;setPrefs({folds});schedule();
  }
  const rows=()=>nativeRows;
  const visibleRows=()=>rows().filter(row=>!row.classList.contains('mpt-hidden'));
  function notice(text){message=text;schedule(true);}
  function attempt(fn){try{fn();}catch(e){notice(e.message);}}
  function show(factory){if(modal)return;attempt(()=>{modal=factory(()=>{modal=null;});});}
  function move(ids){show(onClose=>openMove(win,drafts,ids,notice,onClose));}
  function manageGroups(ids=[]){show(onClose=>openGroups(win,drafts,notice,onClose,ids));}
  function startPlacement(ids){attempt(()=>{
    if(!ids.length)throw Error('请先选择条目');
    moving={ids:[...ids],expected:drafts.snapshot(),side:'before',choice:null};
    query='';search.value='';message='';schedule();
  });}
  function choosePosition(choice){moving.choice=choice;schedule();}
  function finishPlacement(){attempt(()=>{
    const value=moving;if(!value?.choice)return;
    const changed=drafts.apply(p=>moveRows(p,value.ids,{orderId:value.expected.orderId,...value.choice,side:value.side}),'移动条目',value.expected);
    moving=null;notice(changed?'已移动 '+value.ids.length+' 条，可撤销':'条目已在这个位置');
  });}
  function copy(ids){attempt(()=>{let copies;drafts.apply((p,orderId)=>{const result=duplicateRows(p,ids,orderId);copies=result.identifiers;return result.preset;},'复制条目');selected.clear();copies?.forEach(id=>selected.add(id));notice('已创建 '+ids.length+' 个副本（停用），可撤销');});}
  function detach(ids){attempt(()=>{drafts.apply((p,orderId)=>detachRows(p,ids,orderId),'移出列表');selected.clear();notice('已从当前列表移出 '+ids.length+' 条；正文保留，可撤销');});}
  function edit(id){
    const row=rows().find(r=>r.dataset.pmIdentifier===id);
    row?.querySelector('.prompt-manager-edit-action')?.click();
  }
  function rowMenu(id){show(onClose=>{
    const prompt=drafts.snapshot().active.prompts.find(p=>p.identifier===id);
    if(!prompt)throw Error('条目已变化');
    const d=dialog(win,prompt.name||'条目操作',onClose);d.root.classList.add('mpt-row-menu');
    const actions=make('div','mpt-action-list');
    function action(label,fn){return button(doc,label,()=>{d.close();fn();});}
    const editButton=action('编辑正文',()=>edit(id));editButton.disabled=!getManager().isPromptEditAllowed(prompt);
    const clone=action('复制副本 · 默认停用',()=>copy([id]));clone.disabled=!!prompt.marker;
    const remove=action('移出当前列表',()=>detach([id]));remove.disabled=prompt.system_prompt!==false||!!prompt.marker;
    actions.append(editButton,action('在列表中选位置',()=>startPlacement([id])),action('搜索移动到…',()=>move([id])),action('分组…',()=>manageGroups([id])),clone,remove);
    d.body.append(actions,make('p','mpt-help','移出后正文仍在原生条目库中，可撤销或重新添加。'));return d;
  });}
  function step(id,direction){attempt(()=>{
    const s=drafts.snapshot(),order=orderFor(s.active,s.orderId).order,index=order.findIndex(r=>r.identifier===id),target=order[index+direction];
    if(!target)return;
    pendingFocus={id,node:rows().find(row=>row.dataset.pmIdentifier===id)};
    drafts.apply(p=>moveRows(p,[id],{orderId:s.orderId,targetId:target.identifier,side:direction<0?'before':'after'}),'移动条目',s);
    notice('已'+(direction<0?'上移':'下移')+'一位，可撤销');
  });}
  function createBar(){
    bar=make('section','mpt-native-bar');bar.setAttribute('aria-label','预设整理');isolate(bar);
    const header=make('div','mpt-bar-head');count=make('small','mpt-list-count');
    header.append(make('strong','','条目整理'),count);
    const controls=make('div','mpt-bar-actions');
    pick=button(doc,'多选',()=>{picking=!picking;if(!picking)selected.clear();schedule();});
    const group=button(doc,'分组',()=>manageGroups([...selected]));
    const add=button(doc,'新增',()=>attempt(()=>{
      if(doc.querySelector('#completion_prompt_manager_popup')?.classList.contains('openDrawer'))throw Error('请先保存或关闭正在编辑的条目');
      const manager=getManager();manager.clearEditForm();manager.clearInspectForm();manager.handleNewPrompt();
      doc.querySelector('#completion_prompt_manager_popup_entry_form_name')?.focus();
    }));
    undo=button(doc,'撤销',()=>attempt(()=>notice('已撤销'+drafts.undo())));
    save=button(doc,'保存到预设',async()=>{
      if(busy)return;busy=true;sync();
      try{const result=await drafts.save();notice(result.warning??'已保存到预设');}catch(e){notice(e.message);}finally{busy=false;sync();schedule();}
    },'mpt-primary');controls.append(add,pick,group,undo,save);
    const searchRow=make('div','mpt-search-row');search=make('input','mpt-input');search.type='search';search.placeholder='搜索条目、正文或分组';search.setAttribute('aria-label','搜索原生预设条目');
    search.value=query;search.addEventListener('input',()=>{query=search.value;schedule();});
    clearSearch=button(doc,'清除',()=>{query='';search.value='';schedule();search.focus();},'mpt-clear-search');clearSearch.setAttribute('aria-label','清除条目搜索');
    const view=make('details','mpt-fold-menu');view.append(make('summary','','折叠'));
    const folds=make('div','mpt-inline');folds.append(button(doc,'全部展开',()=>fold(false)),button(doc,'全部收起',()=>fold(true)));view.append(folds);
    searchRow.append(search,clearSearch,view);
    batch=make('div','mpt-batch');
    const selection=make('strong','mpt-selection-count');
    const all=button(doc,'全选可见',()=>{visibleRows().forEach(r=>selected.add(r.dataset.pmIdentifier));sync();});
    const clear=button(doc,'清空',()=>{selected.clear();anchor=null;sync();});
    const tools=make('div','mpt-inline');tools.append(selection,all,clear);
    const operations=make('div','mpt-inline');
    for(const [label,fn] of [['点选位置',startPlacement],['移动到…',move],['分组…',manageGroups],['复制',copy],['移出列表',detach]]){
      const b=button(doc,label,()=>fn([...selected]));b.dataset.batchAction=label;operations.append(b);
    }
    batch.append(tools,operations);
    placement=make('div','mpt-placement');placement.hidden=true;
    placementTitle=make('strong','mpt-placement-title');
    const row=make('div','mpt-inline');placementSide=make('select','mpt-input');placementSide.setAttribute('aria-label','就地插入前后位置');
    placementSide.append(new win.Option('放在目标之前','before'),new win.Option('放在目标之后','after'));
    placementSide.addEventListener('change',()=>{if(moving){moving.side=placementSide.value;schedule();}});
    row.append(placementSide,button(doc,'开头',()=>choosePosition({edge:'start'})),button(doc,'末尾',()=>choosePosition({edge:'end'})));
    placementPreview=make('p','mpt-placement-preview');placementPreview.setAttribute('aria-live','polite');
    placementConfirm=button(doc,'放在这里',finishPlacement,'mpt-primary');
    const actions=make('div','mpt-inline');actions.append(button(doc,'取消移动',cancelPlacement),placementConfirm);
    placement.append(placementTitle,row,placementPreview,actions);
    status=make('p','mpt-notice');status.setAttribute('role','status');
    bar.append(header,controls,searchRow,batch,placement,status);
    empty=make('li','mpt-empty','没有匹配的条目，试试其他关键词。');
    marker=make('li','mpt-insertion-marker');
  }
  function cancelPlacement(){moving=null;schedule();}
  function setText(node,text){if(node.textContent!==text)node.textContent=text;}
  function sync(){
    if(!bar)return;
    const writable=host.idle()&&!drafts.busy&&!busy;
    pick.textContent=picking?'结束多选':'多选';pick.setAttribute('aria-pressed',String(picking));batch.hidden=!picking||!!moving;
    bar.dataset.placing=String(!!moving);placement.hidden=!moving;
    clearSearch.hidden=!query;
    if(moving){
      const names=moving.ids.map(id=>prompts.get(id)?.name??id).join('、');
      setText(placementTitle,'待移动 '+moving.ids.length+' 条 · '+names);placementSide.value=moving.side;
      const target=moving.choice?.targetId,caption=moving.choice?.edge?'插到列表'+(moving.choice.edge==='start'?'开头':'末尾')
        :target?'插到「'+(prompts.get(target)?.name??target)+'」'+(moving.side==='before'?'之前':'之后'):'在下面的原列表中点选目标条目';
      setText(placementPreview,caption);placementConfirm.disabled=!moving.choice||!writable;
    }
    const visible=new Set(visibleRows().map(r=>r.dataset.pmIdentifier));
    const hidden=[...selected].filter(id=>!visible.has(id)).length;
    batch.querySelector('.mpt-selection-count').textContent='已选 '+selected.size+' 条'+(hidden?' · '+hidden+' 条已隐藏':'');
    const chosen=[...selected].map(id=>prompts.get(id)).filter(Boolean);
    for(const b of batch.querySelectorAll('[data-batch-action]')){
      b.disabled=!writable||!selected.size||(b.dataset.batchAction==='复制'&&chosen.some(p=>p.marker))
        ||(b.dataset.batchAction==='移出列表'&&chosen.some(p=>p.marker||p.system_prompt!==false));
    }
    undo.disabled=!writable||!viewState.undoLabel;undo.title=viewState.undoLabel?'撤销'+viewState.undoLabel:'当前没有可撤销的整理操作';
    save.disabled=!writable||!viewState.dirty;setText(save,busy?'保存中…':'保存到预设');
    setText(status,message||(viewState.dirty?'草稿有修改 · 整理完后保存到预设':query?'清除搜索可恢复拖拽；也可点拖柄选择落点。':''));
    for(const row of rows()){
      const checked=selected.has(row.dataset.pmIdentifier);row.classList.toggle('mpt-picked',checked&&picking);
      const wrap=row.querySelector('.mpt-select-wrap'),check=wrap?.querySelector('input');
      if(wrap)wrap.hidden=!picking;
      if(check){check.checked=checked;check.disabled=!writable;}
    }
  }
  function enhanceRow(row){
    if(row.dataset.mptReady)return;
    row.dataset.mptReady='true';
    const id=row.dataset.pmIdentifier,name=row.querySelector('.completion_prompt_manager_prompt_name'),label=name?.dataset.pmName||id;
    const wrap=make('label','mpt-select-wrap'),check=make('input','');check.type='checkbox';check.setAttribute('aria-label','选择：'+label);
    wrap.append(check);isolate(wrap);
    check.addEventListener('click',e=>{
      const visible=visibleRows().map(r=>r.dataset.pmIdentifier),start=visible.indexOf(anchor),end=visible.indexOf(id);
      const range=e.shiftKey&&start>=0?visible.slice(Math.min(start,end),Math.max(start,end)+1):[id];
      range.forEach(key=>check.checked?selected.add(key):selected.delete(key));anchor=id;sync();
    });name?.prepend(wrap);
    const more=button(doc,'•••',()=>rowMenu(id),'mpt-row-more');more.setAttribute('aria-label','操作：'+label);more.title='编辑、移动、复制、移出列表';isolate(more);
    row.querySelector('.prompt_manager_prompt_controls')?.append(more);
    const handle=row.querySelector('.drag-handle');
    if(handle){
      handle.tabIndex=0;handle.setAttribute('role','button');handle.setAttribute('aria-label','移动：'+label);handle.title='点击选择位置；拖拽微调；Alt + ↑ / ↓ 上下移位';
      handle.addEventListener('click',e=>{e.stopPropagation();if(!sorting&&Date.now()-dragEnded>300)startPlacement([id]);},{signal:life.signal});
      handle.addEventListener('keydown',e=>{
        if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();step(id,e.key==='ArrowUp'?-1:1);}
        else if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();startPlacement([id]);}
      },{signal:life.signal});
    }
  }
  function configureDrag(){
    const jq=win.jQuery?.(list),instance=jq?.sortable?.('instance');
    if(!instance)return;
    if(!originalSort.has(list)){
      originalSort.set(list,{handle:instance.options.handle,cancel:instance.options.cancel,scrollSensitivity:instance.options.scrollSensitivity,scrollSpeed:instance.options.scrollSpeed,disabled:instance.options.disabled});
      jq.on('sortstart.mpt',()=>{sorting=true;try{dragBefore=drafts.snapshot();}catch{dragBefore=null;}});
      jq.on('sortstop.mpt',()=>{sorting=false;dragEnded=Date.now();if(dragBefore&&drafts.recordNative(dragBefore,'拖拽排序'))message='顺序已调整，可撤销';dragBefore=null;schedule(true);});
    }
    const options={handle:'.drag-handle',cancel:'input,textarea,button,select,option,.mpt-heading',scrollSensitivity:64,scrollSpeed:16,
      disabled:!!query||!!moving||!host.idle()||busy||drafts.busy};
    for(const [key,value] of Object.entries(options))if(instance.options[key]!==value)jq.sortable('option',key,value);
  }
  function schedule(refresh=false){modelDirty ||= refresh;if(!disposed&&!frame)frame=win.requestAnimationFrame(()=>{frame=0;render();});}
  const observer=new win.MutationObserver(records=>{
    if(sorting)return;
    // Observe native structural changes only. Token counters, our own controls,
    // editor typing and unrelated chat mutations cannot invalidate the model.
    const selector='#completion_prompt_manager,#completion_prompt_manager_list,.completion_prompt_manager_prompt[data-pm-identifier]';
    if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches(selector)||n.querySelector(selector)))))schedule(true);
  });
  function render(){
    if(disposed||sorting)return;
    observer.disconnect();
    const focus=doc.activeElement,focusId=focus?.closest?.('[data-pm-identifier]')?.dataset.pmIdentifier;
    try{
      const current=doc.querySelector('#completion_prompt_manager_list');
      if(modelDirty||current!==list){
        modelDirty=false;
        try{snapshot=drafts.snapshot();viewState=drafts.viewState(snapshot);}catch{snapshot=null;viewState={};}
        nativeRows=[...current?.querySelectorAll(':scope > .completion_prompt_manager_prompt[data-pm-identifier]')??[]];
        if(snapshot){
          groups=displayGroups(snapshot.active,nativeRows.map(r=>r.dataset.pmIdentifier));
          groupById=new Map(groups.flatMap(g=>g.identifiers.map(id=>[id,g])));
          prompts=new Map(snapshot.active.prompts.map(p=>[p.identifier,p]));
          searchIndex=new Map(nativeRows.map(row=>{const id=row.dataset.pmIdentifier,p=prompts.get(id);return [id,((p?.name??'')+' '+(p?.content??'')+' '+(groupById.get(id)?.name??'')).toLocaleLowerCase()];}));
        }
      }
      if(!current||!snapshot){bar?.remove();return;}
      const nextScope=groupPreferenceKey(snapshot)+':'+snapshot.orderId;
      if(scope!==nextScope){scope=nextScope;selected.clear();query='';message='';anchor=null;moving=null;pendingFocus=null;if(search)search.value='';}
      foldStates=prefs().folds?.[scope]??{};
      list=current;list.classList.add('mpt-enhanced');list.dataset.placing=String(!!moving);
      for(const old of originalSort.keys())if(!old.isConnected){win.jQuery?.(old).off('.mpt');originalSort.delete(old);}
      if(!bar)createBar();if(!bar.isConnected||bar.nextElementSibling!==list)list.before(bar);
      const ids=nativeRows.map(r=>r.dataset.pmIdentifier),byId=new Map(nativeRows.map(r=>[r.dataset.pmIdentifier,r]));
      for(const id of selected)if(!byId.has(id))selected.delete(id);
      const q=query.trim().toLocaleLowerCase();
      const movingIds=new Set(moving?.ids);
      nativeRows.forEach((row,index)=>{
        const id=row.dataset.pmIdentifier,p=prompts.get(id),g=groupById.get(id);
        const matches=!q||searchIndex.get(id)?.includes(q);
        row.classList.toggle('mpt-hidden',!matches||(!q&&!!g&&folded(g)));enhanceRow(row);
        let target=row.querySelector('.mpt-place-target');
        if(moving){
          if(!target){target=button(doc,'',()=>choosePosition({targetId:id}),'mpt-place-target');isolate(target);target.append(make('small','mpt-order'),make('span',''),make('small',''));row.append(target);}
          target.disabled=movingIds.has(id);target.setAttribute('aria-pressed',String(moving.choice?.targetId===id));
          target.setAttribute('aria-label','选为落点：'+(p?.name??id));
          setText(target.children[0],String(index+1).padStart(2,'0'));setText(target.children[1],p?.name??id);setText(target.children[2],target.disabled?'待移动':'选择位置');
        }else target?.remove();
      });
      const seen=new Set(),used=new Set();
      for(const run of groupRuns(ids,groups)){
        const g=run.group;if(!g)continue;
        const matches=run.identifiers.filter(id=>!byId.get(id).classList.contains('mpt-hidden'));
        if(q&&!matches.length)continue;
        const key=g.id+':'+run.identifiers[0];used.add(key);
        let entry=headings.get(key);
        if(!entry){
          const heading=make('li','mpt-heading'),toggle=button(doc,'',()=>fold(undefined,[entry.group]),'mpt-group-toggle');
          toggle.append(make('span','mpt-group-chevron'),make('strong',''),make('small',''));
          const all=button(doc,'选择整组',()=>{entry.group.identifiers.forEach(id=>selected.add(id));sync();});
          heading.append(toggle,all);entry={heading,toggle,all};headings.set(key,entry);
        }
        entry.group=g;const {heading,toggle,all}=entry;
        toggle.dataset.group=g.id;toggle.setAttribute('aria-expanded',String(!!q||!folded(g)));
        setText(toggle.children[0],q||!folded(g)?'▾':'▸');setText(toggle.children[1],g.name+(seen.has(g.id)?' · 续':''));setText(toggle.children[2],run.identifiers.length+' 条');
        all.hidden=!picking||!!moving;
        const first=byId.get(run.identifiers[0]);if(heading.nextElementSibling!==first)list.insertBefore(heading,first);seen.add(g.id);
      }
      for(const [key,entry] of headings)if(!used.has(key)){entry.heading.remove();headings.delete(key);}
      let markerTarget;
      if(moving?.choice?.targetId){
        const target=byId.get(moving.choice.targetId);
        if(target&&!target.classList.contains('mpt-hidden')){
          markerTarget=target;setText(marker,'↳ 在这里插入 '+moving.ids.length+' 个条目');
          if(moving.side==='before'){if(marker.nextElementSibling!==target)target.before(marker);}else if(marker.previousElementSibling!==target)target.after(marker);
        }
      }
      if(!markerTarget)marker.remove();
      empty.hidden=!q||visibleRows().length>0;if(!empty.isConnected)list.append(empty);
      count.textContent=nativeRows.length+' 条'+(query?' · 匹配 '+visibleRows().length+' 条':'')+(groups.length?' · '+groups.length+' 组':'');
      configureDrag();sync();
      if(pendingFocus&&!pendingFocus.node?.isConnected){byId.get(pendingFocus.id)?.querySelector('.drag-handle')?.focus({preventScroll:true});pendingFocus=null;}
      if(focusId&&!focus?.isConnected)byId.get(focusId)?.querySelector('.drag-handle')?.focus({preventScroll:true});
    }catch(e){noticeError(e.message);}finally{observer.observe(doc.body,{childList:true,subtree:true});}
  }
  function noticeError(text){message=text;if(status)status.textContent=text;}
  const unsubscribe=host.subscribe(()=>schedule(true));
  doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)schedule(true);},{signal:life.signal});
  doc.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&moving&&!modal&&!doc.querySelector('dialog[open]')){
      e.preventDefault();e.stopImmediatePropagation();cancelPlacement();search.focus({preventScroll:true});
    }
  },{capture:true,signal:life.signal});
  render();
  return {notice,openGroups:()=>manageGroups(),dispose(){
    disposed=true;life.abort();observer.disconnect();unsubscribe();win.cancelAnimationFrame(frame);modal?.close();bar?.remove();empty?.remove();
    for(const [node,options] of originalSort){const jq=win.jQuery?.(node);jq?.off('.mpt');if(jq?.sortable?.('instance'))jq.sortable('option',options);}
    for(const row of rows()){
      row.classList.remove('mpt-hidden','mpt-picked');delete row.dataset.mptReady;
      row.querySelector('.mpt-select-wrap')?.remove();row.querySelector('.mpt-row-more')?.remove();
      row.querySelector('.mpt-place-target')?.remove();
    }
    list?.querySelectorAll('.mpt-heading,.mpt-insertion-marker').forEach(n=>n.remove());list?.classList.remove('mpt-enhanced');if(list)delete list.dataset.placing;
    getManager()?.render(false);
  }};
}
