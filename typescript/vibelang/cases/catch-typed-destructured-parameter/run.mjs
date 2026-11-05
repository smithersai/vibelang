import {destructured,readCode} from "./out/main.js"
let reads=0
const payload={get code(){reads++;return undefined}}
const plain=[]
for(const value of [payload,3,"text"]) {
 globalThis.work=()=>{throw value}
 plain.push(destructured()===undefined)
}
let nullTypeError=false
globalThis.work=()=>{throw null}
try{destructured()}catch(error){nullTypeError=error instanceof TypeError}
const sentinel={}
globalThis.work=()=>{throw {get code(){throw sentinel}}}
let sameError=false
try{destructured()}catch(error){sameError=error===sentinel}
delete globalThis.work
{
 let accesses=0
 const caught=readCode({get code(){accesses++;throw {code:9}}})
 if(accesses!==1 || caught!==9 || readCode({code:3})!==3)throw Error("ordinary catch binding changed getter evaluation")
}
console.log("@@result " + JSON.stringify({reads,plain,nullTypeError,sameError}))
