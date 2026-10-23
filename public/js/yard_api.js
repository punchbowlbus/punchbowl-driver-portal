import {initializeApp} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {getAuth,GoogleAuthProvider,connectAuthEmulator,signInWithEmailAndPassword,signOut,browserSessionPersistence,setPersistence} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {getFunctions,connectFunctionsEmulator,httpsCallable} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";
import {isYardTabletAccount} from "./yard_access.js";
import {FIREBASE_CONFIG} from "./config.js";
// An explicit demo project isolates the yard-only local test from the live Firebase project.
const local=["localhost","127.0.0.1"].includes(location.hostname)&&new URLSearchParams(location.search).get("yardEmulator")==="1";
const {app:portalApp,auth:portalAuth,provider:portalProvider}=local?{}:await import("./firebase.js");
const app=local?initializeApp({...FIREBASE_CONFIG,projectId:"demo-pbc-yard",authDomain:"demo-pbc-yard.firebaseapp.com",storageBucket:"demo-pbc-yard.appspot.com"},"yard-emulator"):portalApp;
export const yardAuth=local?getAuth(app):portalAuth;
export const yardProvider=local?new GoogleAuthProvider():portalProvider;
const functions=getFunctions(app,"australia-southeast1");
if(local){connectAuthEmulator(yardAuth,"http://127.0.0.1:9099",{disableWarnings:true});connectFunctionsEmulator(functions,"127.0.0.1",5001);}
let employeeAuth=null,employeeFunctions=null,employeeReady=null;
async function pinAuth(){
 if(!employeeAuth){
  const pinApp=initializeApp(local?{...FIREBASE_CONFIG,projectId:"demo-pbc-yard",authDomain:"demo-pbc-yard.firebaseapp.com"}:FIREBASE_CONFIG,"yard-pin");
  employeeAuth=getAuth(pinApp);employeeFunctions=getFunctions(pinApp,"australia-southeast1");
  if(local){connectAuthEmulator(employeeAuth,"http://127.0.0.1:9099",{disableWarnings:true});connectFunctionsEmulator(employeeFunctions,"127.0.0.1",5001);}
  employeeReady=(async()=>{await setPersistence(employeeAuth,browserSessionPersistence);await employeeAuth.authStateReady();})();
 }
 await employeeReady;return employeeAuth;
}
export async function yardCall(name,data={}){
 if(name==="PinStatus")return {ready:Boolean((await pinAuth()).currentUser)};
 if(name==="PinSignOut"){await signOut(await pinAuth());return {signedOut:true};}
 if(name==="PinSignIn"){
  if(!isYardTabletAccount(yardAuth.currentUser))throw new Error("Sign in with the company tablet account first.");
  try{await signInWithEmailAndPassword(await pinAuth(),data.email,data.pin);return {signedIn:true};}
  catch(error){if(error.code==="auth/operation-not-allowed")throw new Error("Email/Password sign-in must be enabled in Firebase Authentication for Yard PINs.");if(error.code==="auth/too-many-requests")throw new Error("Too many incorrect PIN attempts. Wait and try again.");throw new Error("Unable to sign in. Check the selected employee and six-digit PIN.");}
 }
 let target=functions;
 if(isYardTabletAccount(yardAuth.currentUser)&&name==="TabletRoster")data={...data,companyIdToken:await yardAuth.currentUser.getIdToken()};
 if(isYardTabletAccount(yardAuth.currentUser)&&!["TabletRoster","SetPin"].includes(name)){
  if(!(await pinAuth()).currentUser)throw new Error("Select your name and enter your Yard PIN.");
  target=employeeFunctions;data={...data,companyIdToken:await yardAuth.currentUser.getIdToken()};
 }
 return (await httpsCallable(target,`pbcYard${name}`,{timeout:60000})(data)).data;
}
