import test from 'node:test';
import assert from 'node:assert/strict';
import {createHost} from '../host.mjs';
import {fixture,clone} from './fixtures.mjs';

function setup(t){
  const f=fixture(),data=new Map(),options=[];let hook=()=>{};
  const db={async getItem(key){return clone(data.get(key)??null);},async setItem(key,value){await hook(value);data.set(key,clone(value));}};
  f.win.SillyTavern.libs={localforage:{INDEXEDDB:'indexeddb',createInstance(value){options.push(value);return db;}}};
  f.win.localStorage.removeItem=key=>f.storage.delete(key);
  const host=createHost(f.win);t.after(()=>host.dispose());
  return {...f,host,data,options,setHook:fn=>{hook=fn;}};
}
const old=n=>({time:'2026-10-22T00:00:0'+n+'.000Z',name:'old-'+n,preset:{prompts:[],extensions:{keep:n}}});
const quota=()=>new DOMException('storage full','QuotaExceededError');

test('localStorage 已满仍可解散分组；预设原文件及旧备份先迁入 IndexedDB',async t=>{
  const f=setup(t),groups={schema:1,groups:[{id:'base',name:'基础',collapsed:false,identifiers:['base']}]};
  f.ctx.chatCompletionSettings.extensions.miao_prompt_groups=groups;
  const before=f.host.snapshot().saved;
  f.storage.set('miao.prompt-groups.backups',JSON.stringify([old(2),old(1)]));f.storage.set('other.extension','保留');
  f.win.localStorage.setItem=()=>{throw quota();};
  await f.host.writePromptGroups({schema:1,groups:[]});
  assert.deepEqual(f.disk.SL.extensions.miao_prompt_groups.groups,[]);
  assert.deepEqual(f.data.get('recent')[0].preset,before);
  assert.deepEqual((await f.host.readBackups()).map(b=>b.name),['SL','old-2','old-1']);
  assert.equal(f.storage.has('miao.prompt-groups.backups'),false);assert.equal(f.storage.get('other.extension'),'保留');
  assert.equal(f.options[0].driver,'indexeddb');assert.ok(f.locks.includes('miao-prompt-groups-backups'));
});
test('数据库空间不足时依次减少旧备份；单份也失败则不覆盖旧记录或预设',async t=>{
  const f=setup(t);f.data.set('recent',[old(2),old(1)]);const attempts=[];
  f.setHook(values=>{attempts.push(values.length);if(values.length>1)throw quota();});
  await f.host.writePromptGroups({schema:1,groups:[],note:'first'});
  assert.deepEqual(attempts,[3,2,1]);assert.equal((await f.host.readBackups()).length,1);
  const backups=clone(f.data.get('recent')),disk=clone(f.disk.SL);
  f.storage.set('miao.prompt-groups.backups',JSON.stringify([old(2)]));
  f.setHook(()=>{throw quota();});
  await assert.rejects(f.host.writePromptGroups({schema:1,groups:[],note:'second'}),/备份空间不足.*尚未保存/);
  assert.deepEqual(f.disk.SL,disk);assert.deepEqual(f.data.get('recent'),backups);assert.ok(f.storage.has('miao.prompt-groups.backups'));
});
test('异步备份期间发生草稿修改，完成备份后仍拒绝过期保存',async t=>{
  const f=setup(t),disk=clone(f.disk.SL);
  f.setHook(()=>{f.ctx.chatCompletionSettings.prompts[0].content='新草稿';});
  await assert.rejects(f.host.writePromptGroups({schema:1,groups:[],note:'changed'}),/写入前预设发生变化/);
  assert.deepEqual(f.disk.SL,disk);assert.equal(f.ctx.chatCompletionSettings.prompts[0].content,'新草稿');
});
test('备份数据库故障不回退小容量存储、不删除旧备份、不保存预设',async t=>{
  const f=setup(t),disk=clone(f.disk.SL),legacy=JSON.stringify([old(1)]);f.storage.set('miao.prompt-groups.backups',legacy);
  f.setHook(()=>{throw Error('database unavailable');});
  await assert.rejects(f.host.writePromptGroups({schema:1,groups:[],note:'changed'}),/备份未能写入/);
  assert.deepEqual(f.disk.SL,disk);assert.equal(f.storage.get('miao.prompt-groups.backups'),legacy);assert.equal(f.data.size,0);
});
