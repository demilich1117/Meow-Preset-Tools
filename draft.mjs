import {equal} from './host.mjs';
import {promptFields, applyFields} from './operations.mjs';
import {validatePreset} from './entries.mjs';

export function createDraftController(host, getManager, {editorOpen = () => false} = {}) {
  const history = [];
  let busy = false;
  function snapshot() {
    const result = host.snapshot(), manager = getManager();
    const orderId = manager?.activeCharacter?.id;
    if (orderId === undefined || !manager?.render || manager.serviceSettings !== host.context().chatCompletionSettings) {
      throw Error('原生预设列表尚未就绪');
    }
    return {...result, orderId};
  }
  const identity = s => [s.name, s.epoch, s.orderId];
  const matches = (a, b) => equal(identity(a), identity(b)) && equal(promptFields(a.active), promptFields(b.active));
  function assertWritable(expected) {
    if (busy || !host.idle()) throw Error('正在保存或生成，请稍后再整理');
    if (editorOpen()) throw Error('请先保存或关闭原生条目编辑框，再整理列表');
    const current = snapshot();
    if (!matches(expected, current)) throw Error('预设或条目已变化，请重新打开操作');
    return current;
  }
  function refresh() { host.context().saveSettingsDebounced(); getManager().render(false); }
  function apply(transform, label, expected = snapshot()) {
    const current = assertWritable(expected);
    const next = validatePreset(transform(structuredClone(current.active), current.orderId));
    const before = promptFields(current.active), after = promptFields(next);
    if (equal(before, after)) return false;
    if (history.length && !matches(history.at(-1).after, current)) history.length = 0;
    applyFields(host.context().chatCompletionSettings, after);
    history.push({before, after:snapshot(), label});
    if (history.length > 20) history.shift();
    refresh(); return true;
  }
  function undoLabel(current) {
    try { return history.length && matches(history.at(-1).after, current ?? snapshot()) ? history.at(-1).label : ''; }
    catch { return ''; }
  }
  function recordNative(before,label) {
    const after=snapshot();
    if(!equal(identity(before),identity(after))||equal(promptFields(before.active),promptFields(after.active)))return false;
    if(history.length&&!matches(history.at(-1).after,before))history.length=0;
    history.push({before:promptFields(before.active),after,label});if(history.length>20)history.shift();return true;
  }
  function undo() {
    if (!undoLabel()) throw Error('条目已有其他修改，不能覆盖新内容；请使用备份或原生编辑');
    const step = history.at(-1); assertWritable(step.after);
    applyFields(host.context().chatCompletionSettings, step.before); history.pop(); refresh();
    return step.label;
  }
  async function save() {
    const current = snapshot(); assertWritable(current); busy = true;
    try {
      const {orderId, ...expected} = current;
      const result = await host.writePreset(p => p, {expected});
      history.length = 0;
      return result;
    } finally { busy = false; }
  }
  function dirty(current) {
    try {const s=current??snapshot();return !equal(promptFields(s.active),promptFields(s.saved));}catch{return false;}
  }
  // UI-only refreshes reuse this state. Mutations still take a fresh snapshot
  // and assertWritable always checks the live preset before changing it.
  const viewState = current => ({undoLabel:undoLabel(current),dirty:dirty(current)});
  return {snapshot, apply, undo, undoLabel, save, dirty, viewState, recordNative, get busy(){return busy;}};
}
