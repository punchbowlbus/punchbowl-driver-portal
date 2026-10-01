function memoryDb(seed={}){
  const data=new Map(Object.entries(seed)),copy=(v)=>v===undefined?undefined:structuredClone(v);let id=0,queue=Promise.resolve();
  const snapshot=(path)=>({id:path.split("/").at(-1),exists:data.has(path),data:()=>copy(data.get(path))});
  function nextId(){do{id++;}while(data.has(`yardRecords/record${id}`));return `record${id}`;}
  function collection(name,filters=[],limit=Infinity,order=null){return {doc:(key)=>({path:`${name}/${key || nextId()}`,id:key || `record${id}`}),where:(field,op,value)=>collection(name,[...filters,{field,op,value}],limit,order),orderBy:(field,direction)=>collection(name,filters,limit,{field,direction}),limit:(n)=>collection(name,filters,n,order),get:async()=>{const docs=[...data.keys()].filter((path)=>path.startsWith(name+"/")).map(snapshot).filter((row)=>filters.every(({field,op,value})=>op==="in"?value.includes(row.data()[field]):row.data()[field]===value)).sort((a,b)=>order?(String(a.data()[order.field]||"").localeCompare(String(b.data()[order.field]||"")))*(order.direction==="desc"?-1:1):0).slice(0,limit);return {docs,size:docs.length};}};}
  return {data,collection,runTransaction:(fn)=>{
    const run=queue.then(async()=>{const writes=[];const result=await fn({get:async(ref)=>snapshot(ref.path),set:(ref,value)=>writes.push([ref.path,value]),update:(ref,value)=>writes.push([ref.path,{...data.get(ref.path),...value}])});writes.forEach(([path,value])=>data.set(path,copy(value)));return result;});queue=run.catch(()=>{});return run;
  }};
}
module.exports={memoryDb};
