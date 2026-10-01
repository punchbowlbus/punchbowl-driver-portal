import {initializeApp} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {getAuth,GoogleAuthProvider,connectAuthEmulator} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {getFunctions,connectFunctionsEmulator,httpsCallable} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";
import {FIREBASE_CONFIG} from "./config.js";
// An explicit demo project isolates the yard-only local test from the live Firebase project.
const local=["localhost","127.0.0.1"].includes(location.hostname)&&new URLSearchParams(location.search).get("yardEmulator")==="1";
const {app:portalApp,auth:portalAuth,provider:portalProvider}=local?{}:await import("./firebase.js");
const app=local?initializeApp({...FIREBASE_CONFIG,projectId:"demo-pbc-yard",authDomain:"demo-pbc-yard.firebaseapp.com",storageBucket:"demo-pbc-yard.appspot.com"},"yard-emulator"):portalApp;
export const yardAuth=local?getAuth(app):portalAuth;
export const yardProvider=local?new GoogleAuthProvider():portalProvider;
const functions=getFunctions(app,"australia-southeast1");
if(local){connectAuthEmulator(yardAuth,"http://127.0.0.1:9099",{disableWarnings:true});connectFunctionsEmulator(functions,"127.0.0.1",5001);}
export async function yardCall(name,data={}){return (await httpsCallable(functions,`pbcYard${name}`,{timeout:60000})(data)).data;}
