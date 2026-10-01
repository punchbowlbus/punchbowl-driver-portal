const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {start}=require('../tools/yard-local.cjs');
test('Node-only local server: sessions, permissions, approvals and persistent sample data',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'yard-local-')),dataPath=path.join(folder,'data.json');let app=await start({port:0,dataPath});
  try{
    let url=`http://127.0.0.1:${app.port}`;
    const request=async(action,data={},cookie='')=>{const r=await fetch(url+'/__yard/'+action,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
    assert.equal((await request('Board')).status,401);
    assert.equal((await fetch(url+'/js/firebase.js')).status,404);
    assert.equal((await fetch(url+'/js/yard.js')).status,200);
    const source=await (await fetch(url+'/js/yard.js')).text();assert.equal(source.includes('www.gstatic.com'),false);
    const a=(await request('Login',{email:'yard1@example.test'})).cookie,b=(await request('Login',{email:'yard2@example.test'})).cookie,m=(await request('Login',{email:'manager@example.test'})).cookie;
    const board=(await request('Board',{},a)).body;assert.equal(board.fleet.length,3);
    const task={busId:'M07538',type:'exterior'};
    assert.equal((await request('Update',{...task,action:'start'},a)).status,200);
    assert.equal((await request('Update',{...task,action:'start'},b)).status,400);
    const completed=await request('Update',{...task,action:'complete',checklist:board.checklists.exterior,completedDate:board.today},a);assert.equal(completed.status,200);
    assert.equal((await request('Update',{...task,action:'approve',recordId:completed.body.recordId},a)).status,400);
    assert.equal((await request('Update',{...task,action:'approve',recordId:completed.body.recordId},m)).status,200);
    await new Promise(resolve=>app.server.close(resolve));app=await start({port:0,dataPath});url=`http://127.0.0.1:${app.port}`;
    const fresh=(await request('Login',{email:'manager@example.test'})).cookie,newBoard=(await request('Board',{},fresh)).body;
    assert.equal(newBoard.fleet.find(bus=>bus.id==='M07538').yard.exterior.lastBy.name,'Yard Employee A');
    const history=(await request('History',{busId:'M07538'},fresh)).body.records;
    assert.equal(history.length,3);assert.equal(history[0].action,'approve');
    const next=await request('Update',{busId:'M07538',type:'interior',action:'start'},fresh);assert.equal(next.status,200);
    assert.equal((await request('History',{busId:'M07538'},fresh)).body.records.length,4);
  }finally{await new Promise(resolve=>app.server.close(resolve));await fs.rm(folder,{recursive:true,force:true});}
});
