import {createBackupStore} from './backups.mjs';
import {GROUPS_KEY, withPromptGroups} from './prompt-groups.mjs';
import {validatePreset} from './entries.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Preserve the handoff's preset projection, including unsaved edits in ST's
// settings object and extension fields that exist only in the saved preset.
const aliases = {
  temperature: 'temp_openai', frequency_penalty: 'freq_pen_openai', presence_penalty: 'pres_pen_openai',
  top_p: 'top_p_openai', top_k: 'top_k_openai', top_a: 'top_a_openai', min_p: 'min_p_openai',
  repetition_penalty: 'repetition_penalty_openai', seed: 'seed_openai', n: 'n_openai',
};

export function createHost(win, {isGenerating} = {}) {
  const backups = createBackupStore(win);
  const context = () => win.SillyTavern.getContext();
  const lifetime = new AbortController();
  const subscribers = new Set(), blocked = new Map(), listeners = [];
  let epoch = 0, identity, previousIdle, activation = null;

  function manager() {
    const manager = context().getPresetManager?.('openai');
    if (!manager?.getCompletionPresetByName) throw Error('宿主缺少聊天补全预设管理接口');
    return manager;
  }
  function idle() {
    return !lifetime.signal.aborted && context().mainApi === 'openai'
      && !isGenerating?.() && win.document.body.dataset.generating !== 'true';
  }
  function notify(reason) {
    for (const fn of subscribers) fn(reason);
  }
  function observe() {
    const ctx = context();
    const key = JSON.stringify([ctx.mainApi, ctx.getPresetManager?.('openai')?.getSelectedPresetName(),
      ctx.chatCompletionSettings?.extensions?.miao_preset_library]);
    if (identity !== key) {
      identity = key;
      epoch++;
      notify('selection');
    }
    const currentIdle = idle();
    if (previousIdle !== currentIdle) {
      previousIdle = currentIdle;
      notify('generation');
    }
  }
  function snapshot() {
    observe();
    const ctx = context(), m = manager(), name = m.getSelectedPresetName();
    const saved = m.getCompletionPresetByName(name), settings = ctx.chatCompletionSettings;
    if (ctx.mainApi !== 'openai' || !saved || !Array.isArray(settings?.prompts)) {
      throw Error('请先选择聊天补全预设');
    }
    const projection = {...saved};
    for (const key of new Set([...Object.keys(saved), 'prompts', 'prompt_order', 'extensions'])) {
      const setting = aliases[key] ?? key;
      if (Object.hasOwn(settings, setting)) projection[key] = settings[setting];
    }
    const active = structuredClone(projection);
    active.extensions ??= {};
    // This library trace is disk-owned in the original preset format.
    if (saved.extensions?.nue_sl_trace) active.extensions.nue_sl_trace = structuredClone(saved.extensions.nue_sl_trace);
    else delete active.extensions.nue_sl_trace;
    if (blocked.has(name) && equal(saved, blocked.get(name)) && equal(saved, active)) blocked.delete(name);
    return {name, saved: structuredClone(saved), active, epoch};
  }

  function readPreset(name) {
    if (name === manager().getSelectedPresetName()) return snapshot();
    const saved = manager().getCompletionPresetByName(name);
    if (!saved) throw Error('预设已删除或改名');
    return {name, saved: structuredClone(saved), active: structuredClone(saved), epoch: null};
  }

  async function writePreset(transform, {expected = snapshot(), signal} = {}) {
    const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    if (!win.navigator.locks) throw Error('当前环境缺少 Web Locks，无法保存预设');
    const mark = expected.active.extensions.miao_preset_library;
    const lock = typeof mark?.presetId === 'string' ? 'sl-update-' + mark.presetId : 'miao-prompt-groups-' + expected.name;
    function check() {
      combined.throwIfAborted();
      if (!idle()) throw Error('酒馆正在生成或已离开聊天补全，请稍后再保存');
      if (!equal(expected, readPreset(expected.name))) throw Error('写入前预设发生变化，请重新打开编辑器');
      if (blocked.has(expected.name)) throw Error('此前保存的预设尚未激活，请先导出草稿并重新选择预设');
    }
    return win.navigator.locks.request(lock, {signal: combined}, async () => {
      check();
      const {name, saved, active} = expected;
      const next = validatePreset(transform(structuredClone(active)));
      if (equal(next, active) && equal(active, saved)) return {deferred: false};
      await backups.add({time: new Date().toISOString(), name, preset: saved}, combined);
      check();
      const m = manager();
      await m.savePreset(name, next, {skipUpdate: true});

      function defer(warning) {
        blocked.set(name, next);
        notify('saved');
        return {deferred: true, warning};
      }
      const {presets, preset_names} = m.getPresetList();
      if (!Object.hasOwn(preset_names, name)) return defer('预设已保存，但目标已改名或删除，请刷新后检查');
      const index = preset_names[name];
      if (!equal(presets[index], saved) && !equal(presets[index], next)) {
        return defer('预设已保存，但宿主缓存同时变化，请导出草稿并刷新后检查');
      }
      let after;
      try { after = readPreset(name); } catch { /* The user may have switched APIs during the save. */ }
      presets[index] = structuredClone(next);
      if (combined.aborted || !idle() || !equal(after, expected)) {
        return defer('预设已保存，当前草稿或选择已变化，请重新选择目标预设后检查');
      }
      if (expected.epoch === null) {
        notify('saved');
        return {deferred: false};
      }
      const applying = {name, epoch: null};
      activation = applying;
      try {
        await m.selectPreset(String(index));
        const current = snapshot();
        if (current.name !== name || applying.epoch !== current.epoch || !idle()
          || !equal(current.active.prompts, next.prompts)
          || !equal(current.active.prompt_order, next.prompt_order)
          || !equal(current.active.extensions[GROUPS_KEY], next.extensions[GROUPS_KEY])) {
          return defer('预设已保存，请重新选择目标预设后检查');
        }
      } catch {
        return defer('预设已保存，重新应用预设失败，请重新选择预设后检查');
      } finally {
        activation = null;
      }
      notify('saved');
      return {deferred: false};
    });
  }

  const writePromptGroups = (value, options) => writePreset(p => withPromptGroups(p, value), options);

  const ctx = context(), types = ctx.eventTypes ?? ctx.event_types ?? {};
  function on(name, fn) {
    if (!types[name] || !ctx.eventSource) return;
    ctx.eventSource.on(types[name], fn);
    listeners.push([types[name], fn]);
  }
  on('OAI_PRESET_CHANGED_BEFORE', event => {
    epoch++;
    const own = activation && event?.presetName === activation.name && event?.presetNameBefore === activation.name;
    if (own) activation.epoch = epoch;
    activation = null;
    notify(own ? 'reapplied' : 'invalidated');
  });
  for (const name of ['OAI_PRESET_CHANGED_AFTER','MAIN_API_CHANGED','PRESET_RENAMED','PRESET_DELETED']) {
    on(name, () => { observe(); notify('selection'); });
  }
  for (const name of ['GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED']) on(name, () => notify('generation'));
  observe();
  const timer = setInterval(observe, 350);
  return {
    context, snapshot, idle, readPreset, writePreset, writePromptGroups, readBackups: backups.read,
    presetNames: () => manager().getAllPresets(),
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    dispose() {
      lifetime.abort();
      clearInterval(timer);
      for (const [name, fn] of listeners) ctx.eventSource.removeListener(name, fn);
      subscribers.clear();
    },
  };
}
