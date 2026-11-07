package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// The quoted preserving-fix authority is checked by TestNothrowPreservingQuoted.
// These mutations vary receiver binding, lazy operands, defaults and the
// call-versus-run boundary; unsupported placements must retain their own spans.
func FuzzNothrowCallPreservation(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"polymorphic-receiver", "polymorphic-indexed", "t3code-gitcafe-BigInt-narrowing", "predicate", "call", "conditional", "default", "receiver", "new", "strict-effect-default", "yield-operand", "smithers-Catalog-tracked-call"} {
		f.Add(key, int8(7))
	}
	for _, key := range []string{"default-effect-arrow", "default-effect-method", "default-producer", "default-producer-method", "default-factory", "default-stream-factory", "default-object-binding", "default-array-binding", "default-computed-binding", "default-foreign-unknown", "default-constructor", "default-optional", "default-eval-refusal", "default-body-refusal", "default-predicate-refusal"} {
		f.Add(key, int8(7))
	}
	for _, key := range []string{"overload-call", "overload-default", "overload-receiver", "overload-field", "overload-new", "overload-two-prefix", "overload-zero-prefix", "overload-parameter-refusal", "overload-return-refusal", "overload-generic-refusal", "overload-predicate-refusal", "overload-this-refusal", "overload-rest-refusal", "overload-arity-refusal", "overload-optional-refusal"} {
		f.Add(key, int8(7))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, value int8) {
		toolsGuard(t, "FuzzNothrowCallPreservation", func() {
			text := fmt.Sprintf("%q", fmt.Sprint(value))
			source := ""
			refuse := false
			boxed := false
			switch key {

			case "overload-call":
				source = "import {read,argument} from \"./native.js\";export function main(s:string):number{return read(argument(s))}"
			case "overload-default":
				source = "import {read,argument} from \"./native.js\";export function main(s:string,n=read(argument(s))):number{return n}"
			case "overload-receiver":
				source = "import {reader,argument} from \"./native.js\";export function main(s:string):number{return reader.read(argument(s))}"
			case "overload-field":
				source = "import {read,argument} from \"./native.js\";export function main(s:string):number{class Box{readonly value=read(argument(s))};return new Box().value}"
			case "overload-new":
				source = "import {OverloadedBox,argument} from \"./native.js\";export function main(s:string):number{return new OverloadedBox(argument(s)).value}"
			case "overload-two-prefix":
				source = "import {readPair,argument} from \"./native.js\";export function main(s:string):number{return readPair(argument(s)," + fmt.Sprint(value) + ")}"
			case "overload-zero-prefix":
				source = "import {readZero} from \"./native.js\";export function main(s:string):number{return readZero()}"
			case "overload-parameter-refusal", "overload-return-refusal", "overload-generic-refusal", "overload-predicate-refusal", "overload-this-refusal", "overload-rest-refusal", "overload-arity-refusal", "overload-optional-refusal":
				name := strings.TrimSuffix(strings.TrimPrefix(key, "overload-"), "-refusal")
				source = "import {incompatible} from \"./native.js\";export function main(s:string){return incompatible." + name + "(s)}"
				refuse = true
			case "polymorphic-receiver":
				source = "import type {Reader} from \"./native.js\";export const main=<T extends Reader>(r:T,n:number):infer _=>n<" + fmt.Sprint(value) + "?r.read():r.read()"
				refuse = true
			case "polymorphic-indexed":
				source = "import type {Reader} from \"./native.js\";export const main=<T extends {reader:Reader}>(r:T[\"reader\"],n:number):infer _=>n<" + fmt.Sprint(value) + "?r.read():r.read()"
				refuse = true

			case "t3code-gitcafe-BigInt-narrowing":
				source = "export const main=(input:{id?:string|null}):infer _=>input.id==null?0n:BigInt(input.id)"

			case "predicate":
				source = "import {predicate} from \"./native.js\";export const main=(n:unknown):infer _=>predicate(n)"
				refuse = true
			case "conditional":
				source = "export function main(s:string):unknown {return s ? JSON.parse(s) : JSON.parse(" + text + ")}"
			case "default":
				source = "export function main(s=JSON.parse(" + text + ")):unknown {return s}"
			case "receiver":
				source = "const reader={parse:JSON.parse};export function main(s:string):unknown {return reader.parse(s)}"
			case "new":
				source = "import {Box} from \"./native.js\";export function main(n:number):Box{return new Box(n)}"
			case "strict-effect-default":
				source = "export effect function main(s=JSON.parse(" + text + ")) {return s}"
				boxed = true

			case "default-effect-arrow":
				source = "export const main=effect(value=JSON.parse(" + text + "))=>{return value}"
				boxed = true
			case "default-effect-method":
				source = "export const holder={effect main(value=JSON.parse(" + text + ")){return value}}"
				boxed = true
			case "default-producer":
				source = "export effect function* main(value=JSON.parse(" + text + ")){yield value}"
				boxed = true
			case "default-producer-method":
				source = "export const holder={effect *main(value=JSON.parse(" + text + ")){yield value}}"
				boxed = true
			case "default-factory":
				source = "export function main(value=JSON.parse(" + text + ")):Effect.Effect<unknown>{return Effect.succeed(value)}"
				boxed = true
			case "default-stream-factory":
				source = "export function main(value=JSON.parse(" + text + ")){return Stream.succeed(value)}"
				boxed = true
			case "default-object-binding":
				source = "export effect function main(text=" + text + ",{value=JSON.parse(text)}:{value?:unknown}={}){return value}"
				boxed = true
			case "default-array-binding":
				source = "export effect function main(text=" + text + ",[value=JSON.parse(text)]:unknown[]=[]){return value}"
				boxed = true
			case "default-computed-binding":
				source = "export effect function main(text=" + text + ",{[JSON.parse(text)]:value=7}:Record<string,number>={}){return value}"
				boxed = true
			case "default-foreign-unknown":
				source = "import {load} from \"./native.js\";export effect function main(value=load(" + fmt.Sprint(value) + ")){return value}"
				boxed = true
			case "default-constructor":
				source = "import {Box} from \"./native.js\";export effect function main(value=new Box(" + fmt.Sprint(value) + ")){return value}"
				boxed = true
			case "default-optional":
				source = "const reader:{parse?:typeof JSON.parse}={parse:JSON.parse};export effect function main(value=reader.parse?.(" + text + ")){return value}"
				boxed = true
			case "default-eval-refusal":
				source = "export effect function main(value=JSON.parse(eval(" + text + "))){return value}"
				refuse = true
			case "default-body-refusal":
				source = "export function main():Effect.Effect<unknown>{return Effect.succeed(JSON.parse(" + text + "))}"
				refuse = true
			case "default-predicate-refusal":
				source = "import {predicate} from \"./native.js\";export effect function main(n:unknown,value=predicate(n)?n.length:0){return value}"
				refuse = true
			case "yield-operand":
				source = "export function* main():Generator<string,unknown,string>{return JSON.parse(yield " + text + ")}"
				refuse = true
			case "smithers-Catalog-tracked-call":
				source = "import * as Digest from \"./native.js\";export const main=(entry:{digest?:string,name:string}):string=>entry.digest!==undefined&&entry.digest!==\"\"?entry.digest:Digest.digest(entry.name)"
			default:
				key = "call"
				source = "export function main(s:string):unknown {return JSON.parse(s)}"
			}
			files := map[string]string{"main.vibe": source, "native.ts": `export interface Reader {
 /** @throws {Error} */
 read():number
}
export class Box {
 /** @throws {Error} */
 constructor(readonly n:number){if(n)throw new Error(String(n))}
}
/** @throws {Error} */
export function predicate(n:unknown):n is string {return typeof n==="string"}
/** @throws {Error} */
export function digest(s:string):string {if(!s)throw new Error(s);return s}
`}

			files["native.ts"] += `
export const events:string[]=[];
export const marker={defect:true};
function record(s:string):number {events.push("call:"+s);if(s==="throw")throw marker;return s.length}
/** @throws {never} */
export function argument(s:string):string {events.push("argument:"+s);return s}
/** @throws {Error} */
export function read(s:string):number;
/** @throws {Error} */
export function read(s:string,tail?:number):number;
export function read(s:string):number {return record(s)}
/** @throws {Error} */
export function readPair(s:string,n:number,tail?:string):number;
/** @throws {Error} */
export function readPair(s:string,n:number,tail?:boolean):number;
export function readPair(s:string,n:number):number {return record(s)+n}
/** @throws {Error} */
export function readZero():number;
/** @throws {Error} */
export function readZero(tail?:string):number;
export function readZero():number {return record("zero")}
interface OverloadedReader {
 readonly base:number;
 /** @throws {Error} */ read(s:string):number;
 /** @throws {Error} */ read(s:string,tail?:number):number;
}
export const reader:OverloadedReader={
 base:3,
 get read(){events.push("getter");return function(this:OverloadedReader,s:string):number{events.push("receiver:"+this.base);return record(s)+this.base}}
};
export class OverloadedBox {
 readonly value:number;
 /** @throws {Error} */ constructor(s:string);
 /** @throws {Error} */ constructor(s:string,tail?:number);
 constructor(s:string){this.value=record(s)}
}
export const incompatible:{
 parameter:{
/** @throws {Error} */(s:string):number;
/** @throws {Error} */(s:any):number};
 return:{
/** @throws {Error} */(s:string):1;
/** @throws {Error} */(s:string):number};
 generic:{
/** @throws {Error} */<T extends string>(s:T):number;
/** @throws {Error} */(s:string):number};
 predicate:{
/** @throws {Error} */(s:string):s is string;
/** @throws {Error} */(s:string):boolean};
 this:{
/** @throws {Error} */(this:void,s:string):number;
/** @throws {Error} */(s:string):number};
 rest:{
/** @throws {Error} */(s:string):number;
/** @throws {Error} */(s:string,...tail:number[]):number};
 arity:{
/** @throws {Error} */(s:string):number;
/** @throws {Error} */(s:string,tail:number):number};
 optional:{
/** @throws {Error} */(s:string):number;
/** @throws {Error} */(s?:string):number};
}=null!;
`
			runtimeCheck := strings.HasPrefix(key, "overload-") && !refuse
			if runtimeCheck {
				files["runner.ts"] = "import {Effect} from \"effect\";import {main as call} from \"./main.js\";import {events,marker} from \"./native.js\";export const main=()=>Effect.sync(()=>[\"" + fmt.Sprint(value) + "\",\"throw\"].map(s=>{events.length=0;try{return {events:[...events],result:call(s),after:[...events],same:false}}catch(e){return {events:[...events],same:e===marker}}}))"
			}

			files["native.ts"] += "\n/** @throws {unknown} */\nexport function load(n:number):number{return n}\n"
			if boxed && !strings.Contains(SpecText("003-failures.md"), "run at the call, before the Effect exists.") {
				t.Fatal("missing call-time binding authority")
			}
			before := toolsCompile(t, w, "FuzzNothrowCallPreservation", files)
			defer before.Remove()
			if strings.HasPrefix(key, "overload-") {
				count := 0
				for _, diagnostic := range before.Diagnostics {
					if diagnostic.Category() != diagnostics.CategoryError {
						continue
					}
					if !IsEK(diagnostic) || diagnostic.Code() != 401 {
						t.Fatalf("invalid overloaded-call fixture: %+v", before.Diagnostics)
					}
					count++
				}
				if count != 1 {
					t.Fatalf("overloaded call must have one EK0401 before fixing: %+v", before.Diagnostics)
				}
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			for _, site := range result.Sites {
				if !vibelang.SiteHolds(source, fixed["main.vibe"], site) {
					Gap(t, "FuzzNothrowCallPreservation", key+":site", "refused site changed: %+v", site)
				}
			}
			if len(result.Changed) != 0 {
				Gap(t, "FuzzNothrowCallPreservation", key+":changed", "refused bytes changed: %+v", result.Changed)
			}
			if refuse {
				if strings.Contains(fixed["main.vibe"], "$invoke(") || strings.Contains(fixed["main.vibe"], "$default(") || len(result.Sites) == 0 {
					Gap(t, "FuzzNothrowCallPreservation", key, "unsupported call must refuse at its site")
				}
				return
			}
			boundary := "$invoke("
			if boxed {
				boundary = "$default("
			}
			if !strings.Contains(fixed["main.vibe"], boundary) || len(result.Sites) != 0 {
				Gap(t, "FuzzNothrowCallPreservation", key, "missing preserving TypeScript call: %+v\n%s", result, fixed["main.vibe"])
			}
			after := toolsCompile(t, w, "FuzzNothrowCallPreservation", fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, "FuzzNothrowCallPreservation", key+":errors", "fixed source has errors: %+v", after.Diagnostics)
			}

			if runtimeCheck {
				stockFiles := maps.Clone(files)
				delete(stockFiles, "main.vibe")
				stockFiles["main.ts"] = files["main.vibe"]
				stock := toolsCompile(t, w, "FuzzNothrowCallPreservation", stockFiles)
				defer stock.Remove()
				if !toolsErrorFree(stock) {
					t.Fatalf("invalid stock twin: %+v", stock.Diagnostics)
				}
				if mismatch := toolsContractMismatch(t, w, stock, after, false); mismatch != "" {
					Gap(t, "FuzzNothrowCallPreservation", key+":api", "declarations changed: %s", mismatch)
				}
				node, err := NewNode(w.Dir)
				if err != nil {
					t.Fatal(err)
				}
				defer node.Close()
				was, is := node.Run(stock, "out/runner.js", "main"), node.Run(after, "out/runner.js", "main")
				if toolsInvalidOutcome(was) || toolsInvalidOutcome(is) || was.Kind != is.Kind || string(was.Value) != string(is.Value) {
					Gap(t, "FuzzNothrowCallPreservation", key+":runtime", "evaluation order/receiver/thrown identity changed: stock=%+v fixed=%+v", was, is)
				}
				again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
				if again.Err != nil || len(again.Sites) != 0 {
					t.Fatalf("second fix: %+v", again)
				}
				for name, file := range again.Files {
					relative := strings.TrimPrefix(name.AsString(), filepath.ToSlash(after.Dir)+"/")
					if prior, ok := fixed[relative]; ok && file.Text != prior {
						t.Fatalf("non-idempotent repair: %s", relative)
					}
				}
			}

			if boxed {
				if len(before.Outputs) == 0 {
					t.Fatal("original diagnostic-bearing fixture has no declaration oracle")
				}
				if mismatch := toolsContractMismatch(t, w, before, after, false); mismatch != "" {
					Gap(t, "FuzzNothrowCallPreservation", key+":api", "default changed the public contract: %s", mismatch)
				}
				again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
				if again.Err != nil || len(again.Sites) != 0 {
					t.Fatalf("second default fix: %+v", again)
				}
				for name, file := range again.Files {
					relative := strings.TrimPrefix(name.AsString(), filepath.ToSlash(after.Dir)+"/")
					if prior, ok := fixed[relative]; ok && prior != file.Text {
						t.Fatalf("default helper changed again: %s", relative)
					}
				}
			}
		})
	})
}
