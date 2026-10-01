// Node-only local demo. No Firebase SDK, credentials, Java or live data.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {memoryDb}=require('../tests/yard-memory.cjs');
const {createService}=require('../functions-yard/service');
const {identity,today}=require('../functions-yard/domain');
const publicDir=path.resolve(__dirname,'../public'),dataFile=path.join(__dirname,'yard-local-data.json');
const employees={
  'yard1@example.test':{employeeNumber:'101',displayName:'Yard Employee A',role:'Yard Man',accessLevel:'Yard Man',department:'Yard',status:'Active'},
  'yard2@example.test':{employeeNumber:'102',displayName:'Yard Employee B',role:'Yard Man',accessLevel:'Yard Man',department:'Yard',status:'Active'},
  'manager@example.test':{employeeNumber:'1',displayName:'Fleet Manager',role:'Manager',accessLevel:'Admin',department:'Workshop',status:'Active'}
};
function seed(){return Object.fromEntries(Object.entries({M07538:{depot:'Riverwood',fuelType:'Diesel',rego:'DEMO01'},M09104:{depot:"Hannan's",fuelType:'Diesel',rego:'DEMO02'},EV012:{depot:'Riverwood',fuelType:'Electric',rego:'DEMOEV'}}).map(([id,bus])=>['buses/'+id,{...bus,fleetNumber:id,status:'Active'}]));}
const authModule=`
async function request(action,data={}){const r=await fetch('/__yard/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw new Error(result.error);return result;}
export const yardAuth={currentUser:(await request('Session')).user},yardProvider={};
const listeners=new Set();
export function onAuthStateChanged(auth,callback){listeners.add(callback);queueMicrotask(()=>callback(auth.currentUser));return()=>listeners.delete(callback);}
export async function signInWithPopup(){const choice=prompt('LOCAL TEST ONLY — select an employee:\\n1 = Yard Employee A\\n2 = Yard Employee B\\n3 = Fleet Manager','1');if(choice===null)return;const emails={'1':'yard1@example.test','2':'yard2@example.test','3':'manager@example.test'};const result=await request('Login',{email:emails[choice]||choice.trim()});yardAuth.currentUser=result.user;listeners.forEach(cb=>cb(result.user));return result;}
export async function signOut(){await request('Logout');yardAuth.currentUser=null;listeners.forEach(cb=>cb(null));}
export function yardCall(name,data={}){return request(name,data);}
`;
async function start({port=5050,dataPath=dataFile}={}){
  let initial=seed();if(dataPath){try{initial=JSON.parse(await fs.readFile(dataPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}}
  const db=memoryDb(initial),sessions=new Map();let saving=Promise.resolve();
  const service=createService({db,stamp:()=>new Date().toISOString(),savePhotos:async(files)=>{
    if(files.length>3)throw new Error('Choose up to 3 photos.');
    return files.map(photo=>{if(photo.contentType!=='image/jpeg'||typeof photo.base64!=='string'||photo.base64.length>1400000)throw new Error('Invalid local photo.');return {url:'data:image/jpeg;base64,'+photo.base64,name:String(photo.name||'Photo')};});
  }});
  const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    try{
      const address=server.address(),origin=`http://127.0.0.1:${address.port}`;
      if(![`127.0.0.1:${address.port}`,`localhost:${address.port}`].includes(req.headers.host))return json(res,{error:'Local requests only.'},403);
      const url=new URL(req.url,origin),route=url.pathname;
      res.setHeader('Cache-Control','no-store');
      if(route.startsWith('/__yard/')&&route!=='/__yard/auth.js'){
        if(req.method!=='POST'||(req.headers.origin&&![origin,`http://localhost:${address.port}`].includes(req.headers.origin))||req.headers['content-type']!=='application/json')return json(res,{error:'Invalid local request.'},403);
        let body='';for await(const chunk of req){body+=chunk;if(body.length>6000000)throw new Error('Request too large.');}
        const input=JSON.parse(body||'{}'),action=route.slice(8),token=String(req.headers.cookie||'').match(/(?:^|;\s*)yardDemo=([a-f0-9]+)/)?.[1],person=sessions.get(token);
        if(action==='Session')return json(res,{user:person||null});
        if(action==='Login'){
          const employee=employees[input.email];if(!employee)throw new Error('Choose sample employee 1, 2 or 3.');
          const who=identity({uid:employee.employeeNumber,token:{email:input.email,email_verified:true}},employee),id=crypto.randomBytes(24).toString('hex');
          if(token)sessions.delete(token);sessions.set(id,who);res.setHeader('Set-Cookie',`yardDemo=${id}; HttpOnly; SameSite=Strict; Path=/`);return json(res,{user:who});
        }
        if(action==='Logout'){sessions.delete(token);res.setHeader('Set-Cookie','yardDemo=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,{signedOut:true});}
        if(!person)return json(res,{error:'Sign in with a sample employee.'},401);
        const result=action==='Board'?await service.board(person):action==='History'?await service.history(person,input.busId):action==='Update'?await service.update(person,input):null;
        if(result===null)return json(res,{error:'Unknown action.'},404);
        if(action==='Update'&&dataPath){const contents=JSON.stringify(Object.fromEntries(db.data),null,2);saving=saving.then(async()=>{await fs.writeFile(dataPath+'.tmp',contents);await fs.rename(dataPath+'.tmp',dataPath);});await saving;}
        return json(res,result);
      }
      if(req.method!=='GET')return json(res,{error:'Method not allowed.'},405);
      if(route==='/__yard/auth.js'||route==='/js/yard_api.js'){res.setHeader('Content-Type','text/javascript');return res.end(authModule);}
      const allowed=['/yard.html','/js/yard.js','/js/yard_model.js','/js/utils.js','/styles/yard.css','/styles/workshop.css','/styles/workshop_ui_polish.css','/styles/workshop_design_system.css','/icons/icon-192.png'];
      const pathname=route==='/'?'/yard.html':route;if(!allowed.includes(pathname))return json(res,{error:'Open the local Yard test page. Other portal pages are excluded.'},404);
      let content=await fs.readFile(path.join(publicDir,pathname));
      if(pathname==='/js/yard.js')content=content.toString().replace('https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js','/__yard/auth.js');
      if(pathname==='/yard.html')content=content.toString().replace('href="./workshop.html"','href="./yard.html?managerView=1"').replace('Workshop Management</a>','Manager View</a>').replace('<main class="main-content yard-shell">','<div style="padding:12px 20px;background:#fff3cd;color:#624900;font-weight:700">LOCAL TEST — sample data only · <a href="/yard.html">Yard view</a> · <a href="/yard.html?managerView=1">Manager view</a> · Sign out to switch sample employees.</div><main class="main-content yard-shell">');
      res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.png')?'image/png':'text/html');res.end(content);
    }catch(error){json(res,{error:error.message},400);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,db,port:server.address().port,today:today()};
}
module.exports={start};
if(require.main===module)start().then(({port})=>console.log(`Local Yard test ready (sample data only).\nYard: http://127.0.0.1:${port}/yard.html\nManager: http://127.0.0.1:${port}/yard.html?managerView=1\nClick Sign in: 1 = Yard A, 2 = Yard B, 3 = Manager.\nUpdates saved locally. Ctrl+C stops the server.`)).catch(error=>{console.error(error.message);process.exitCode=1;});
