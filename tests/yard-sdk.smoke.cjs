// Run after npm --prefix functions-yard ci. Loads the actual locked Firebase SDKs.
// No live Firebase calls, credentials, reads or writes are used.
process.env.GCLOUD_PROJECT='demo-pbc-yard';
process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'demo-pbc-yard',storageBucket:'demo-pbc-yard.appspot.com'});
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
const assert=require('node:assert/strict');
const yard=require('../functions-yard/index.js');
(async()=>{
 const names=['pbcYardBoard','pbcYardHistory','pbcYardSetPin','pbcYardTabletRoster','pbcYardUpdate'];
 assert.deepEqual(Object.keys(yard).sort(),names.sort());
 for(const endpoint of Object.values(yard)){
  assert.equal(typeof endpoint,'function');assert.equal(endpoint.__endpoint.platform,'gcfv2');assert.ok(endpoint.__endpoint.callableTrigger);
  await assert.rejects(endpoint.run({data:{},auth:null}),error=>['unauthenticated','permission-denied'].includes(error.code));
 }
 console.log('PASS: all five Yard callables load with the locked Firebase SDKs and deny unauthenticated access. No live Firebase requests.');
})().catch(error=>{console.error(error);process.exitCode=1;});
