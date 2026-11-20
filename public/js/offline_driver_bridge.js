import {createOfflineStore} from './offline_driver_store.js';
// Storage access can fail on managed/private devices; online work must still function.
let storage;
try { storage=window.localStorage; } catch { storage={getItem:()=>null,setItem:()=>{throw Error('Storage unavailable');},removeItem:()=>{}}; }
const store=createOfflineStore(storage);
let eligible=false;
function update() {
  let bar=document.getElementById('offlineDriverBar');
  if(!eligible){bar?.remove();document.getElementById('offlineDriverDialog')?.remove();return;}
  if(!bar){bar=document.createElement('aside');bar.id='offlineDriverBar';bar.style.cssText='padding:10px 16px;background:#fff4d9;color:#432f00;border-bottom:1px solid #e1c77f';document.body.prepend(bar);}
  const saved=store.read();
  bar.replaceChildren();
  const text=document.createElement('span');
  text.textContent=saved?`Offline copy: ${saved.duties.length} duties, ${Object.keys(saved.details).length} duty sheets saved on this device. `:'Offline copy not ready. Open My Work while connected. ';
  const link=document.createElement('a');link.href='./offline.html';link.textContent='View saved work / remove copy';
  bar.append(text,link);
  let dialog=document.getElementById('offlineDriverDialog');
  if(navigator.onLine===false && !dialog){
    dialog=document.createElement('dialog');dialog.id='offlineDriverDialog';
    dialog.innerHTML='<h2>You are offline</h2><p>Updates and submissions need a connection. Your saved work is read-only and may have changed.</p><p><a href="./offline.html">Open saved driver work</a></p><p>This message closes when the connection returns.</p>';
    dialog.addEventListener('cancel',event=>event.preventDefault());document.body.append(dialog);dialog.showModal();
  } else if(navigator.onLine!==false)dialog?.remove();
}
window.pbcOfflineDriver={
  setUser(uid){eligible=false;store.setUser(uid);update();},
  identify(uid,employee,allowed){eligible=!!allowed;store.identify(uid,employee,allowed);update();},
  clear(){store.clear();eligible=false;update();},
  saveRoster(duties,metadata){store.saveRoster(duties,metadata);update();},
  saveSheet(duty,jobs){store.saveSheet(duty,jobs);update();}
};
window.addEventListener('offline',update);
window.addEventListener('online',update);
