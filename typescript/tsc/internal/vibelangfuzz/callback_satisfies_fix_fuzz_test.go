package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const callbackSatisfiesFixKey = "key:callback-satisfies-fix\n"

func TestCallbackSatisfiesFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), satisfiesCallbackQuote) {
		t.Fatalf("Chapter 3 no longer says %q", satisfiesCallbackQuote)
	}
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationDeclarationFixQuote)
	}
}

// Supply old source shapes to FuzzFix's shared declaration and Exit oracle.
func callbackSatisfiesFixArchive(input string) string {
	key := strings.TrimPrefix(input, callbackSatisfiesFixKey)
	fields := strings.Split(key, ":")
	source := "risky"
	prefix := ""
	if len(fields) > 0 {
		switch fields[0] {
		case "property":
			source = "holder.read"
		case "element":
			source = "holder['read']"
		case "generic":
			source = "generic"
		case "alias":
			prefix = "const selected=risky;\n"
			source = "selected"
		}
	}
	if len(fields) > 1 && fields[1] == "parenthesized" {
		source = "(" + source + ")"
	}
	if len(fields) > 2 && fields[2] == "shadow" {
		prefix += "const $Callback=1;const $callback$ts=2;const $Type=3;\n"
	}
	main := "import {risky,generic,holder,inspect} from './lib.js'\n" + prefix +
		"export const checked=" + source + " satisfies ((n:number)=>number)\n" +
		"export effect function main(){return try inspect(checked)}\n"
	lib := `import {Effect} from "effect"
const events:string[]=[]
const defect=new RangeError("callback")
/** @throws {RangeError} */
export function risky(n:number):number{events.push("risky");throw defect}
/** @throws {RangeError} */
export function generic<T>(n:T):T{events.push("generic");throw defect}
export const holder={
 get read():typeof risky{events.push("getter");return risky}
}
export interface Thrower {
/** @throws {unknown} */
(n:number):number
}
export function inspect(callback:Thrower){
 return Effect.map(Effect.exit(Effect.sync(()=>callback(7))),exit=>{
  if(exit._tag==="Success")return ["Success",exit.value,events.slice()]
  const reason=exit.cause.reasons[0]
  return [reason._tag,reason._tag==="Die"&&reason.defect===defect,events.slice()]
 })
}
`
	return Archive(map[string]string{"main.vibe": main, "lib.ts": lib})
}

// The original is a legacy input with exactly its rejected constraint.
// FuzzFix still performs the shared bidirectional API and runtime checks.
func callbackSatisfiesFixRunnable(r *Result) bool {
	found := false
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Code() != 402 {
			return false
		}
		found = true
	}
	return found
}
