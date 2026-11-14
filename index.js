import {createHost} from './host.mjs';
import {createDraftController} from './draft.mjs';
import {enhanceList} from './list-ui.mjs';
import {enhanceEditor} from './editor.mjs';
import {element,button} from './dom.mjs';
import {loadRuntime} from './runtime.mjs';

// Internal host imports and TT capabilities are centralized in runtime.mjs.
let nativeModule,isGenerating,runtime,runtimeError,host,root,list,editor,watcher,retry,enabled=true;
try { runtime=await loadRuntime(window);nativeModule=runtime.native;isGenerating=runtime.isGenerating; }
catch(error) { runtimeError=error.message; }
const getManager=()=>nativeModule?.promptManager;
function editorOpen(){const popup=document.querySelector('#completion_prompt_manager_popup');return !!popup?.classList.contains('openDrawer');}
async function download(value,name){
  if(!runtime)throw Error(runtimeError??'宿主导出接口尚未就绪');
  await runtime.download(JSON.stringify(value,null,2)+'\n',name.replace(/[<>:"/\\|?*]/g,'_')+'.json','application/json',{throwOnFailure:true});
}
function mount(){
  if(!enabled||root)return;
  const target=document.querySelector('#extensions_settings2')??document.querySelector('#extensions_settings');
  if(!target||!window.SillyTavern?.getContext?.()?.eventSource){retry=setTimeout(mount,500);return;}
  host=createHost(window,{isGenerating});
  const drafts=createDraftController(host,getManager,{editorOpen});
  root=element(document,'details','mpt-extension');root.append(element(document,'summary','','喵喵预设整理'));
  const status=element(document,'p','mpt-notice'),actions=element(document,'div','mpt-inline');status.setAttribute('role','status');
  const groups=button(document,'管理分组',()=>list?.openGroups());
  const exportButton=button(document,'导出当前预设',async()=>{try{const s=host.snapshot();await download(s.active,s.name);}catch(e){status.textContent=e.message;}});
  actions.append(groups,exportButton);
  const backups=element(document,'details',''),backupList=element(document,'div','mpt-backups');
  backups.append(element(document,'summary','','保存前的备份'),backupList);
  backups.addEventListener('toggle',async()=>{
    if(!backups.open)return;
    try{
      const values=await host.readBackups();backupList.replaceChildren();
      for(const value of values)backupList.append(button(document,value.name+' · '+new Date(value.time).toLocaleString(),async()=>{try{await download(value.preset,value.name+'-备份');}catch(e){status.textContent=e.message;}}));
      if(!values.length)backupList.textContent='保存到预设后，可在这里下载修改前的文件。';
    }catch(e){backupList.textContent=e.message;}
  });
  root.append(element(document,'p','mpt-help','增强原生预设列表：分组、搜索、移动、复制与撤销。'),actions,status,backups);target.append(root);
  let previous;
  function ownership(){
    const conflict=!!document.querySelector('.miao-pg-extension,.miao-workshop'),available=!!getManager();
    const key=conflict+':'+available;if(previous===key)return;previous=key;
    list?.dispose();editor?.dispose();list=editor=null;
    groups.disabled=conflict||!available;
    status.textContent=conflict?'工作台或旧脚本库正在管理原生列表。使用本扩展时，请先停用旧版并刷新。'
      :!available?'当前宿主预设接口不可用：'+(runtimeError??'请等待酒馆加载完成'):'在原生预设列表上方使用整理工具；宏自动提示默认关闭。';
    if(!conflict&&available){list=enhanceList(window,host,drafts,getManager);editor=enhanceEditor(window,host,getManager,drafts,list.notice,runtime.getEditor);}
  }
  watcher=setInterval(ownership,500);ownership();
}
export function onEnable(){enabled=true;clearTimeout(retry);mount();}
export function onDisable(){enabled=false;clearTimeout(retry);clearInterval(watcher);list?.dispose();editor?.dispose();host?.dispose();root?.remove();list=editor=host=root=null;}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
