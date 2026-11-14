// Presentation metadata only. Never create prompts or rewrite prompt_order.
export const GROUPS_KEY = 'miao_prompt_groups';

export function validateGroups(value) {
  if (!value || value.schema !== 1 || !Array.isArray(value.groups)) throw Error('无法识别分组格式，请保留原文件并检查分组版本');
  if (value.groups.length > 200) throw Error('分组不能超过 200 个');
  const groupIds = new Set(), members = new Set();
  const groups = value.groups.map(group => {
    if (!group || typeof group.id !== 'string' || !/^[\w.-]{1,100}$/.test(group.id) || groupIds.has(group.id)) throw Error('分组 ID 无效或重复');
    if (typeof group.name !== 'string' || !group.name.trim() || group.name.trim().length > 100) throw Error('请填写 1–100 字的分组名称');
    if (typeof group.collapsed !== 'boolean' || !Array.isArray(group.identifiers) || group.identifiers.length > 10000) throw Error('分组条目或默认折叠设置无效');
    groupIds.add(group.id);
    for (const id of group.identifiers) {
      if (typeof id !== 'string' || !id || id.length > 300 || members.has(id)) throw Error('条目 ID 无效，或同一条目被分配到多个分组');
      members.add(id);
    }
    return {...structuredClone(group), name: group.name.trim()};
  });
  return {...structuredClone(value), groups};
}

export function readGroups(preset) {
  const raw = preset?.extensions?.[GROUPS_KEY];
  return raw === undefined ? {schema: 1, groups: []} : validateGroups(raw);
}

export function withPromptGroups(preset, value) {
  if (!Array.isArray(preset?.prompts) || !Array.isArray(preset?.prompt_order)) throw Error('请选择聊天补全预设');
  // Refuse to silently replace a future/invalid schema already in the preset.
  readGroups(preset);
  const next = structuredClone(preset);
  next.extensions ??= {};
  next.extensions[GROUPS_KEY] = validateGroups(value);
  return next;
}

// Adjacent runs, not buckets: A / ungrouped / A stays in precisely that order.
export function groupRuns(identifiers, groups) {
  const membership = new Map(groups.flatMap(group => group.identifiers.map(id => [id, group])));
  const runs = [];
  for (const identifier of identifiers) {
    const group = membership.get(identifier), last = runs.at(-1);
    if (last && last.group?.id === group?.id) last.identifiers.push(identifier);
    else runs.push({group, identifiers: [identifier]});
  }
  return runs;
}

// Read-only adapters for grouping formats found in existing local presets.
// Native memberships win; supplemental formats only fill unassigned entries.
// Never bucket/reorder prompts, or rewrite another extension's metadata.
export function displayGroups(preset, identifiers) {
  const groups = [], assigned = new Set(), known = new Set(identifiers);
  function add(group, id, members) {
    if (typeof group?.name !== 'string' || !group.name.trim()) return;
    const unique = [...new Set(members)].filter(member => known.has(member) && !assigned.has(member));
    if (!unique.length) return;
    unique.forEach(member => assigned.add(member));
    groups.push({id, name: group.name, collapsed: group.collapsed === true, identifiers: unique});
  }
  for (const group of readGroups(preset).groups) add(group, group.id, group.identifiers);
  const sections = preset.extensions?.fruitHeartSections;
  if (sections?.version === 1 && Array.isArray(sections.groups)) {
    sections.groups.forEach(group => {
      if (!group || typeof group.id !== 'string') return;
      add(group, 'fruit:' + group.id, identifiers.filter(id => sections.prompts?.[id]?.groupId === group.id));
    });
  }
  const ranges = preset.extensions?.entryGrouping;
  if (Array.isArray(ranges)) ranges.forEach((group, i) => {
    if (group?.mode !== 'inclusive') return;
    const start = identifiers.indexOf(group.startIdentifier), end = identifiers.indexOf(group.endIdentifier);
    if (start >= 0 && end >= start) add(group, 'range:' + (group.id ?? i), identifiers.slice(start, end + 1));
  });
  return groups;
}

export function groupPreferenceKey(snapshot) {
  const mark = snapshot.active.extensions?.miao_preset_library;
  return JSON.stringify([snapshot.name, mark?.publisher ?? '', mark?.presetId ?? '']);
}

export function groupPromptChoices(preset) {
  const prompts = new Map(preset.prompts.map(p => [p.identifier, p]));
  const order = preset.prompt_order.find(o => o.character_id === 100001)?.order ?? preset.prompt_order[0]?.order ?? [];
  const ids = [...new Set([...order.map(o => o?.identifier), ...prompts.keys()])];
  return ids.filter(id => prompts.has(id)).map(id => prompts.get(id));
}
