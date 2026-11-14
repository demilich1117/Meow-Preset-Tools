import {EventEmitter} from 'node:events';
export const clone = structuredClone;
export const preset = () => ({temperature:.7, prompts:[{identifier:'base',content:'作者原文',role:'system'}],
  prompt_order:[{character_id:100001,order:[{identifier:'base',enabled:true}]}],
  extensions:{miao_preset_library:{schema:1,publisher:'nue.miaomiao',protocol:1,presetId:'nue.sl.preset',capabilities:['prompt','regex','helper-script']},private:{keep:true}}});
export function fixture(initial = preset()) {
  const presets=[clone(initial),preset()], names={SL:0,Other:1}, disk={SL:clone(initial),Other:preset()};
  let selected='SL', onSave=()=>{}, lockHook=null;
  const storage=new Map(), locks=[], events=new EventEmitter();
  const eventTypes=Object.fromEntries(['OAI_PRESET_IMPORT_READY','OAI_PRESET_CHANGED_BEFORE','OAI_PRESET_CHANGED_AFTER','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x]));
  const ctx={mainApi:'openai',chatCompletionSettings:clone(initial),eventSource:events,eventTypes,extensionSettings:{},saveSettingsDebounced(){},getPresetManager:()=>manager};
  const manager={getSelectedPresetName:()=>selected,getCompletionPresetByName:n=>presets[names[n]],getAllPresets:()=>Object.keys(names),getPresetList:()=>({presets,preset_names:names}),
    async savePreset(n,p){await onSave(n,p);disk[n]=clone(p);},
    async selectPreset(index){const nextName=Object.keys(names).find(n=>names[n]===Number(index));events.emit(eventTypes.OAI_PRESET_CHANGED_BEFORE,{presetName:nextName,presetNameBefore:selected});selected=nextName;ctx.chatCompletionSettings=clone(presets[Number(index)]);events.emit(eventTypes.OAI_PRESET_CHANGED_AFTER);}};
  const win={SillyTavern:{getContext:()=>ctx},navigator:{locks:{async request(name,options,fn){locks.push(name);await lockHook?.();if(options.signal.aborted)throw Error('aborted');return fn();}}},
    document:{querySelector:()=>null,body:{dataset:{}}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}};
  return {win,ctx,presets,names,disk,locks,storage,events,manager,setSave(fn){onSave=fn;},setLock(fn){lockHook=fn;},switch:()=>manager.selectPreset('1')};
}
