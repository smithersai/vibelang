// run-seconds: 360
// Six isolated modules each have a sixty-second process deadline.
import {execFileSync} from "node:child_process";
const forms=["optional-alias", "nullable-alias", "optional-property", "optional-binding", "optional-unrelated", "optional-type-only"];
const results=forms.map(form=>{
 const entry=new URL("./out/"+form+".js",import.meta.url).href;
 const code="const m=await import("+JSON.stringify(entry)+");console.log(JSON.stringify(m.inspect()));";
 return JSON.parse(execFileSync(process.execPath,["--input-type=module","-e",code],{encoding:"utf8",timeout:60_000,killSignal:"SIGKILL"}).trim());
});
console.log(JSON.stringify(results));
