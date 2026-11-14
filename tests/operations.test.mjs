import test from 'node:test';
import assert from 'node:assert/strict';
import {moveRows,duplicateRows,detachRows,promptFields,insertRow} from '../operations.mjs';
import {createDraftController} from '../draft.mjs';
import {createHost} from '../host.mjs';
import {fixture} from './fixtures.mjs';
const preset=()=>({prompts:['a','b','c','d'].map(identifier=>({identifier,name:identifier,content:'正文 '+identifier,role:'user',system_prompt:false,injection_position:1,injection_depth:4,unknown:{keep:true}})),
  prompt_order:[{character_id:100001,order:['a','b','c','d'].map(identifier=>({identifier,enabled:identifier!=='b',extra:identifier}))},
    {character_id:42,order:[{identifier:'b',enabled:true}]}],extensions:{private:{keep:true},miao_prompt_groups:{schema:1,groups:[{id:'g',name:'分组',collapsed:true,identifiers:['a','b']}]}}});
const ids=p=>p.prompt_order[0].order.map(o=>o.identifier);
test('多选移动保持相对顺序、状态、分组和其他顺序，输入不被修改',()=>{
  const p=preset(),before=structuredClone(p),moved=moveRows(p,['c','a'],{targetId:'d',side:'after'});
  assert.deepEqual(ids(moved),['b','d','a','c']);assert.deepEqual(p,before);
  assert.deepEqual(moved.prompts,p.prompts);assert.deepEqual(moved.extensions,p.extensions);assert.deepEqual(moved.prompt_order[1],p.prompt_order[1]);
  assert.equal(moved.prompt_order[0].order[0].enabled,false);
  assert.deepEqual(ids(moveRows(p,['b'],{edge:'start'})),['b','a','c','d']);
  assert.deepEqual(ids(moveRows(p,['a'],{edge:'end'})),['b','c','d','a']);
  assert.throws(()=>moveRows(p,['a'],{targetId:'a'}),/以外/);assert.throws(()=>moveRows(p,['a'],{targetId:'gone'}),/变化/);
});
test('副本默认停用、独立标识、位于最后选中条目之后，保留正文和注入字段',()=>{
  const p=preset();let sequence=0;
  const {preset:next,identifiers}=duplicateRows(p,['c','a'],100001,()=>`new-${++sequence}`);
  assert.deepEqual(ids(next),['a','b','c',...identifiers,'d']);
  for(const id of identifiers){const copy=next.prompts.find(p=>p.identifier===id);assert.match(copy.name,/副本/);assert.equal(copy.injection_depth,4);assert.deepEqual(copy.unknown,{keep:true});assert.equal(next.prompt_order[0].order.find(o=>o.identifier===id).enabled,false);}
  assert.ok(next.extensions.miao_prompt_groups.groups[0].identifiers.includes(identifiers[0]));
  assert.deepEqual(next.prompt_order[1],p.prompt_order[1]);
});
test('移出仅处理当前列表，保留正文、分组和其他顺序；保护内置条目',()=>{
  const p=preset(),next=detachRows(p,['a','b']);
  assert.deepEqual(ids(next),['c','d']);assert.deepEqual(next.prompts,p.prompts);assert.deepEqual(next.extensions,p.extensions);assert.deepEqual(next.prompt_order[1],p.prompt_order[1]);
  p.prompts[0].system_prompt=true;assert.throws(()=>detachRows(p,['a']),/内置条目/);
  assert.throws(()=>detachRows(p,['missing']),/变化/);
});
test('新增与插入是同一操作，失败不留孤立正文，状态和位置可选',()=>{
  const p=preset(),prompt={identifier:'new',name:'新条目',content:'{{getvar::x}}',role:'user',injection_depth:2};
  const next=insertRow(p,prompt,{targetId:'b',side:'before',enabled:true});
  assert.deepEqual(ids(next),['a','new','b','c','d']);assert.equal(next.prompt_order[0].order[1].enabled,true);
  assert.equal(next.prompts.at(-1).injection_depth,2);assert.deepEqual(ids(p),['a','b','c','d']);
  assert.throws(()=>insertRow(p,prompt,{targetId:'gone'}),/变化/);assert.equal(p.prompts.length,4);
  assert.deepEqual(ids(insertRow(p,prompt,{edge:'end'})),['a','b','c','d','new']);
});
function setup(t){
  const f=fixture(preset());let renders=0,open=false;const host=createHost(f.win);t.after(()=>host.dispose());
  const manager={activeCharacter:{id:100001},get serviceSettings(){return f.ctx.chatCompletionSettings;},render(){renders++;}};
  const drafts=createDraftController(host,()=>manager,{editorOpen:()=>open});
  return {...f,host,drafts,manager,setOpen(value){open=value;},get renders(){return renders;}};
}
test('草稿操作不写预设，撤销保留其他设置；编辑、生成和外部修改不会被覆盖',t=>{
  const f=setup(t),before=promptFields(f.ctx.chatCompletionSettings);
  f.drafts.apply(p=>moveRows(p,['a'],{edge:'end'}),'移动');
  assert.equal(f.renders,1);assert.deepEqual(promptFields(f.disk.SL),before);
  f.ctx.chatCompletionSettings.temp_openai=.9;f.ctx.chatCompletionSettings.extensions.extra='keep';
  f.drafts.undo();assert.deepEqual(promptFields(f.ctx.chatCompletionSettings),before);assert.equal(f.ctx.chatCompletionSettings.temp_openai,.9);assert.equal(f.ctx.chatCompletionSettings.extensions.extra,'keep');
  f.drafts.apply(p=>detachRows(p,['b']),'移出');
  f.ctx.chatCompletionSettings.prompts[0].content='用户新内容';
  assert.equal(f.drafts.undoLabel(),'');assert.throws(()=>f.drafts.undo(),/其他修改/);
  f.setOpen(true);assert.throws(()=>f.drafts.apply(p=>p,'测试'),/编辑框/);f.setOpen(false);
  f.win.document.body.dataset.generating='true';assert.throws(()=>f.drafts.apply(p=>p,'测试'),/生成/);
});
test('陈旧落点、切换预设不能复用旧选择；原生拖拽也能撤销',async t=>{
  const f=setup(t),old=f.drafts.snapshot();
  f.ctx.chatCompletionSettings.prompt_order[0].order.reverse();
  f.drafts.recordNative(old,'拖拽');assert.equal(f.drafts.undoLabel(),'拖拽');f.drafts.undo();assert.deepEqual(ids(f.ctx.chatCompletionSettings),['a','b','c','d']);
  await f.switch();assert.throws(()=>f.drafts.apply(p=>p,'过期',old),/变化/);
});
test('显式保存会保存原生草稿，失败保留草稿；备份保存前版本',async t=>{
  const f=setup(t);f.drafts.apply(p=>moveRows(p,['a'],{edge:'end'}),'移动');
  f.setSave(()=>{throw Error('network failure');});await assert.rejects(f.drafts.save(),/network failure/);
  assert.equal(f.drafts.dirty(),true);assert.deepEqual(ids(f.disk.SL),['a','b','c','d']);
  f.setSave(()=>{});await f.drafts.save();assert.deepEqual(ids(f.disk.SL),['b','c','d','a']);assert.equal(f.drafts.dirty(),false);
  assert.deepEqual(ids((await f.host.readBackups())[0].preset),['a','b','c','d']);
});
test('界面状态复用同一快照，事务仍读取实时内容并拒绝过期写入',t=>{
  const f=setup(t);f.drafts.apply(p=>moveRows(p,['a'],{edge:'end'}),'移动');
  const current=f.drafts.snapshot(),original=f.host.snapshot;let reads=0;
  f.host.snapshot=()=>{reads++;return original();};
  for(let i=0;i<20;i++)assert.deepEqual(f.drafts.viewState(current),{undoLabel:'移动',dirty:true});
  assert.equal(reads,0);
  f.ctx.chatCompletionSettings.prompts[0].content='外部编辑';
  assert.throws(()=>f.drafts.apply(p=>moveRows(p,['b'],{edge:'end'}),'移动',current),/变化/);
  assert.ok(reads>0);assert.equal(f.drafts.undoLabel(),'');
});
test('未改变顺序的拖拽不创建撤销记录，快照与真实设置隔离',t=>{
  const f=setup(t),current=f.drafts.snapshot();
  assert.equal(f.drafts.recordNative(current,'拖拽'),false);assert.equal(f.drafts.undoLabel(),'');
  current.active.prompts[0].content='临时显示副本';current.saved.extensions.private.keep=false;
  assert.equal(f.ctx.chatCompletionSettings.prompts[0].content,'正文 a');assert.equal(f.presets[0].extensions.private.keep,true);
});

test('TT 附加到现有消息的注入参数在移动和复制后完整保留',()=>{
  const p=preset();Object.assign(p.prompts[0],{injection_position:2,attach_role:'assistant',attach_index:3,attach_side:'start'});
  const moved=moveRows(p,['a'],{edge:'end'}),{preset:copied}=duplicateRows(moved,['a'],100001,()=> 'copy-tt');
  const copy=copied.prompts.find(p=>p.identifier==='copy-tt');
  for(const key of ['injection_position','attach_role','attach_index','attach_side'])assert.equal(copy[key],p.prompts[0][key]);
  assert.deepEqual(moved.prompts,p.prompts);
});

test('WebView 缺少 Web Locks 时仍能整理草稿，显式保存准确报错且不改预设文件',async t=>{
  const f=setup(t);f.win.navigator.locks=undefined;
  f.drafts.apply(p=>moveRows(p,['a'],{edge:'end'}),'移动');
  await assert.rejects(f.drafts.save(),/缺少 Web Locks/);
  assert.deepEqual(ids(f.disk.SL),['a','b','c','d']);assert.equal(f.drafts.dirty(),true);
});
