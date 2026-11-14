export function element(doc, tag, cls = '', text) {
  const n = doc.createElement(tag); n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
export function button(doc, label, action, cls = '') {
  const b = element(doc, 'button', 'mpt-button ' + cls, label); b.type = 'button';
  b.addEventListener('click', action); return b;
}
export function isolate(node) {
  for (const type of ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','click','dblclick','keydown','keyup']) {
    node.addEventListener(type, e => e.stopPropagation());
  }
}
export function dialog(win, title, onClose = () => {}) {
  const doc = win.document, focus = doc.activeElement, root = element(doc, 'dialog', 'mpt-modal');
  root.setAttribute('aria-label', title);
  const head = element(doc,'header','mpt-modal-head'), body = element(doc,'div','mpt-modal-body');
  const status = element(doc,'p','mpt-notice'), actions = element(doc,'footer','mpt-modal-actions');
  status.setAttribute('role','status');
  // TT's Android back bridge calls dialog.close() directly, without cancel.
  // Both paths must release the extension's modal reference exactly once.
  let closed=false;
  function finish() { if(closed)return;closed=true;root.remove();onClose();if(focus?.isConnected)focus.focus({preventScroll:true}); }
  function close() { if(root.open)root.close();finish(); }
  head.append(element(doc,'h2','',title),button(doc,'关闭',close));
  root.append(head,body,status,actions); isolate(root);
  root.addEventListener('cancel',e=>{e.preventDefault();close();});
  root.addEventListener('close',finish,{once:true});
  // ABI v1 needs explicit admission; v2 already supplies an inset-free content
  // viewport and must not receive a second keyboard/safe-area compensation.
  if(win.__TAURITAVERN__?.abiVersion===1)root.dataset.ttMobileSurface='fullscreen-window';
  doc.body.append(root);root.showModal();
  return {root,body,status,actions,close};
}
