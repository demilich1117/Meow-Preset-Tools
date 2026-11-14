const LEGACY_KEY='miao.prompt-groups.backups';
const isQuota=error=>error?.name==='QuotaExceededError'||error?.name==='NS_ERROR_DOM_QUOTA_REACHED'||error?.code===22;

// Use the host's IndexedDB driver explicitly: full presets can exceed the much
// smaller localStorage quota. Never fall back to localStorage after an IDB error.
export function createBackupStore(win){
  let store;
  function database(){
    if(store!==undefined)return store;
    const lf=win.SillyTavern?.libs?.localforage??win.localforage;
    store=lf?.createInstance?lf.createInstance({name:'miao-prompt-groups',storeName:'backups',driver:lf.INDEXEDDB}):null;
    return store;
  }
  function validate(values){
    if(!Array.isArray(values)||values.some(b=>!b?.preset||typeof b.name!=='string'))throw Error('本地备份数据损坏，请先导出站点数据后处理');
    return values;
  }
  function legacy(){
    const raw=win.localStorage.getItem(LEGACY_KEY);
    try{return {raw,values:validate(JSON.parse(raw??'[]'))};}
    catch{throw Error('本地备份数据损坏，请先导出站点数据后处理');}
  }
  function merge(values){
    const seen=new Set();
    return values.filter(value=>{const key=JSON.stringify(value);if(seen.has(key))return false;seen.add(key);return true;})
      .sort((a,b)=>String(b.time??'').localeCompare(String(a.time??''))).slice(0,3);
  }
  async function read(){
    const old=legacy(),db=database(),saved=db?await db.getItem('recent'):null;
    return merge([...validate(saved??[]),...old.values]);
  }
  async function add(backup,signal){
    return win.navigator.locks.request('miao-prompt-groups-backups',{signal},async()=>{
      const old=legacy(),db=database(),saved=db?await db.getItem('recent'):null;
      const values=[backup,...merge([...validate(saved??[]),...old.values])].slice(0,3);
      if(signal?.aborted)throw Error('操作已取消');
      for(let count=values.length;count>=1;count--){
        try{
          if(db)await db.setItem('recent',values.slice(0,count));
          else win.localStorage.setItem(LEGACY_KEY,JSON.stringify(values.slice(0,count)));
        }catch(error){
          if(isQuota(error)&&count>1)continue;
          throw Error(isQuota(error)?'本地备份空间不足，预设尚未保存。请先导出当前草稿和备份，再释放浏览器存储空间后重试。':'本地备份未能写入，预设尚未保存：'+error.message,{cause:error});
        }
        // Only release the old key after the durable write succeeds. Other
        // extensions' storage is never touched, and a changed old key is kept.
        if(db&&old.raw!==null&&win.localStorage.getItem(LEGACY_KEY)===old.raw){
          try{win.localStorage.removeItem(LEGACY_KEY);}catch{/* The migrated copy is already safe in IndexedDB. */}
        }
        return;
      }
    });
  }
  return {read,add};
}
