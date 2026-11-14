import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {projectTt,checkTtEditor} from './tt-projection.mjs';

// Real ST loader and PromptManager; all writes remain in this browser context.
const {chromium}=createRequire(import.meta.url)(process.argv[2]??'playwright');
const base=new URL(process.argv[3]??'http://127.0.0.1:8000').origin;
const tt=process.argv.includes('--tt');
const root=fileURLToPath(new URL('..',import.meta.url)),output=resolve(root,'output/playwright'+(tt?'/tt':''));await mkdir(output,{recursive:true});
const performanceCheck=process.argv.includes('--performance'),baseline=process.argv.includes('--baseline');
const sourceRoot=baseline?resolve(root,'output/before-polish'):root;
const extension='third-party/Meow-Preset-Tools',prefix='/scripts/extensions/'+extension+'/';
const files=new Set((await readdir(root)).filter(f=>/\.(mjs|js|css)$/.test(f)||f==='manifest.json'));
const name='原生整理验收';
function fixture(){
  const rows=[['intro','基础规则','保持角色与场景连贯。'],['clock','时间定义','{{setvar::时间::黎明}}'],['output','时间输出','{{getvar::时间}}'],
    ...Array.from({length:performanceCheck?300:35},(_,i)=>['extra-'+i,'叙事指导 '+String(i+1).padStart(2,'0'),'以可感知的动作推进情节。'.repeat(performanceCheck?150:1)]),
    ['ending','最后的写作提醒','给下一轮留下自然的行动空间。']];
  return {prompts:rows.map(([identifier,name,content])=>({identifier,name,content,role:'system',system_prompt:false,marker:false,injection_position:0,injection_depth:4,injection_order:100,custom:{keep:true}})),
    prompt_order:[{character_id:100001,order:rows.map(([identifier])=>({identifier,enabled:identifier!=='extra-1'}))}],
    extensions:{miao_prompt_groups:{schema:1,groups:[{id:'time',name:'时间与状态',collapsed:true,identifiers:['clock','output']}]},private:{keep:true}}};
}
const browser=await chromium.launch({headless:true,channel:'chrome'});
const measurements=[];
try{
  for(const mobile of process.argv.includes('--mobile-only')?[true]:[false,true]){
    let preset=fixture(),settings,saves=0;const errors=[];
    const page=await browser.newPage({viewport:{width:mobile?390:1480,height:mobile?844:1100},hasTouch:mobile});
    page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
    if(tt)page.on('console',message=>{if(message.type()==='error')console.error('TT projection:',message.text());});
    await page.route('**/*',async route=>{
      const {origin,pathname}=new URL(route.request().url());if(origin!==base)return route.abort();
      if(tt&&await projectTt(route,pathname,root))return;
      if(pathname.startsWith(prefix)){
        const file=pathname.slice(prefix.length);if(!files.has(file))return route.fulfill({status:404});
        let body=await readFile(resolve(sourceRoot,file),'utf8');
        // Instrument the served test copy only; no production telemetry/hooks.
        if(performanceCheck&&file==='host.mjs')body=body.replace('function snapshot() {','function snapshot() { globalThis.__mptPerf.reads++;');
        if(performanceCheck&&file==='list-ui.mjs')body=body.replace('function render(){','function render(){ globalThis.__mptPerf.views++;');
        return route.fulfill({body,contentType:extname(file)==='.css'?'text/css':file==='manifest.json'?'application/json':'text/javascript'});
      }
      if(pathname==='/api/extensions/discover')return route.fulfill({json:[{type:'local',name:extension}]});
      if(pathname==='/api/settings/get'){
        const response=await route.fetch(),data=await response.json();settings??=JSON.parse(data.settings);
        settings.main_api='openai';settings.active_character=settings.active_group=null;settings.power_user.auto_connect=false;settings.extension_settings.disabledExtensions=[];
        settings.power_user.movingUI=false;settings.power_user.movingUIState={};
        // The installed UI dock normally supplies its own drawer layout. With
        // other extensions isolated, 100% chat width collapses ST's sidebars.
        settings.power_user.chat_width=50;
        settings.oai_settings={...settings.oai_settings,...preset,preset_settings_openai:name};
        return route.fulfill({json:{...data,settings:JSON.stringify(settings),openai_setting_names:[name],openai_settings:[JSON.stringify(preset)],enable_extensions_auto_update:false}});
      }
      if(pathname==='/api/settings/save'){settings=route.request().postDataJSON();return route.fulfill({json:{result:'ok'}});}
      if(pathname==='/api/presets/save'){const data=route.request().postDataJSON();assert.equal(data.name,name);preset=data.preset;saves++;return route.fulfill({json:{name}});}
      if(pathname.startsWith('/api/')&&/\/(save|delete|create|rename|edit|upload|move|import|restore|clear|generate|set|connect|update|install|switch|clone|write|purge|reset|add|remove)(\/|$)/.test(pathname))return route.fulfill({status:403,json:{error:'Isolated browser check'}});
      return route.continue();
    });
    if(performanceCheck)await page.addInitScript(()=>{globalThis.__mptPerf={reads:0,views:0,nativeRenders:0};});
    if(tt)await page.addInitScript(()=>{window.__TAURITAVERN__={abiVersion:2,ready:Promise.resolve(),api:{}};});
    await page.goto(base,{waitUntil:'domcontentloaded'});
    // TT defers list construction until its settings drawer becomes visible.
    if(tt){await page.locator('.mpt-extension').waitFor({state:'attached'});if(!await page.locator('#left-nav-panel').isVisible())await page.locator('#leftNavDrawerIcon').click();}
    await page.locator('.mpt-native-bar').waitFor({state:'attached'});
    if(!await page.locator('#left-nav-panel').isVisible())await page.locator('#leftNavDrawerIcon').click();
    const bar=page.locator('.mpt-native-bar'),list=page.locator('#completion_prompt_manager_list');
    const alignList=()=>bar.evaluate(n=>{const position=n.style.position;n.style.position='static';n.scrollIntoView({block:'start'});n.style.position=position;});
    await bar.scrollIntoViewIfNeeded();
    if(performanceCheck){
      await page.evaluate(async()=>{
        const {promptManager}=await import('/scripts/openai.js');const render=promptManager.render;
        promptManager.render=function(...args){__mptPerf.nativeRenders++;return render.apply(this,args);};
      });
      const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const reset=()=>page.evaluate(()=>{__mptPerf={reads:0,views:0,nativeRenders:0};});
      const read=()=>page.evaluate(()=>({...__mptPerf}));
      await page.waitForTimeout(1200);await reset();await page.waitForTimeout(2000);
      const idle=await read();
      await reset();
      const heading=await list.locator('.mpt-group-toggle').elementHandle();
      await list.locator('.mpt-group-toggle').click();await settle();
      await bar.getByRole('button',{name:'多选',exact:true}).click();await settle();
      await list.getByRole('checkbox',{name:'选择：基础规则',exact:true}).check();await settle();
      await list.getByRole('checkbox',{name:'选择：时间定义',exact:true}).check();await settle();
      const selection=await read(),headingRetained=await heading.evaluate(n=>n.isConnected);
      await reset();
      for(const q of ['叙','叙事','不存在的条目','时间','']){await bar.getByLabel('搜索原生预设条目').fill(q);await settle();}
      const search=await read();
      await bar.getByRole('button',{name:'结束多选',exact:true}).click();await settle();
      await list.getByRole('button',{name:'移动：基础规则',exact:true}).click();await settle();
      await reset();
      const sideHandle=await bar.getByLabel('就地插入前后位置').elementHandle();
      await list.getByRole('button',{name:'选为落点：时间定义',exact:true}).click();await settle();
      await bar.getByLabel('就地插入前后位置').selectOption('after');await settle();
      const placement=await read(),sideRetained=await sideHandle.evaluate(n=>n.isConnected);
      await reset();await bar.getByRole('button',{name:'放在这里',exact:true}).click();
      await page.waitForFunction(()=>SillyTavern.getContext().chatCompletionSettings.prompt_order[0].order[1].identifier==='intro');await page.waitForTimeout(500);
      const move=await read();
      let dragging,drop,grouping,groupApply;
      if(!baseline){
        if(!mobile){
          const handle=list.getByRole('button',{name:'移动：基础规则',exact:true});await handle.hover();
          const grip=await handle.boundingBox(),target=await list.locator('[data-pm-identifier=extra-0]').boundingBox();
          await reset();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.waitForTimeout(80);
          await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2+16,{steps:4});
          await page.mouse.move(target.x+24,target.y+target.height-4,{steps:24});await page.waitForTimeout(600);
          dragging=await read();assert.equal(dragging.reads,1,'drag only captures its starting snapshot');assert.equal(dragging.nativeRenders,0);
          await page.mouse.up();await page.waitForTimeout(500);drop=await read();assert.equal(drop.nativeRenders,0,'native drop saves its order without an extra full native render');
        }
        await bar.getByRole('button',{name:'分组',exact:true}).click();
        const group=page.getByRole('dialog',{name:'预设分组',exact:true});await reset();
        await group.getByRole('checkbox',{name:'选择：基础规则',exact:true}).check();
        await group.getByRole('checkbox',{name:'选择：时间定义',exact:true}).check();
        await group.getByLabel('新分组名称',{exact:true}).fill('性能验证组');await group.getByRole('button',{name:'新建分组',exact:true}).click();
        grouping=await read();assert.equal(grouping.reads,0);assert.equal(grouping.nativeRenders,0);
        await reset();await group.getByRole('button',{name:'应用分组到草稿',exact:true}).click();await page.waitForTimeout(500);
        groupApply=await read();assert.equal(groupApply.nativeRenders,1);
      }
      const result={baseline,mobile,entries:preset.prompts.length,bodyCharacters:preset.prompts.reduce((sum,p)=>sum+p.content.length,0),idle,selection,search,placement,move,dragging,drop,grouping,groupApply,headingRetained,sideRetained};
      measurements.push(result);console.log(JSON.stringify(result));
      if(!baseline){
        for(const metric of [idle,selection,search,placement])assert.equal(metric.reads,0,'presentation-only interactions must not clone/re-read the preset');
        assert.equal(idle.views,0,'idle must not render');assert.equal(move.nativeRenders,1,'one mutation, one native render');
        assert.ok(headingRetained&&sideRetained,'controls and group headings survive presentation changes');
      }
      assert.deepEqual(errors,[]);await page.close();continue;
    }
    assert.equal(await bar.count(),1);assert.equal(await list.locator('[data-pm-identifier=clock]').isVisible(),false);
    await bar.getByLabel('搜索原生预设条目').fill('时间');await list.locator('[data-pm-identifier=clock]').waitFor({state:'visible'});
    await bar.getByLabel('搜索原生预设条目').fill('');await list.locator('.mpt-group-toggle').click();
    await alignList();await page.screenshot({path:resolve(output,'initial-'+(mobile?'mobile':'desktop')+'.png')});
    if(process.argv.includes('--inspect')){
      console.log(JSON.stringify(await list.evaluate(n=>{const row=n.querySelector('[data-pm-identifier]'),controls=row.querySelector('.prompt_manager_prompt_controls');return [row,...row.children,controls,...controls.children].map(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {cls:el.className,width:r.width,right:r.right,margin:s.margin,padding:s.padding,display:s.display,cols:s.gridTemplateColumns,min:s.minWidth,gap:s.gap};});}),null,2));
      console.log(JSON.stringify(await list.evaluate(n=>{const edge=n.getBoundingClientRect().right;return {width:n.clientWidth,scroll:n.scrollWidth,overflow:[...n.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>edge+1).slice(0,8).map(el=>({cls:el.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right,display:getComputedStyle(el).display,columns:getComputedStyle(el).gridTemplateColumns,html:el.outerHTML.slice(0,180)}))};}),null,2));
      console.log(JSON.stringify(await list.evaluate(n=>[n,...n.children].slice(0,4).map(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {tag:el.tagName,cls:el.className,y:r.y,height:r.height,margin:s.margin,padding:s.padding,display:s.display};})),null,2));
      console.log(JSON.stringify(await bar.evaluate(n=>{
        const nodes=[];for(let p=n;p;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();nodes.push({id:p.id,cls:p.className,x:r.x,y:r.y,width:r.width,height:r.height,overflow:s.overflow,scrollLeft:p.scrollLeft,left:s.left,transform:s.transform,style:p.getAttribute('style')});}
        return nodes;
      }),null,2));await page.close();continue;
    }
    if(!mobile){
      await list.getByRole('button',{name:'移动：基础规则',exact:true}).focus();await page.keyboard.press('Alt+ArrowDown');
      await page.waitForFunction(()=>SillyTavern.getContext().chatCompletionSettings.prompt_order[0].order[0].identifier==='clock');
      await page.waitForFunction(()=>document.querySelector('#completion_prompt_manager_list .completion_prompt_manager_prompt')?.dataset.pmIdentifier==='clock'&&document.querySelector('#completion_prompt_manager_list .mpt-row-more'));
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='移动：基础规则');
      await page.keyboard.press('Alt+ArrowDown');
      await page.waitForFunction(()=>SillyTavern.getContext().chatCompletionSettings.prompt_order[0].order[2].identifier==='intro');
      await bar.getByRole('button',{name:'撤销',exact:true}).click();
      await bar.getByRole('button',{name:'撤销',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#completion_prompt_manager_list .completion_prompt_manager_prompt')?.dataset.pmIdentifier==='intro'&&document.querySelector('#completion_prompt_manager_list .mpt-row-more'));
      await list.getByRole('button',{name:'移动：基础规则',exact:true}).hover();
      const grip=await list.locator('[data-pm-identifier=intro] .drag-handle').boundingBox();
      await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.waitForTimeout(80);
      await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2+16,{steps:4});
      const target=await list.locator('[data-pm-identifier=extra-0]').boundingBox();
      await page.mouse.move(target.x+24,target.y+target.height-4,{steps:16});await page.mouse.up();
      await page.waitForFunction(()=>SillyTavern.getContext().chatCompletionSettings.prompt_order[0].order[0].identifier!=='intro');
      assert.equal(await page.getByRole('dialog',{name:'移动到…'}).count(),0,'drag release must not open move dialog');
      await bar.getByRole('button',{name:'撤销',exact:true}).click();
      await page.waitForFunction(()=>SillyTavern.getContext().chatCompletionSettings.prompt_order[0].order[0].identifier==='intro');
    }
    await list.getByRole('button',{name:'操作：基础规则',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'搜索移动到…',exact:true}).click();
    const move=page.getByRole('dialog',{name:'移动到…'});
    await move.getByLabel('搜索移动目标').fill('最后');await move.locator('[data-target=ending]').click();
    await move.getByLabel('目标前后位置').selectOption('after');
    await move.screenshot({path:resolve(output,'move-'+(mobile?'mobile':'desktop')+'.png')});
    assert.ok(await move.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    await move.getByRole('button',{name:'确认移动',exact:true}).click();
    await page.waitForFunction(()=>{const order=SillyTavern.getContext().chatCompletionSettings.prompt_order[0].order;return order[order.findIndex(o=>o.identifier==='ending')+1]?.identifier==='intro';});
    assert.equal(saves,0);
    await bar.getByRole('button',{name:'撤销',exact:true}).click();
    await page.waitForFunction(()=>SillyTavern.getContext().chatCompletionSettings.prompt_order[0].order[0].identifier==='intro');
    await list.getByRole('button',{name:'操作：基础规则',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'复制副本 · 默认停用',exact:true}).click();
    await page.waitForFunction(()=>SillyTavern.getContext().chatCompletionSettings.prompts.some(p=>p.name==='基础规则（副本）'));
    let current=await page.evaluate(()=>structuredClone(SillyTavern.getContext().chatCompletionSettings));
    const copy=current.prompts.find(p=>p.name==='基础规则（副本）');assert.deepEqual(copy.custom,{keep:true});assert.equal(current.prompt_order[0].order.find(o=>o.identifier===copy.identifier).enabled,false);
    await bar.getByRole('button',{name:'撤销',exact:true}).click();
    await bar.getByRole('button',{name:'多选',exact:true}).click();
    await list.getByRole('checkbox',{name:'选择：时间定义',exact:true}).check();await list.getByRole('checkbox',{name:'选择：时间输出',exact:true}).check();
    await bar.getByRole('button',{name:'移动到…',exact:true}).click();
    await move.getByRole('button',{name:'列表末尾',exact:true}).click();await move.getByRole('button',{name:'确认移动',exact:true}).click();
    await page.waitForFunction(()=>SillyTavern.getContext().chatCompletionSettings.prompt_order[0].order.at(-1).identifier==='output');
    await bar.getByRole('button',{name:'移出列表',exact:true}).click();
    await page.waitForFunction(()=>!SillyTavern.getContext().chatCompletionSettings.prompt_order[0].order.some(o=>o.identifier==='clock'));
    assert.ok(await page.evaluate(()=>SillyTavern.getContext().chatCompletionSettings.prompts.some(p=>p.identifier==='clock')));
    await bar.getByRole('button',{name:'撤销',exact:true}).click();await bar.getByRole('button',{name:'撤销',exact:true}).click();
    await bar.getByRole('button',{name:'结束多选',exact:true}).click();
    // Escape leaves order untouched and an empty search has a visible reset.
    await list.getByRole('button',{name:'移动：基础规则',exact:true}).click();
    await bar.locator('.mpt-placement').waitFor({state:'visible'});await page.keyboard.press('Escape');
    await bar.locator('.mpt-placement').waitFor({state:'hidden'});
    await bar.getByLabel('搜索原生预设条目').fill('不存在的条目');
    await list.locator('.mpt-empty').waitFor({state:'visible'});
    await bar.getByRole('button',{name:'清除条目搜索',exact:true}).click();
    // Select an insertion point in the original list and keep the actions in
    // view while scrolling through a long preset.
    if(mobile)await list.getByRole('button',{name:'移动：基础规则',exact:true}).tap();
    else await list.getByRole('button',{name:'移动：基础规则',exact:true}).click();
    const targetChoice=list.getByRole('button',{name:'选为落点：最后的写作提醒',exact:true});
    await targetChoice.scrollIntoViewIfNeeded();await targetChoice.click();
    await bar.getByLabel('就地插入前后位置').selectOption('after');
    assert.match(await list.locator('.mpt-insertion-marker').textContent(),/在这里插入 1 个条目/);
    const positions=await bar.evaluate(n=>({bar:n.getBoundingClientRect().top,scroller:n.closest('.scrollableInner').getBoundingClientRect().top}));
    assert.ok(Math.abs(positions.bar-positions.scroller)<20,'toolbar stays docked while viewing the last row');
    await page.screenshot({path:resolve(output,'inline-placement-'+(mobile?'mobile':'desktop')+'.png')});
    await bar.getByRole('button',{name:'放在这里',exact:true}).click();
    await page.waitForFunction(()=>{const order=SillyTavern.getContext().chatCompletionSettings.prompt_order[0].order;return order[order.findIndex(o=>o.identifier==='ending')+1]?.identifier==='intro';});
    await bar.getByRole('button',{name:'撤销',exact:true}).click();
    await bar.getByRole('button',{name:'新增',exact:true}).click();
    await page.locator('#completion_prompt_manager_popup_entry_form_name').fill('一步新增的条目');
    await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill('新条目的正文');
    await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    const insertion=page.getByRole('dialog',{name:'新增条目 · 选择插入位置',exact:true});
    await insertion.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await page.locator('#completion_prompt_manager_popup_entry_form_prompt').inputValue(),'新条目的正文');
    assert.equal(await page.evaluate(()=>SillyTavern.getContext().chatCompletionSettings.prompts.some(p=>p.name==='一步新增的条目')),false);
    await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    await insertion.getByLabel('搜索移动目标').fill('时间输出');await insertion.locator('[data-target=output]').click();
    await insertion.getByRole('checkbox',{name:'加入后启用',exact:true}).check();
    await insertion.screenshot({path:resolve(output,'new-entry-'+(mobile?'mobile':'desktop')+'.png')});
    await insertion.getByRole('button',{name:'创建并插入',exact:true}).click();
    await page.waitForFunction(()=>SillyTavern.getContext().chatCompletionSettings.prompts.some(p=>p.name==='一步新增的条目'));
    const created=await page.evaluate(()=>{const p=SillyTavern.getContext().chatCompletionSettings,id=p.prompts.find(p=>p.name==='一步新增的条目').identifier,order=p.prompt_order[0].order;return {next:order[order.findIndex(o=>o.identifier===id)+1]?.identifier,state:order.find(o=>o.identifier===id).enabled};});
    assert.deepEqual(created,{next:'output',state:true});await bar.getByRole('button',{name:'撤销',exact:true}).click();
    await bar.getByLabel('搜索原生预设条目').fill('时间');
    await list.locator('[data-pm-identifier=clock] .prompt-manager-edit-action').click();
    const field=page.locator('#completion_prompt_manager_popup_entry_form_prompt');await field.fill('{{getvar::missing}}');await field.focus();
    assert.ok(await page.locator('body').evaluate(n=>n.classList.contains('mpt-quiet-macros')));
    await field.press('End');await field.press('Enter');assert.equal(await field.inputValue(),'{{getvar::missing}}\n');
    await page.locator('.mpt-editor-assist summary').click();assert.match(await page.locator('.mpt-variable-results').textContent(),/未找到定义/);
    await page.getByRole('button',{name:'宏自动提示：关',exact:true}).click();assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('mpt-quiet-macros')),false);
    await page.getByRole('button',{name:'宏自动提示：开',exact:true}).click();
    await field.fill('{{setvar::时间::黎明}}\n需要查找的段落');
    await page.getByLabel('已有变量',{exact:true}).selectOption(JSON.stringify(['local','时间']));
    await page.getByRole('button',{name:'插入 get',exact:true}).click();assert.match(await field.inputValue(),/getvar::时间/);
    await field.fill('{{setvar::时间::黎明}}\n需要查找的段落');
    await page.getByLabel('查找条目正文').fill('段落');await page.getByRole('button',{name:'下一个',exact:true}).click();
    assert.equal(await field.evaluate(n=>n.value.slice(n.selectionStart,n.selectionEnd)),'段落');
    await page.getByRole('button',{name:'展开正文',exact:true}).click();
    await page.getByLabel('展开后的条目正文').fill('{{setvar::时间::傍晚}}\n已修改正文');await page.getByRole('button',{name:'应用回编辑框',exact:true}).click();
    assert.equal(await field.inputValue(),'{{setvar::时间::傍晚}}\n已修改正文');
    await page.locator('#completion_prompt_manager_popup_edit').screenshot({path:resolve(output,'editor-'+(mobile?'mobile':'desktop')+'.png')});
    await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    await bar.getByLabel('搜索原生预设条目').fill('');
    await bar.getByRole('button',{name:'多选',exact:true}).click();
    await list.getByRole('checkbox',{name:'选择：基础规则',exact:true}).check();
    await bar.getByRole('button',{name:'分组…',exact:true}).click();
    const group=page.getByRole('dialog',{name:'预设分组',exact:true});
    assert.ok(await group.getByRole('checkbox',{name:'选择：基础规则',exact:true}).isChecked(),'native selection carries into groups');
    assert.ok(await group.getByLabel('新分组名称',{exact:true}).isVisible(),'selection immediately exposes group actions on mobile');
    await group.screenshot({path:resolve(output,'group-compose-'+(mobile?'mobile':'desktop')+'.png')});
    await group.getByLabel('新分组名称',{exact:true}).fill('基础与提醒');await group.getByRole('button',{name:'新建分组',exact:true}).click();
    if(mobile)await group.getByRole('tab',{name:'管理分组 · 2',exact:true}).click();
    else await group.locator('.mpt-settings summary').click();
    const groupName=group.getByLabel('分组名称',{exact:true}).first(),groupNameHandle=await groupName.elementHandle();
    await groupName.fill('时间与状态（改名）');await groupName.press('Tab');
    assert.ok(await groupNameHandle.evaluate(n=>n.isConnected),'renaming a group must retain the input and keyboard position');
    await group.getByRole('button',{name:'撤销上一步',exact:true}).filter({visible:true}).click();
    assert.equal(await groupName.inputValue(),'时间与状态');
    if(mobile)await group.getByRole('tab',{name:'选择条目',exact:true}).click();
    await group.screenshot({path:resolve(output,'groups-'+(mobile?'mobile':'desktop')+'.png')});
    await group.getByRole('button',{name:'应用分组到草稿',exact:true}).click();
    await bar.getByRole('button',{name:'结束多选',exact:true}).click();
    await bar.getByRole('button',{name:'保存到预设',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.mpt-native-bar .mpt-notice')?.textContent==='已保存到预设');
    assert.equal(saves,1);assert.equal(preset.prompts.find(p=>p.identifier==='clock').content,'{{setvar::时间::傍晚}}\n已修改正文');assert.ok(preset.extensions.miao_prompt_groups.groups.some(g=>g.name==='基础与提醒'));
    await alignList();await page.screenshot({path:resolve(output,'native-list-'+(mobile?'mobile':'desktop')+'.png')});
    assert.ok(await bar.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    assert.ok(await list.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'list controls must not overflow on touch screens');
    if(!mobile){
      await list.getByRole('button',{name:'操作：基础规则',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'搜索移动到…',exact:true}).click();
      await page.evaluate(()=>{
        document.documentElement.style.setProperty('--SmartThemeBlurTintColor','#fbfaf7');document.documentElement.style.setProperty('--SmartThemeBodyColor','#252a28');
        document.documentElement.style.setProperty('--SmartThemeQuoteColor','#426956');document.documentElement.style.setProperty('--SmartThemeBorderColor','#c6cbc5');
      });
      await move.getByLabel('搜索移动目标').fill('时间');await move.screenshot({path:resolve(output,'move-light.png')});await move.getByRole('button',{name:'取消',exact:true}).click();
    }
    if(tt)await checkTtEditor(page,bar,list,output);
    await page.evaluate(async path=>{const m=await import(path);m.onDisable();},prefix+'index.js');
    assert.equal(await page.locator('.mpt-native-bar').count(),0);assert.equal(await page.locator('.mpt-editor-tools').count(),0);
    await page.evaluate(async path=>{const m=await import(path);m.onEnable();},prefix+'index.js');await bar.waitFor({state:'attached'});
    assert.equal(await bar.count(),1);
    if(mobile){
      await page.setViewportSize({width:320,height:640});await bar.scrollIntoViewIfNeeded();
      assert.ok(await bar.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
      assert.ok(await list.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
      await bar.getByRole('button',{name:'分组',exact:true}).click();
      await group.getByRole('checkbox',{name:'选择：基础规则',exact:true}).check();
      assert.ok(await group.getByLabel('新分组名称',{exact:true}).isVisible());
      assert.ok(await group.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
      await group.screenshot({path:resolve(output,'group-compose-320.png')});
      if(tt){
        await page.setViewportSize({width:390,height:480});
        await group.getByLabel('新分组名称',{exact:true}).focus();
        const fit=await group.evaluate(n=>({top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom,footer:n.querySelector('footer').getBoundingClientRect().bottom,height:innerHeight}));
        assert.ok(fit.top>=0&&fit.bottom<=fit.height&&fit.footer<=fit.height,'group actions stay in the reduced TT content viewport');
        await group.screenshot({path:resolve(output,'group-keyboard-viewport.png')});
      }
      await group.getByRole('button',{name:'关闭',exact:true}).click();
    }
    assert.deepEqual(errors,[]);await page.close();
    console.log('PASS '+(mobile?'390px 手机触控':'桌面/键盘/拖拽')+' 原列表落点/插入线、滚动跟随、新增并插入/取消保留/撤销、分组/搜索、批量移动/复制/移出、宏开关/查找/插入/展开编辑、保存、启停清理');
  }
}finally{await browser.close();}
if(performanceCheck)await writeFile(resolve(output,'performance-'+(baseline?'before':'after')+'.json'),JSON.stringify(measurements,null,2)+'\n');
