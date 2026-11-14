// Static suggestions only: never substitute macros or mutate chat variables here.
// Keep balanced nested macros intact; a dynamic variable name is not a literal dependency.
export function variableReferences(content=''){
  const stack=[],nodes=[];
  for(let i=0;i<content.length-1;i++){
    const pair=content.slice(i,i+2);
    if(pair==='{{'){stack.push({start:i,children:[]});i++;}
    else if(pair==='}}'&&stack.length){const node=stack.pop();node.end=i+2;(stack.at(-1)?.children??nodes).push(node);i++;}
  }
  const out=[];
  function visit(node,nested=false){
    const raw=content.slice(node.start,node.end),body=raw.slice(2,-2).trim();
    if(/^(?:\/\/|comment(?:\s|::|$))/i.test(body))return;
    const match=body.match(/^((?:set|get|add|inc|dec)(?:global)?var)(?:::|\s+)([\s\S]*)$/i);
    if(match){
      const command=match[1].toLowerCase(),arg=match[2],name=arg.split('::')[0].trim();
      const kind=command.startsWith('set')?'set':command.startsWith('get')?'get':'update';
      const separator=arg.indexOf('::');
      if(name&&!/[{}]/.test(name))out.push({command,name,scope:command.includes('global')?'global':'local',kind,
        emptySet:kind==='set'&&separator>=0&&!arg.slice(separator+2).trim(),nested,raw,start:node.start,end:node.end});
    }
    node.children.forEach(child=>visit(child,true));
  }
  nodes.forEach(node=>visit(node));return out.sort((a,b)=>a.start-b.start);
}

export function variableIndex(preset) {
  return preset.prompts.flatMap(prompt => variableReferences(prompt.content ?? '').map(ref => ({
    ...ref, identifier: prompt.identifier, sourceName: prompt.name || prompt.identifier,
  })));
}

export function relatedVariables(preset, content) {
  const selected = new Set(variableReferences(content).map(r => JSON.stringify([r.scope, r.name])));
  return variableIndex(preset).filter(r => selected.has(JSON.stringify([r.scope, r.name])));
}
