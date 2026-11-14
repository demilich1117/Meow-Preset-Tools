// Keep host-internal imports in one place. Verified with ST 1.19.0 and
// TauriTavern 2.4.0 (85dc99089e3f); TT-only modules never load in plain ST.
export async function loadRuntime(win, load = path => import(path)) {
  const tt = !!(win.__TAURITAVERN__ || win.__TAURITAVERN_MAIN_READY__);
  if (tt) await (win.__TAURITAVERN__?.ready ?? win.__TAURITAVERN_MAIN_READY__);
  const [native, script, utils] = await Promise.all([
    load('/scripts/openai.js'), load('/script.js'), load('/scripts/utils.js'),
  ]);
  if (typeof script.isGenerating !== 'function' || typeof utils.download !== 'function') {
    throw Error('宿主缺少生成状态或文件导出接口');
  }
  let editorModule, agentModule;
  if (tt) {
    // Older TT versions can lack optional modules. Do not let a missing editor
    // module prevent native list tools from loading.
    [editorModule, agentModule] = await Promise.all([
      load('/scripts/tauri/codemirror-editor.js').catch(() => null),
      win.__TAURITAVERN__?.api?.agent
        ? load('/scripts/tauritavern/agent/agent-run-controller.js').catch(() => null)
        : null,
    ]);
  }
  return {
    native, tt, download: utils.download,
    isGenerating: () => script.isGenerating() || !!agentModule?.hasActiveAgentRun?.()
      || !!(tt && win.__TAURITAVERN__?.api?.agent && !agentModule?.hasActiveAgentRun),
    getEditor(field) {
      if (!field || !tt) return null;
      if (editorModule?.getMountedCodeMirrorEditor) return editorModule.getMountedCodeMirrorEditor(field);
      if (field.nextElementSibling?.classList.contains('tt-codemirror-editor')) {
        throw Error('当前 TT 代码编辑器接口不可用，请使用原生编辑器或关闭 TT 代码编辑器后再使用正文辅助');
      }
      return null;
    },
  };
}
