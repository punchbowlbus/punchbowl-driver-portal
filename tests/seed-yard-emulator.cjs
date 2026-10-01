// Seed only the isolated demo emulator project. This script refuses real project IDs.
process.env.GCLOUD_PROJECT="demo-pbc-yard";
process.env.FIRESTORE_EMULATOR_HOST="127.0.0.1:8080";
const admin=require("../functions-yard/node_modules/firebase-admin");
admin.initializeApp({projectId:"demo-pbc-yard"});
const db=admin.firestore();
(async()=>{
  const people=[{employeeNumber:"101",email:"yard1@example.test",displayName:"Yard Employee A",role:"Yard Man",accessLevel:"Yard Man",department:"Yard",status:"Active"},{employeeNumber:"102",email:"yard2@example.test",displayName:"Yard Employee B",role:"Yard Man",accessLevel:"Yard Man",department:"Yard",status:"Active"},{employeeNumber:"1",email:"manager@example.test",displayName:"Fleet Manager",role:"Manager",accessLevel:"Admin",department:"Workshop",status:"Active"}];
  for(const person of people)await db.collection("employees").doc(person.employeeNumber).set(person);
  for(const [id,bus] of Object.entries({M07538:{fleetNumber:"M07538",depot:"Riverwood",fuelType:"Diesel"},M09104:{fleetNumber:"M09104",depot:"Hannan's",fuelType:"Diesel"},EV012:{fleetNumber:"EV012",depot:"Riverwood",fuelType:"Electric"}}))await db.collection("buses").doc(id).set({...bus,status:"Active"});
  console.log("Seeded demo-pbc-yard only. Use the Auth emulator Google sign-in with yard1@example.test, yard2@example.test or manager@example.test.");
})().catch((error)=>{console.error(error.message);process.exitCode=1;});
