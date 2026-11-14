import {orderedEntries} from './entries.mjs';
import {variableReferences} from './variables.mjs';

export const variableKey = ref => JSON.stringify([ref.scope, ref.name]);
export const variableLabel = ref => (ref.scope === 'global' ? '全局 · ' : '聊天 · ') + ref.name;
export const ANALYSIS_NOTE = '静态检查仅覆盖本预设的固定变量名；聊天已有值、世界书、脚本、条件与动态宏需运行验证。不会执行宏或修改聊天变量。';

export function presetReferences(preset, orderId) {
  return orderedEntries(preset, orderId).flatMap(({prompt, order}, index) =>
    variableReferences(prompt.content ?? '').map(ref => ({...ref, identifier: prompt.identifier,
      sourceName: prompt.name || prompt.identifier, index, enabled: order?.enabled === true,
      conditional: !!prompt.injection_trigger?.length, triggers: prompt.injection_trigger ?? [],
      // Lower warning severity only for an unambiguous, top-level sequence.
      // Block control flow and scripting cannot be proven by this scanner.
      uncertainFlow: ref.nested || /\{\{\s*[#!?~>]*\s*(?:if\b|else\b|\/)|<%|\{%/i.test(prompt.content ?? '')})));
}

const uniqueEntries = refs => [...new Map(refs.map(ref => [ref.identifier, ref])).values()];
const before = (write, read) => write.index < read.index || (write.index === read.index && write.end <= read.start);

function initializationChain(writes, reads) {
  if (writes.length < 2 || writes.some(ref => ref.kind !== 'set' || ref.conditional || ref.uncertainFlow)) return false;
  const last = writes.at(-1), resets = writes.slice(0, -1);
  return !last.emptySet && resets.every(ref => ref.emptySet && ref.index < last.index)
    && reads.every(read => before(last, read));
}

// PromptManager.getPromptCollection substitutes enabled prompts in prompt_order,
// before their relative/depth placement. Within one entry either macro engine
// may be active; do not pretend lexical order is a universal execution trace.
export function diagnosePreset(preset, orderId) {
  const refs = presetReferences(preset, orderId), byKey = new Map(), issues = [], notes = [];
  for (const ref of refs) {
    const key = variableKey(ref);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(ref);
  }
  for (const [key, matches] of byKey) {
    const writes = matches.filter(r => r.kind !== 'get'), reads = matches.filter(r => r.kind !== 'set');
    const activeWrites = writes.filter(r => r.enabled);
    for (const read of reads.filter(r => r.enabled)) {
      const definitions = writes.filter(r => r !== read);
      const enabled = definitions.filter(r => r.enabled);
      let code, message;
      if (!definitions.length) { code = 'missing'; message = '本预设未找到定义；可能依赖聊天、世界书或脚本'; }
      else if (!enabled.length) { code = 'disabled'; message = '定义条目未启用或不在当前顺序中'; }
      else if (enabled.every(r => r.index > read.index)) { code = 'later'; message = '定义条目排在引用之后，可能读取旧值'; }
      else if (enabled.filter(r => r.index <= read.index).every(r => r.conditional)) { code = 'conditional'; message = '前置定义受生成类型限制，请核对触发条件'; }
      else if (enabled.some(r => r.identifier === read.identifier && r.end > read.start)) { code = 'within-entry'; message = '同一正文中先读后写或在赋值内读取，请核对宏引擎和嵌套顺序'; }
      if (code) issues.push({code, message, key, ref: read, definitions});
    }
    const setters = activeWrites.filter(r => r.kind === 'set');
    if (setters.length > 1) {
      if (initializationChain(activeWrites, reads.filter(ref => ref.enabled))) {
        notes.push({code: 'initialization', key, ref: setters[0], definitions: setters,
          message: '先置空初始化，再由后续条目赋值；按当前列表识别为初始化链'});
      } else {
        const clearsValue = setters.some((ref, index) => ref.emptySet && setters.slice(0, index).some(prior => !prior.emptySet));
        issues.push({code: clearsValue ? 'reset-after-write' : 'multiple', key, ref: setters[0], definitions: setters,
          message: clearsValue ? '后续空值写入可能清掉前面的内容，请核对顺序' : `${setters.length} 处启用的定义；后续写入可能覆盖前值`});
      }
    }
  }
  return {refs, issues, notes};
}

export function dependencyReport(source, destination, identifiers, sourceOrder, targetOrder) {
  const chosen = new Set(identifiers), sourceRefs = presetReferences(source, sourceOrder);
  const incoming = sourceRefs.filter(r => chosen.has(r.identifier));
  const targetRefs = presetReferences(destination, targetOrder), variables = new Map();
  for (const ref of incoming) {
    const key = variableKey(ref);
    if (variables.has(key)) continue;
    const imported = incoming.filter(r => variableKey(r) === key);
    const reads = imported.filter(r => r.kind !== 'set');
    const incomingWrites = imported.filter(r => r.kind !== 'get');
    const writes = imported.filter(r => r.kind !== 'get' && r.enabled);
    const targetWrites = targetRefs.filter(r => variableKey(r) === key && r.kind !== 'get');
    const candidates = sourceRefs.filter(r => variableKey(r) === key && r.kind !== 'get' && !chosen.has(r.identifier));
    const unique = uniqueEntries(candidates);
    const incomingReaders = uniqueEntries(imported.filter(r => r.kind === 'get'));
    const targetReaders = uniqueEntries(targetRefs.filter(r => variableKey(r) === key && r.kind === 'get'));
    const sourceReaders = uniqueEntries(sourceRefs.filter(r => variableKey(r) === key && r.kind === 'get' && !chosen.has(r.identifier)))
      .map(reader => ({...reader, otherReads: [...new Map(sourceRefs
        .filter(r => r.identifier === reader.identifier && r.kind !== 'set' && variableKey(r) !== key)
        .map(r => [variableKey(r), {name: r.name, scope: r.scope}])).values()]}));
    const needsReader = incomingWrites.length > 0 && ![...incomingReaders, ...targetReaders].some(r => r.enabled);
    const missing = reads.length > 0 && !writes.length && !targetWrites.some(r => r.enabled);
    const conflict = writes.length > 0 && targetWrites.some(r => r.enabled);
    variables.set(key, {key, ref, reads, writes, incomingWrites, targetWrites, candidates: unique, missing, conflict,
      incomingReaders, targetReaders, sourceReaders, needsReader});
  }
  return {variables: [...variables.values()], disabled: orderedEntries(source, sourceOrder)
    .filter(e => chosen.has(e.prompt.identifier) && !e.order?.enabled).map(e => e.prompt)};
}

// Existing definitions can mask this problem in the general preset check:
// a target getter may still read its old value before the newly copied writer.
export function transferReadWarnings(preset, importedIds, orderId) {
  const imported = new Set(importedIds), refs = presetReferences(preset, orderId), issues = [];
  const writes = refs.filter(ref => imported.has(ref.identifier) && ref.enabled && ref.kind !== 'get');
  const seen = new Set();
  for (const read of refs.filter(ref => !imported.has(ref.identifier) && ref.enabled && ref.kind === 'get')) {
    const key = variableKey(read), definitions = writes.filter(ref => variableKey(ref) === key);
    const identity = JSON.stringify([key, read.identifier]);
    if (!definitions.length || definitions.some(write => before(write, read)) || seen.has(identity)) continue;
    seen.add(identity);
    issues.push({code: 'reader-before-transfer', key, ref: read, definitions,
      message: '目标在新增写入之前读取这个变量，可能仍使用旧值；请调整插入位置'});
  }
  return issues;
}

// Only unambiguous, enabled, unconditional providers are suggested. Re-run to
// close transitive dependencies. Sets bound cycles; all selections stay reviewable.
export function suggestDependencies(source, destination, identifiers, sourceOrder, targetOrder) {
  const selected = new Set(identifiers), original = new Set(identifiers);
  for (let i = 0; i < source.prompts.length; i++) {
    let added = false;
    for (const variable of dependencyReport(source, destination, [...selected], sourceOrder, targetOrder).variables) {
      const candidates = variable.candidates.filter(r => r.enabled && !r.conditional);
      if (variable.missing && candidates.length === 1 && !selected.has(candidates[0].identifier)) {
        selected.add(candidates[0].identifier); added = true;
      }
    }
    if (!added) break;
  }
  return [...selected].filter(id => !original.has(id));
}

export function injectionLabel(prompt, state) {
  if (!state) return '未加入当前顺序';
  if (!state.enabled) return '已停用';
  if (prompt.injection_position === 1) return `聊天深度 ${prompt.injection_depth ?? 4} · 优先级 ${prompt.injection_order ?? 100}`;
  return prompt.marker ? '动态内容占位' : '按列表顺序';
}

export function injectionLayout(preset, orderId) {
  const entries = orderedEntries(preset, orderId).filter(e => e.order?.enabled);
  const relative = entries.filter(e => e.prompt.injection_position !== 1);
  const depth = entries.filter(e => e.prompt.injection_position === 1);
  const ranks = {assistant: 0, user: 1, system: 2};
  // populationInjectionPrompts reverses the assembled message array: larger
  // depths earlier; same-depth priorities ascending, then assistant/user/system.
  depth.sort((a, b) => (b.prompt.injection_depth ?? 4) - (a.prompt.injection_depth ?? 4)
    || (a.prompt.injection_order ?? 100) - (b.prompt.injection_order ?? 100)
    || (ranks[a.prompt.role ?? 'system'] ?? 2) - (ranks[b.prompt.role ?? 'system'] ?? 2));
  return {relative, depth, hasHistory: relative.some(e => e.prompt.identifier === 'chatHistory')};
}
