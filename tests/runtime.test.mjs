import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntime} from '../runtime.mjs';

function modules({agent=false,editor=null}={}) {
  const paths=[];
  return {paths, async load(path) {
    paths.push(path);
    if(path==='/scripts/openai.js')return {promptManager:{}};
    if(path==='/script.js')return {isGenerating:()=>false};
    if(path==='/scripts/utils.js')return {download:async()=>{}};
    if(path.includes('codemirror'))return {getMountedCodeMirrorEditor:()=>editor};
    if(path.includes('agent-run'))return {hasActiveAgentRun:()=>agent};
    throw Error('unexpected import');
  }};
}
test('普通 ST 不加载 TT 模块，保留生成检测和宿主导出接口',async()=>{
  const m=modules(),runtime=await loadRuntime({},m.load);
  assert.equal(runtime.tt,false);assert.equal(m.paths.length,3);assert.equal(runtime.getEditor({}),null);assert.equal(runtime.isGenerating(),false);
});
test('TT 就绪后才加载宿主，CodeMirror 与 Agent 状态走真实能力检测',async()=>{
  let ready;const gate=new Promise(resolve=>ready=resolve),editor={flush(){}};
  const m=modules({agent:true,editor}),pending=loadRuntime({__TAURITAVERN__:{ready:gate,api:{agent:{}}}},m.load);
  assert.equal(m.paths.length,0);ready();const runtime=await pending;
  assert.equal(runtime.tt,true);assert.equal(runtime.getEditor({}),editor);assert.equal(runtime.isGenerating(),true);
});
test('TT ready 失败不继续加载；代码编辑器缺失时列表仍可用且拒绝读取隐藏旧正文',async()=>{
  const m=modules();await assert.rejects(loadRuntime({__TAURITAVERN__:{ready:Promise.reject(Error('host failed'))}},m.load),/host failed/);
  assert.equal(m.paths.length,0);
  const runtime=await loadRuntime({__TAURITAVERN__:{ready:Promise.resolve()}},path=>path.includes('codemirror')?Promise.reject(Error('not found')):m.load(path));
  assert.equal(runtime.getEditor({}),null);
  assert.throws(()=>runtime.getEditor({nextElementSibling:{classList:{contains:()=>true}}}),/编辑器接口不可用/);
});
test('TT Agent API 存在但状态桥失效时不允许把生成期当成空闲',async()=>{
  const m=modules(),runtime=await loadRuntime({__TAURITAVERN__:{api:{agent:{}}}},path=>path.includes('agent-run')?Promise.reject(Error('not found')):m.load(path));
  assert.equal(runtime.isGenerating(),true);
});
