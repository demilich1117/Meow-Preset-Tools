import {readGroups, groupPromptChoices} from './prompt-groups.mjs';

export function renderGroupEditor(doc, container, preset, {identifiers=[]} = {}) {
  const prompts=groupPromptChoices(preset);
  let initial=readGroups(preset),draft=structuredClone(initial), anchor=null;
  const known=new Set(prompts.map(p=>p.identifier));
  const selected=new Set(identifiers.filter(id=>known.has(id))), history=[], rows=[],groupNodes=new Map();
  let membership=new Map();
  const make=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,fn)=>{const n=make('button','mpt-button',text);n.type='button';n.addEventListener('click',fn);return n;};
  const option=(text,value)=>new doc.defaultView.Option(text,value);
  const intro=make('p','mpt-help mpt-intro','把相关条目收在一起，提示词顺序与开关保持不变。');
  const tabs=make('div','mpt-editor-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','分组整理步骤');
  const tabEntries=button('选择条目',()=>setView('entries')),tabGroups=button('管理分组',()=>setView('groups'));
  for(const [tab,view] of [[tabEntries,'entries'],[tabGroups,'groups']]){
    // ST a11y.js assigns role=button to every .menu_button, including tabs.
    tab.className='mpt-button';
    tab.id='mpt-tab-'+view;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','mpt-panel-'+view);
    tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const target=event.key==='Home'?tabEntries:event.key==='End'?tabGroups:tab===tabEntries?tabGroups:tabEntries;target.click();target.focus();});
  }
  tabs.append(tabEntries,tabGroups);
  function setView(view){
    container.dataset.mptView=view;
    for(const [tab,value] of [[tabEntries,'entries'],[tabGroups,'groups']]){tab.setAttribute('aria-selected',String(view===value));tab.tabIndex=view===value?0:-1;}
    mobileAction.hidden=view!=='entries';setCompose(false);
    if(view==='groups')settings.open=true;
  }
  const search=make('input','text_pole');search.type='search';search.placeholder='搜索条目';search.setAttribute('aria-label','搜索分组条目');
  const filter=make('select','text_pole');filter.setAttribute('aria-label','筛选分组');
  const filters=make('div','mpt-filters');filters.append(search,filter);
  const entryList=make('div','mpt-entries');entryList.setAttribute('aria-label','预设条目');
  const status=make('p','mpt-help');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const composer=make('div','mpt-composer'), newName=make('input','text_pole');
  composer.id='mpt-compose';
  const mobileAction=button('分组操作',()=>setCompose(container.dataset.mptCompose!=='true'));
  mobileAction.classList.add('mpt-compose-toggle');mobileAction.setAttribute('aria-controls',composer.id);mobileAction.setAttribute('aria-label','分组操作');
  const composeClose=button('收起',()=>{setCompose(false);mobileAction.focus({preventScroll:true});});composeClose.classList.add('mpt-compose-close');
  function setCompose(open){container.dataset.mptCompose=String(open);mobileAction.setAttribute('aria-expanded',String(open));mobileAction.hidden=open||container.dataset.mptView!=='entries';}
  newName.placeholder='给选中条目起个组名';newName.maxLength=100;newName.setAttribute('aria-label','新分组名称');
  const target=make('select','text_pole');target.setAttribute('aria-label','移入已有分组');
  const selectionCount=make('strong','mpt-selection-count','先勾选要放在一起的条目');
  const settings=make('details','mpt-settings'), summary=make('summary',''), groupList=make('div','mpt-group-list');
  settings.append(summary,make('p','mpt-help','点组名可改名；默认折叠随预设发布。'),groupList);
  function checkpoint(){history.push(structuredClone(draft));if(history.length>20)history.shift();}
  function clearSelection(){selected.clear();anchor=null;updateSelection();}
  function assign(ids,groupId){
    for(const group of draft.groups)group.identifiers=group.identifiers.filter(id=>!ids.has(id));
    draft.groups.find(g=>g.id===groupId)?.identifiers.push(...ids);
  }
  function finish(message){setCompose(false);selected.clear();anchor=null;refresh();status.textContent=message+'；应用后生效。';}
  function createGroup(){
    const name=newName.value.trim();
    if(!selected.size||!name)return;
    if(draft.groups.length>=200){status.textContent='最多支持 200 个分组。';return;}
    if(draft.groups.some(g=>g.name.trim()===name)){status.textContent='已有同名分组，可直接选择“移入已有分组”。';return;}
    checkpoint();const count=selected.size,id=doc.defaultView.crypto.randomUUID();
    draft.groups.push({id,name,collapsed:false,identifiers:[]});assign(selected,id);newName.value='';
    finish('已将 '+count+' 条归入「'+name+'」');
  }
  const create=button('新建分组',createGroup);create.classList.add('mpt-create');
  newName.addEventListener('input',()=>{create.disabled=!selected.size||!newName.value.trim();});
  newName.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();createGroup();}});
  target.addEventListener('change',()=>{
    const group=draft.groups.find(g=>g.id===target.value);if(!group||!selected.size)return;
    checkpoint();const count=selected.size;assign(selected,group.id);finish('已将 '+count+' 条移入「'+group.name+'」');
  });
  const ungroup=button('取消分组',()=>{if(!selected.size)return;checkpoint();const count=selected.size;assign(selected,'');finish('已将 '+count+' 条移回未分组');});
  const createRow=make('div','mpt-compose-row'), moveRow=make('div','mpt-compose-row');
  const composeHead=make('div','mpt-compose-head');composeHead.append(selectionCount,composeClose);
  createRow.append(newName,create);moveRow.append(target,ungroup);composer.append(make('h3','mpt-section-title','分配到分组'),composeHead,createRow,moveRow);
  const clear=button('清空选择',clearSelection), undo=button('撤销上一步',()=>{
    if(!history.length)return;draft=history.pop();finish('已撤销上一步分组修改');
  });
  const groupUndo=button('撤销上一步',()=>undo.click());groupUndo.classList.add('mpt-mobile-undo');
  settings.insertBefore(groupUndo,groupList);
  const selectVisible=button('全选当前结果',()=>{for(const row of rows)if(!row.node.hidden)selected.add(row.id);updateSelection();if(selected.size)setCompose(true);});
  const selectionTools=make('div','mpt-selection-tools');selectionTools.append(selectVisible,clear,undo);
  function updateSelection(){
    let hidden=0;
    for(const row of rows){row.check.checked=selected.has(row.id);row.node.classList.toggle('mpt-selected',row.check.checked);if(row.check.checked&&row.node.hidden)hidden++;}
    selectionCount.textContent=selected.size?'已选 '+selected.size+' 条'+(hidden?'（'+hidden+' 条在筛选外）':''):'先勾选要放在一起的条目';
    newName.disabled=!selected.size;create.disabled=!selected.size||!newName.value.trim();
    target.disabled=!selected.size||!draft.groups.length;ungroup.disabled=!selected.size;clear.disabled=!selected.size;undo.disabled=!history.length;
    groupUndo.disabled=undo.disabled;
    tabEntries.textContent=selected.size?'选择条目 · '+selected.size+' 已选':'选择条目';
    mobileAction.textContent=selected.size?'分组 · '+selected.size:'分组操作';mobileAction.disabled=!selected.size;
    if(!selected.size)setCompose(false);
  }
  function filterRows(){
    const q=search.value.trim().toLocaleLowerCase(), value=filter.value;
    for(const row of rows){const group=membership.get(row.id);row.node.hidden=!row.search.includes(q)||(value==='ungrouped'?!!group:value.startsWith('group:')?group?.id!==value.slice(6):false);}
    empty.hidden=rows.some(row=>!row.node.hidden);selectVisible.disabled=!empty.hidden;updateSelection();
  }
  function drawGroups(){
    summary.textContent='分组设置 · '+draft.groups.length+' 组';tabGroups.textContent='管理分组 · '+draft.groups.length;
    const groupIds=new Set(draft.groups.map(g=>g.id));
    for(const [id,entry] of groupNodes)if(!groupIds.has(id)){entry.row.remove();groupNodes.delete(id);}
    groupEmpty.hidden=!!draft.groups.length;
    let previous=groupEmpty;
    for(const group of draft.groups){
      let entry=groupNodes.get(group.id);
      if(!entry){
      const row=make('div','mpt-group-edit'), name=make('input','text_pole'),identity=make('div','mpt-group-identity'),controls=make('div','mpt-group-controls');
      name.maxLength=100;name.setAttribute('aria-label','分组名称');
      name.addEventListener('change',()=>{const group=entry.group,value=name.value.trim();if(!value){name.value=group.name;return;}if(value===group.name)return;checkpoint();group.name=value;refresh();status.textContent='已修改组名；应用后生效。';});
      const label=make('label','mpt-default'), folded=make('input','');folded.type='checkbox';folded.checked=group.collapsed;
      folded.addEventListener('change',()=>{checkpoint();entry.group.collapsed=folded.checked;updateSelection();});label.append(folded,doc.createTextNode('默认折叠'));
      const remove=button('解散',()=>{const group=entry.group;checkpoint();draft.groups.splice(draft.groups.indexOf(group),1);finish('已解散「'+group.name+'」，条目保留');});
      remove.title='保留条目，只移除分组，可撤销';remove.classList.add('mpt-dissolve');
      const count=make('span','mpt-group-count');identity.append(name,count);
      controls.append(label,remove);row.append(identity,controls);groupList.append(row);
      entry={row,name,folded,count};groupNodes.set(group.id,entry);
      }
      entry.group=group;entry.name.value=group.name;entry.folded.checked=group.collapsed;
      entry.count.textContent=group.identifiers.filter(id=>known.has(id)).length+' 条';
      if(previous.nextElementSibling!==entry.row)previous.after(entry.row);previous=entry.row;
    }
  }
  function refresh(){
    membership=new Map(draft.groups.flatMap(group=>group.identifiers.map(id=>[id,group])));
    const old=filter.value;
    filter.replaceChildren(option('全部条目','all'),option('仅未分组','ungrouped'),...draft.groups.map(g=>option(g.name,'group:'+g.id)));
    filter.value=[...filter.options].some(o=>o.value===old)?old:'all';
    target.replaceChildren(option('移入已有分组…',''),...draft.groups.map(g=>option(g.name,g.id)));
    for(const row of rows){const group=membership.get(row.id);row.badge.textContent=group?.name??'未分组';row.badge.classList.toggle('mpt-unassigned',!group);}
    drawGroups();filterRows();
  }
  for(const prompt of prompts){
    const name=prompt.name||prompt.identifier, node=make('label','mpt-entry'), check=make('input',''), badge=make('span','mpt-badge');
    check.type='checkbox';check.value=prompt.identifier;check.setAttribute('aria-label','选择：'+name);
    const row={node,check,badge,id:prompt.identifier,search:(name+' '+prompt.identifier).toLocaleLowerCase()};
    check.addEventListener('click',event=>{
      const visible=rows.filter(r=>!r.node.hidden), start=visible.findIndex(r=>r.id===anchor), end=visible.indexOf(row), value=check.checked;
      const range=event.shiftKey&&start>=0?visible.slice(Math.min(start,end),Math.max(start,end)+1):[row];
      for(const item of range){if(value)selected.add(item.id);else selected.delete(item.id);}
      anchor=row.id;updateSelection();if(selected.size)setCompose(true);
    });
    node.title=prompt.identifier;node.append(check,make('span','mpt-entry-title',name),badge);entryList.append(node);rows.push(row);
  }
  const empty=make('p','mpt-empty','没有匹配的条目，试试其他关键词或分组。');entryList.append(empty);
  search.addEventListener('input',filterRows);filter.addEventListener('change',filterRows);
  const workspace=make('div','mpt-workspace'),picker=make('section','mpt-picker'),organizer=make('section','mpt-organizer');
  picker.id='mpt-panel-entries';settings.id='mpt-panel-groups';
  picker.setAttribute('role','tabpanel');picker.setAttribute('aria-labelledby',tabEntries.id);
  settings.setAttribute('role','tabpanel');settings.setAttribute('aria-labelledby',tabGroups.id);
  picker.append(make('h3','mpt-section-title','选择条目'),filters,selectionTools,entryList,make('p','mpt-help mpt-range-hint','按住 Shift 点击，可连续选择。'));
  organizer.append(composer,status,settings);workspace.append(picker,organizer);container.append(intro,tabs,workspace);
  const groupEmpty=make('p','mpt-help','先选中条目，创建你的第一个分组。');groupList.append(groupEmpty);
  setView('entries');refresh();if(selected.size)setCompose(true);
  return {mobileAction,value:()=>structuredClone(draft),dirty:()=>!!newName.value.trim()||JSON.stringify(draft)!==JSON.stringify(initial),
    saved(value){initial=structuredClone(value);status.textContent=JSON.stringify(draft)===JSON.stringify(initial)?'分组已保存，可继续整理。':'已保存；之后的新修改尚未保存。';}};
}
