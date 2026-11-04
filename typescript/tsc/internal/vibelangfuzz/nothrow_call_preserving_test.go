package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
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
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, value int8) {
		toolsGuard(t, "FuzzNothrowCallPreservation", func() {
			text := fmt.Sprintf("%q", fmt.Sprint(value))
			source := ""
			refuse := false
			switch key {
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
			before := toolsCompile(t, w, "FuzzNothrowCallPreservation", files)
			defer before.Remove()
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
				if strings.Contains(fixed["main.vibe"], "$invoke(") || len(result.Sites) == 0 {
					Gap(t, "FuzzNothrowCallPreservation", key, "unsupported call must refuse at its site")
				}
				return
			}
			if !strings.Contains(fixed["main.vibe"], "$invoke(") || len(result.Sites) != 0 {
				Gap(t, "FuzzNothrowCallPreservation", key, "missing preserving TypeScript call: %+v\n%s", result, fixed["main.vibe"])
			}
			after := toolsCompile(t, w, "FuzzNothrowCallPreservation", fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, "FuzzNothrowCallPreservation", key+":errors", "fixed source has errors: %+v", after.Diagnostics)
			}
		})
	})
}
