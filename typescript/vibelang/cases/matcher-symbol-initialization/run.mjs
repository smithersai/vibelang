// run-seconds: 1380
// Twenty-three isolated modules each have a sixty-second process deadline.
import {execFileSync} from "node:child_process";
const forms=["indexed", "destructured", "aliased", "direct", "type-only", "shadowed", "parameter", "assignment", "parameter-type-only", "declaration-type-only", "mutable-binding", "iteration-binding", "nested-binding", "computed-assignment", "nested-assignment", "unrelated-assignment", "interface-alias", "type-literal-alias", "ambient-class-alias", "interface-direct", "abstract-method", "abstract-field", "concrete-member"];
const results=forms.map(form=>{
 const entry=new URL("./out/"+form+".js",import.meta.url).href;
 const code="const m=await import("+JSON.stringify(entry)+");console.log(JSON.stringify(m.inspect()));";
 return JSON.parse(execFileSync(process.execPath,["--input-type=module","-e",code],{encoding:"utf8",timeout:60_000,killSignal:"SIGKILL"}).trim());
});
console.log(JSON.stringify(results));
