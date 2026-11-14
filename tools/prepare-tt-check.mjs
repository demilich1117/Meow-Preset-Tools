import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';

// Optional validation setup only. Never distributed in the extension ZIP.
const ref='85dc99089e3fcc9d3a0aafc085564bd642895261';
const root=fileURLToPath(new URL('..',import.meta.url));
const files=['LICENSE','package.json','src/scripts/PromptManager.js','src/scripts/prompt-manager-order-utils.js',
  'src/scripts/util/latest-task-scheduler.js','src/scripts/prompt-injections.js','src/scripts/tauri/codemirror-editor.js',
  'src/tauri/main/back-navigation.js','src/tauri/main/services/back-navigation/back-handler-stack.js',
  'src/lib-bundle-editor.js','src/editor-search-panel.js'];
await Promise.all(files.map(async path=>{
  const response=await fetch('https://raw.githubusercontent.com/Darkatse/TauriTavern/'+ref+'/'+path);
  if(!response.ok)throw Error(path+': '+response.status);
  const target=resolve(root,'output/tt-source',path);await mkdir(dirname(target),{recursive:true});await writeFile(target,await response.text());
}));
await writeFile(resolve(root,'output/tt-source/revision.txt'),ref+'\n');
const dir=resolve(root,'output/tt-runtime');await mkdir(dir,{recursive:true});
const result=spawnSync('npm',['install','--prefix','.','--no-save','--ignore-scripts','codemirror@6.0.2','@codemirror/state@6.7.1',
  '@codemirror/view@6.43.9','@codemirror/search@6.7.1','@codemirror/commands@6.11.0','esbuild@0.25.12'],
{cwd:dir,stdio:'inherit',shell:process.platform==='win32'});
if(result.error||result.status!==0)throw result.error??Error('Validation dependencies failed');
const {build}=await import(pathToFileURL(resolve(dir,'node_modules/esbuild/lib/main.js')));
await build({entryPoints:[resolve(root,'output/tt-source/src/lib-bundle-editor.js')],nodePaths:[resolve(dir,'node_modules')],bundle:true,format:'esm',outfile:resolve(dir,'editor.bundle.js')});
console.log('TT 2.4.0 source projection ready:',ref);
