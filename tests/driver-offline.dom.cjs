// Run with JSDOM_PATH pointing to a locally installed jsdom package.
const assert=require('node:assert/strict');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const fs=require('node:fs');const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
const dom=new JSDOM(read('offline.html'),{url:'http://localhost:5000/offline.html',runScripts:'outside-only'});
const w=dom.window;
w.eval(read('js/offline_driver_store.js').replace(/export /g,'')+';window.makeStore=createOfflineStore;');
const store=w.makeStore(w.localStorage);store.setUser('u1');store.identify('u1',{employeeNumber:'963'},true);
const duty={id:'a',serviceDate:'2026-11-20',driverEmployeeNumber:'963',driverName:'N RAJAPAKSHA',dispatchStatus:'Assigned',startMin:300,endMin:900,breaks:[{type:'Meal',startMin:500,endMin:530}]};
store.saveRoster([duty,{...duty,id:'b',serviceDate:'2026-11-21'},{...duty,id:'c',dispatchStatus:'Cancelled'}],{fromCache:false,hasPendingWrites:false});
store.saveSheet(duty,[{id:'job',name:'<img src=x onerror=alert(1)>',from:'Depot',to:'School',startMin:330,endMin:400,stops:[{from:'Depot',to:'School',startMin:330,endMin:400}]}]);
w.eval(read('js/offline_driver_page.js').replace(/^import[^\n]*\n/,''));
const root=w.document.getElementById('savedWork');assert.equal(root.querySelectorAll('article').length,3);assert.match(root.textContent,/Job details not downloaded/);assert.match(root.textContent,/This duty was cancelled/);assert.match(root.textContent,/School/);assert.match(root.textContent,/Scheduled breaks/);assert.equal(root.querySelector('img'),null);assert.equal(root.querySelector('button,input,form'),null);assert.equal(root.querySelectorAll('details').length,1);
w.document.getElementById('removeCopy').click();assert.match(root.textContent,/No saved driver work/);assert.equal(w.localStorage.getItem('pbc-driver-offline-v1'),null);
// Exercise the live bridge without Firebase, including loss/restoration of connection.
w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
w.eval(read('js/offline_driver_bridge.js').replace(/^import[^\n]*\n/,''));
w.pbcOfflineDriver.setUser('u1');w.pbcOfflineDriver.identify('u1',{employeeNumber:'963'},true);
w.pbcOfflineDriver.saveRoster([duty],{fromCache:false,hasPendingWrites:false});assert.match(w.document.getElementById('offlineDriverBar').textContent,/1 duties/);
Object.defineProperty(w.navigator,'onLine',{value:false,configurable:true});w.dispatchEvent(new w.Event('offline'));assert.ok(w.document.getElementById('offlineDriverDialog').hasAttribute('open'));
Object.defineProperty(w.navigator,'onLine',{value:true,configurable:true});w.dispatchEvent(new w.Event('online'));assert.equal(w.document.getElementById('offlineDriverDialog'),null);
w.pbcOfflineDriver.clear();assert.equal(w.document.getElementById('offlineDriverBar'),null);assert.equal(w.localStorage.getItem('pbc-driver-offline-v1'),null);
console.log('Offline DOM checks passed: saved/missing/cancelled duties, stops, escaping, removal and connection overlay.');w.close();
