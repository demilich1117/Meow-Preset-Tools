import {readGroups, displayGroups, validateGroups, GROUPS_KEY} from './prompt-groups.mjs';

export function orderFor(preset, characterId) {
  const order = characterId === undefined
    ? preset.prompt_order.find(o => o.character_id === 100001) ?? preset.prompt_order[0]
    : preset.prompt_order.find(o => o.character_id === characterId);
  if (!order) throw Error('预设缺少所选提示词顺序');
  return order;
}

export function orderedEntries(preset, characterId) {
  const order = orderFor(preset, characterId).order;
  const prompts = new Map(preset.prompts.map(p => [p.identifier, p]));
  return [...new Set([...order.map(o => o.identifier), ...prompts.keys()])]
    .filter(id => prompts.has(id)).map(id => ({
      prompt: prompts.get(id), order: order.find(o => o.identifier === id),
    }));
}

export function validatePreset(preset) {
  if (!Array.isArray(preset?.prompts) || !Array.isArray(preset?.prompt_order)) throw Error('请选择聊天补全预设');
  const ids = new Set();
  for (const prompt of preset.prompts) {
    if (!prompt || typeof prompt.identifier !== 'string' || !prompt.identifier || ids.has(prompt.identifier)) {
      throw Error('条目标识缺失或重复');
    }
    ids.add(prompt.identifier);
  }
  for (const row of preset.prompt_order) {
    if (!Array.isArray(row.order)) throw Error('提示词顺序格式无效');
    const members = new Set();
    for (const item of row.order) {
      if (typeof item.identifier !== 'string' || members.has(item.identifier)) throw Error('顺序中含重复或无效条目');
      members.add(item.identifier);
    }
  }
  return preset;
}

export function removeEntries(preset, identifiers) {
  const ids = new Set(identifiers);
  const next = structuredClone(preset);
  if (next.prompts.some(p => ids.has(p.identifier) && (p.marker || p.system_prompt))) {
    throw Error('酒馆内置条目可编辑和排序，移动或删除请使用自定义条目');
  }
  next.prompts = next.prompts.filter(p => !ids.has(p.identifier));
  for (const row of next.prompt_order) row.order = row.order.filter(p => !ids.has(p.identifier));
  if (next.extensions?.[GROUPS_KEY]) {
    const config = readGroups(next);
    for (const group of config.groups) group.identifiers = group.identifiers.filter(id => !ids.has(id));
    next.extensions[GROUPS_KEY] = validateGroups(config);
  }
  return next;
}

export function copyEntries(source, destination, identifiers, {sourceOrder, targetOrder, beforeId, idFactory = () => crypto.randomUUID()} = {}) {
  const requested = new Set(identifiers);
  const entries = orderedEntries(source, sourceOrder).filter(({prompt}) => requested.has(prompt.identifier));
  if (!entries.length) throw Error('请先勾选要复制的条目');
  if (entries.some(({prompt}) => prompt.marker)) throw Error('动态占位条目由酒馆提供，请选择有正文的条目');
  const next = structuredClone(destination), newIds = [];
  const order = orderFor(next, targetOrder).order;
  const used = new Set([...next.prompts.map(p => p.identifier), ...next.prompt_order.flatMap(row => row.order.map(p => p.identifier))]);
  const mapping = new Map();
  for (const {prompt, order: sourceState} of entries) {
    const id = idFactory();
    if (!id || used.has(id)) throw Error('无法分配独立条目标识，请重试');
    used.add(id);
    mapping.set(prompt.identifier, id);
    newIds.push(id);
    next.prompts.push({...structuredClone(prompt), identifier: id, system_prompt: false});
    order.push({...structuredClone(sourceState ?? {}), identifier: id, enabled: sourceState?.enabled ?? false});
  }
  if (beforeId !== undefined) {
    const insertAt = order.findIndex(entry => entry.identifier === beforeId);
    if (insertAt < 0) throw Error('目标落点已不存在，请重新选择');
    const appended = order.splice(order.length - newIds.length);
    order.splice(insertAt, 0, ...appended);
  }
  const groups = displayGroups(source, orderedEntries(source, sourceOrder).map(e => e.prompt.identifier));
  if (groups.some(g => g.identifiers.some(id => requested.has(id)))) {
    const config = readGroups(next);
    for (const group of groups) {
      const members = group.identifiers.filter(id => mapping.has(id)).map(id => mapping.get(id));
      if (!members.length) continue;
      let existing = config.groups.find(g => g.name === group.name);
      if (!existing) {
        existing = {...structuredClone(group), id: idFactory(), identifiers: []};
        if (config.groups.some(g => g.id === existing.id)) throw Error('分组标识冲突，请重试');
        config.groups.push(existing);
      }
      existing.identifiers.push(...members);
    }
    next.extensions ??= {};
    next.extensions[GROUPS_KEY] = validateGroups(config);
  }
  return {preset: validatePreset(next), identifiers: newIds};
}

export function reorderEntry(preset, identifier, beforeId, characterId) {
  const next = structuredClone(preset), order = orderFor(next, characterId).order;
  const from = order.findIndex(o => o.identifier === identifier);
  if (from < 0 || identifier === beforeId) return next;
  const [entry] = order.splice(from, 1);
  const to = order.findIndex(o => o.identifier === beforeId);
  order.splice(to < 0 ? order.length : to, 0, entry);
  return next;
}

// The first save phase retains every entry being removed. Only after all
// destinations are durable can the second phase remove the originals.
export function retainRemovedEntries(desired, before) {
  const next = structuredClone(desired);
  const ids = new Set(next.prompts.map(p => p.identifier));
  const removed = before.prompts.filter(p => !ids.has(p.identifier));
  next.prompts.push(...structuredClone(removed));
  const removedIds = new Set(removed.map(p => p.identifier));
  for (const oldOrder of before.prompt_order) {
    const entries = oldOrder.order.filter(p => removedIds.has(p.identifier));
    if (!entries.length) continue;
    let target = next.prompt_order.find(o => o.character_id === oldOrder.character_id);
    if (!target) {
      target = {...structuredClone(oldOrder), order: []};
      next.prompt_order.push(target);
    }
    const existing = new Set(target.order.map(p => p.identifier));
    target.order.push(...structuredClone(entries.filter(p => !existing.has(p.identifier))));
  }
  return next;
}
