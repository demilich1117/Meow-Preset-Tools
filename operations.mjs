import {orderFor, copyEntries, validatePreset} from './entries.mjs';
import {GROUPS_KEY} from './prompt-groups.mjs';

// Native-list operations only. Removing a row detaches it from this order;
// the prompt body and all other character orders remain available to ST.
function selectedRows(preset, identifiers, orderId) {
  const ids = new Set(identifiers), order = orderFor(preset, orderId).order;
  const rows = order.filter(row => ids.has(row.identifier));
  if (!ids.size || rows.length !== ids.size || rows.some(row => !preset.prompts.some(p => p.identifier === row.identifier))) {
    throw Error('所选条目已变化，请重新选择');
  }
  return rows;
}

export function moveRows(preset, identifiers, {orderId, targetId, side = 'before', edge} = {}) {
  const rows = selectedRows(preset, identifiers, orderId), ids = new Set(identifiers);
  if (!edge && ids.has(targetId)) throw Error('请选择所选条目以外的位置');
  const next = structuredClone(preset), order = orderFor(next, orderId);
  const rest = order.order.filter(row => !ids.has(row.identifier));
  let index = edge === 'start' ? 0 : edge === 'end' ? rest.length : rest.findIndex(row => row.identifier === targetId);
  if (index < 0) throw Error('目标位置已变化，请重新选择');
  if (!edge && side === 'after') index++;
  rest.splice(index, 0, ...structuredClone(rows));
  order.order = rest;
  return validatePreset(next);
}

export function duplicateRows(preset, identifiers, orderId, idFactory) {
  const rows = selectedRows(preset, identifiers, orderId), order = orderFor(preset, orderId).order;
  const last = order.findIndex(row => row.identifier === rows.at(-1).identifier);
  const result = copyEntries(preset, preset, identifiers, {sourceOrder:orderId, targetOrder:orderId,
    beforeId:order[last + 1]?.identifier, ...(idFactory ? {idFactory} : {})});
  const copies = new Set(result.identifiers);
  for (const prompt of result.preset.prompts.filter(p => copies.has(p.identifier))) prompt.name = (prompt.name || '未命名条目') + '（副本）';
  for (const row of orderFor(result.preset, orderId).order) if (copies.has(row.identifier)) row.enabled = false;
  return result;
}

export function detachRows(preset, identifiers, orderId) {
  selectedRows(preset, identifiers, orderId);
  const ids = new Set(identifiers);
  if (preset.prompts.some(p => ids.has(p.identifier) && (p.system_prompt !== false || p.marker))) {
    throw Error('内置条目保留在列表中；可使用原生启用开关');
  }
  const next = structuredClone(preset);
  const order = orderFor(next, orderId);
  order.order = order.order.filter(row => !ids.has(row.identifier));
  return next;
}

export function insertRow(preset, prompt, {orderId, enabled = false, ...position} = {}) {
  if(!prompt?.identifier||preset.prompts.some(p=>p.identifier===prompt.identifier))throw Error('新条目标识冲突，请重新新建');
  const next=structuredClone(preset);
  next.prompts.push({...structuredClone(prompt),system_prompt:false,marker:false});
  orderFor(next,orderId).order.push({identifier:prompt.identifier,enabled});
  return moveRows(next,[prompt.identifier],{orderId,...position});
}

export function promptFields(preset) {
  return structuredClone({prompts:preset.prompts, prompt_order:preset.prompt_order, groups:preset.extensions?.[GROUPS_KEY]});
}

export function applyFields(settings, fields) {
  settings.prompts = structuredClone(fields.prompts);
  settings.prompt_order = structuredClone(fields.prompt_order);
  settings.extensions ??= {};
  if (fields.groups === undefined) delete settings.extensions[GROUPS_KEY];
  else settings.extensions[GROUPS_KEY] = structuredClone(fields.groups);
}
