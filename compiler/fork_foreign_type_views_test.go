package compiler

import (
	"strings"
	"testing"
)

func TestPinnedForkForeignTypeViews(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	const foreign = `/** @module
 * @throws {never}
 */
export function call(value: string): string { throw new Error(value) }
export function receive(callback: () => void): void { callback() }
export const client = { get value(): string { throw new Error("getter") }, call(value: string): string { throw new Error(value) } };
/** @throws {never} */
export function trusted(value: string): string { return value }
/** @throws {never} */
export const trustedArrow = (value: string): string => value;
/** @throws {never} */
export const asyncArrow = async (): Promise<string> => "value";
export interface View { pick: { readonly value: string } }
`
	for _, tc := range []struct{ name, body, code string }{
		{"direct call", `return call(value)`, "VIBE1101"},
		{"cast callee", `return (call as (s:string)=>string)(value)`, "VIBE1101"},
		{"erased callee", `return (call as any)(value)`, "VIBE1101"},
		{"cast receiver", `return (client as {call(s:string):string}).call(value)`, "VIBE1101"},
		{"cast untrusted callback consumer", `(receive as (cb:()=>void)=>void)(()=>{}); return value`, "VIBE1509"},
		{"cast trusted function loses its marker", `return (trusted as (s:string)=>string)(value)`, "VIBE1101"},
		{"local object contains a foreign handle", `const holder={pick:client satisfies {readonly value:string}}; return holder.pick.value`, "VIBE1506"},
		{"nested local object contains a foreign handle", `const holder={nested:{pick:client}}; return holder.nested.pick.value`, "VIBE1506"},
		{"foreign shorthand in local object", `const holder={client}; return holder.client.value`, "VIBE1506"},
		{"element selected foreign handle", `const holder={pick:client}; const key="pick"; return holder[key].value`, "VIBE1506"},
		{"annotated local container", `const holder:{pick:{readonly value:string}}={pick:client}; return holder.pick.value`, "VIBE1506"},
		{"cast local container", `const holder={pick:client}; return (holder as {pick:{readonly value:string}}).pick.value`, "VIBE1506"},
		{"typed foreign function alias", `const alias:(s:string)=>string=call; return alias(value)`, "VIBE1101"},
		{"local method holds a foreign function", `const holder={call}; return holder.call(value)`, "VIBE1101"},
		{"destructured foreign function", `const holder={call}; const {call:alias}=holder; return alias(value)`, "VIBE1101"},
		{"destructured foreign handle", `const holder={client}; const {client:alias}=holder; return alias.value`, "VIBE1506"},
		{"typed local function is ordinary", `const local=(s:string)=>s; return (local as (s:string)=>string)(value)`, ""},
		{"local object is ordinary", `const holder={pick:{value}}; return holder.pick.value`, ""},
		{"a foreign type is not a foreign runtime value", `const holder:import("./foreign.js").View={pick:{value}}; return holder.pick.value`, ""},
		{"cyclic initializer terminates", `const cycle:()=>string=cycle(); return value`, "TS2322"},
		{"satisfies preserves the trusted declaration", `return (trusted satisfies (s:string)=>string)(value)`, ""},
		{"a trusted primitive still uses ordinary builtin methods", `return trusted(value).toUpperCase()`, ""},
		{"a trusted arrow retains its declaration marker", `return trustedArrow(value)`, ""},
		{"an async arrow cannot promise no rejection", `void asyncArrow(); return value`, "VIBE1502"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {call,receive,client,trusted,trustedArrow,asyncArrow} from "./foreign.js"; export function main(value:string):string{` + tc.body + `}`
			got, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, LanguageAnalysisRequest{Files: []SourceFile{
				{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}, {Path: "foreign.ts", Kind: FileKindTypeScript, Text: foreign},
			}})
			if err != nil {
				t.Fatal(err)
			}
			if tc.code == "" {
				if !got.Checked {
					t.Fatal(got.Diagnostics)
				}
				return
			}
			found := false
			for _, issue := range got.Diagnostics {
				found = found || issue.Code == tc.code
			}
			if got.Checked || !found {
				t.Fatalf("accepted/lost %s: %+v", tc.code, got)
			}
			if tc.code == "VIBE1101" && (len(got.Files) != 1 || len(got.Files[0].Functions) == 0 || strings.Join(got.Files[0].Functions[0].Failures, ",") != "Panic") {
				t.Fatalf("lost panic row: %+v", got.Files)
			}
		})
	}
}
