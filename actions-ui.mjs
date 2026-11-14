import {element, button, dialog} from './dom.mjs';
import {orderFor} from './entries.mjs';
import {displayGroups, withPromptGroups} from './prompt-groups.mjs';
import {moveRows} from './operations.mjs';
import {renderGroupEditor} from './group-editor.mjs';

export function openMove(win, drafts, identifiers, done, onClose, options = {}) {
  const expected=drafts.snapshot(), ids=new Set(identifiers), preset=expected.active;
  const order=orderFor(preset,expected.orderId).order;
  const prompts=new Map(preset.prompts.map(p=>[p.identifier,p]));
  const groups=displayGroups(preset,order.map(o=>o.identifier));
  const groupNames=new Map(groups.flatMap(g=>g.identifiers.map(id=>[id,g.name])));
  const adding=!!options.newPrompt;
  const d=dialog(win,adding?'新增条目 · 选择插入位置':'移动到…',onClose), doc=win.document;
  const make=(tag,cls,text)=>element(doc,tag,cls,text);
  const description=make('p','mpt-help',adding?'选择位置后，一次完成创建并加入当前列表。':'移动 '+ids.size+' 个条目 · 保留彼此顺序、启用状态及分组');
  const names=make('p','mpt-move-source',adding?options.newPrompt.name:[...ids].map(id=>prompts.get(id)?.name??id).join('、'));
  const search=make('input','mpt-input');search.type='search';search.placeholder='搜索目标条目或分组';search.setAttribute('aria-label','搜索移动目标');
  const sides=make('div','mpt-inline'), side=make('select','mpt-input');side.setAttribute('aria-label','目标前后位置');
  side.append(new win.Option('放在目标之前','before'),new win.Option('放在目标之后','after'));
  const top=button(doc,'列表开头',()=>choose({edge:'start'})), bottom=button(doc,'列表末尾',()=>choose({edge:'end'}));
  sides.append(side,top,bottom);
  const list=make('div','mpt-destinations');list.setAttribute('aria-label','可选目标条目');
  const preview=make('p','mpt-move-preview','选择一个目标位置');preview.setAttribute('aria-live','polite');
  const enabled=make('input','');enabled.type='checkbox';
  const enabledLabel=make('label','mpt-inline');enabledLabel.append(enabled,doc.createTextNode('加入后启用'));
  const apply=button(doc,adding?'创建并插入':'确认移动',()=>{
    try {
      if(adding){options.onChoose({...chosen,side:side.value,enabled:enabled.checked});d.close();return;}
      drafts.apply(p=>moveRows(p,identifiers,{orderId:expected.orderId,...chosen,side:side.value}),'移动条目',expected);
      done('已移动 '+ids.size+' 个条目，可撤销');d.close();
    }catch(e){d.status.textContent=e.message;}
  },'mpt-primary');apply.disabled=true;
  let chosen;
  function choose(value) {
    chosen=value;apply.disabled=false;
    top.setAttribute('aria-pressed',String(value.edge==='start'));bottom.setAttribute('aria-pressed',String(value.edge==='end'));
    preview.textContent=value.edge ? '放到列表'+(value.edge==='start'?'开头':'末尾')
      : '将 '+(adding?'新条目':ids.size+' 个条目')+'放在「'+(prompts.get(value.targetId)?.name??value.targetId)+'」'+(side.value==='before'?'之前':'之后');
    for(const b of list.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.target===value.targetId));
  }
  const destinations=[];
  for(const [index,row] of order.entries()) {
      const p=prompts.get(row.identifier), group=groupNames.get(row.identifier)??'未分组';
      if(!p||ids.has(p.identifier))continue;
      const b=button(doc,'',()=>choose({targetId:p.identifier}),'mpt-destination');b.dataset.target=p.identifier;
      b.setAttribute('aria-pressed',String(chosen?.targetId===p.identifier));
      b.append(make('span','mpt-order',String(index+1).padStart(2,'0')),make('span','mpt-destination-name',p.name||p.identifier),
        make('small','',group+' · '+(row.enabled?'启用':'停用')));list.append(b);
      destinations.push({node:b,search:((p.name??'')+' '+group).toLocaleLowerCase()});
  }
  const empty=make('p','mpt-help','没有匹配的目标，可修改搜索或选择列表开头／末尾。');list.append(empty);
  function render() {
    const q=search.value.trim().toLocaleLowerCase();let visible=0;
    for(const entry of destinations){entry.node.hidden=!entry.search.includes(q);if(!entry.node.hidden)visible++;}
    empty.hidden=visible>0;
  }
  search.addEventListener('input',render);side.addEventListener('change',()=>{if(chosen)choose(chosen);});
  d.body.append(description,names,search,sides,list,preview,make('p','mpt-help','改变列表顺序不改变条目的注入深度。'));
  if(adding)d.body.append(enabledLabel);
  d.actions.append(button(doc,'取消',d.close),apply);render();search.focus();return d;
}

export function openGroups(win,drafts,done,onClose,identifiers=[]) {
  const expected=drafts.snapshot(), d=dialog(win,'预设分组',onClose);
  d.root.classList.add('mpt-dialog');
  d.root.querySelector('header').classList.add('mpt-dialog-head');
  d.body.classList.add('mpt-dialog-body');d.actions.classList.add('mpt-dialog-actions');
  const editor=renderGroupEditor(win.document,d.body,expected.active,{identifiers});
  d.actions.append(editor.mobileAction,button(win.document,'应用分组到草稿',()=>{
    try {
      const value=editor.value();drafts.apply(p=>withPromptGroups(p,value),'修改分组',expected);
      editor.saved(value);done('分组已应用到草稿，可撤销');d.close();
    }catch(e){d.status.textContent=e.message;}
  },'mpt-primary'));
  return d;
}
