package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const wrapperIdentityTarget = "FuzzWrapperSignatureIdentity"

var wrapperIdentityQuotes = []string{
	"A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`",
	"A function literal passed where the parameter's function type admits throws",
	"`Effect.try` and `Effect.tryPromise` declare their thunk `@throws {unknown}` in both overloads",
	"So `sync(() => parse(s))` is an error.",
	"Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives.",
}

func assertWrapperIdentityRules(t testing.TB) {
	for _, quote := range wrapperIdentityQuotes {
		if !strings.Contains(SpecText(failuresChapter), quote) {
			t.Fatalf("wrapper admission rule changed: %s", quote)
		}
	}
}
func TestWrapperSignatureIdentityQuoted(t *testing.T) { assertWrapperIdentityRules(t) }

func wrapperIdentityKeys() []string {
	var keys []string
	for _, binding := range []string{"implicit", "named", "namespace", "alias", "constant", "parameter", "imported", "admitting", "forbidding", "sync-alias", "promise-alias", "mixed-sync-alias", "mixed-promise-alias", "spread-copy", "spread-empty-after", "spread-empty-before", "spread-explicit-before", "spread-explicit-after", "spread-overwritten-safe", "spread-overwritten-unsafe", "spread-mixed", "spread-computed"} {
		for _, api := range []string{"try", "tryPromise"} {
			for _, contract := range []string{"RangeError", "never", "builtin"} {
				keys = append(keys, binding+":"+api+":"+contract)
			}
		}
	}
	for _, binding := range []string{"element-bind", "key-bind", "fake-element-bind"} {
		for _, api := range []string{"try", "tryPromise"} {
			for _, contract := range []string{"RangeError", "never", "builtin"} {
				keys = append(keys, binding+":"+api+":"+contract)
			}
		}
	}
	return keys
}
func checkWrapperSignatureIdentity(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	parts := strings.Split(key, ":")
	binding, api, contract := parts[0], parts[1], parts[2]
	tag := contract
	if tag == "builtin" {
		tag = "RangeError"
	}
	library := `/** @throws {` + tag + `} */
export declare function risky():number
type Input<T> = (()=>T) | {try:()=>T;catch:(error:unknown)=>unknown}
export declare const Fake:{try(input:Input<number>):number;tryPromise(input:Input<Promise<number>>):Promise<number>}
export type Allowed<T>={
/** @throws {unknown} */
():T
}
type Forbidden<T>={
/** @throws {never} */
():T
}
type ForbiddenInput<T> = Forbidden<T> | {try:Forbidden<T>;catch:(error:unknown)=>unknown}
export declare const Forbidding:{try(input:ForbiddenInput<number>):number;tryPromise(input:ForbiddenInput<Promise<number>>):Promise<number>}
type Admitted<T> = Allowed<T> | {try:Allowed<T>;catch:(error:unknown)=>unknown}
export declare const Admitting:{try(input:Admitted<number>):number;tryPromise(input:Admitted<Promise<number>>):Promise<number>}
`
	imports := "import {risky,Fake} from \"./foreign.js\"\n"
	declaration := ""
	switch binding {
	case "named":
		imports += "import {Effect} from \"effect\"\n"
	case "namespace":
		imports += "import * as Effect from \"effect/Effect\"\n"
	case "alias":
		imports += "import {Effect as Original} from \"effect\"\n"
		declaration = "const Effect=Original\n"
	case "spread-copy", "spread-empty-after", "spread-empty-before", "spread-explicit-before", "spread-explicit-after", "spread-overwritten-safe", "spread-overwritten-unsafe", "spread-mixed", "spread-computed":
		imports += "import {Effect as Original} from \"effect\"\n"
		object := "{...Original}"
		switch binding {
		case "spread-empty-after":
			object = "{...Original,...{}}"
		case "spread-empty-before":
			object = "{...{},...Original}"
		case "spread-explicit-before":
			object = "{" + api + ":Original." + api + ",...{}}"
		case "spread-explicit-after":
			object = "{...{}," + api + ":Original." + api + "}"
		case "spread-overwritten-safe":
			object = "{...{" + api + ":Fake." + api + "},...Original}"
		case "spread-overwritten-unsafe":
			object = "{...Original,...{" + api + ":Fake." + api + "}}"
		case "spread-mixed":
			declaration = "declare const flag:boolean\n"
			object = "{...Original,...(flag?{" + api + ":Fake." + api + "}:{" + api + ":Original." + api + "})}"
		case "spread-computed":
			object = "{...{},[\"" + api + "\"]:Original." + api + "}"
		}
		declaration += "const Effect=" + object + "\n"
	case "sync-alias", "promise-alias":
		imports += "import {Effect as Original} from \"effect\"\n"
		actual := "sync"
		if binding == "promise-alias" || binding == "mixed-promise-alias" {
			actual = "promise"
		}
		declaration = "const Effect={try:Original." + actual + ",tryPromise:Original." + actual + "}\n"
	case "mixed-sync-alias", "mixed-promise-alias":
		imports += "import {Effect as Original} from \"effect\"\nimport {choice} from \"./foreign.js\"\n"
		library += "export declare const choice:boolean\n"
		denied, allowed := "Original.sync<number>", "Original.try<number>"
		if api == "tryPromise" {
			denied, allowed = "Original.sync<Promise<number>>", "Original.try<Promise<number>>"
		}
		if binding == "mixed-promise-alias" {
			denied, allowed = "Original.promise<number>", "Original.tryPromise<number>"
		}
		declaration = "const Effect={" + api + ":choice?" + denied + ":" + allowed + "}\n"
	case "element-bind", "key-bind", "fake-element-bind":
		imports += "import {Effect as Original} from \"effect\"\n"
		declaration = "const Effect={" + api + ":Original." + api + "[\"bind\"](undefined)}\n"
		if binding == "key-bind" {
			declaration = "const key=\"bind\" as const\nconst Effect={" + api + ":Original." + api + "[key](undefined)}\n"
		}
		if binding == "fake-element-bind" {
			declaration = "const local={bind(_this:undefined){return Fake." + api + "}}\nconst Effect={" + api + ":local[\"bind\"](undefined)}\n"
		}
	case "constant":
		declaration = "const Effect=Fake\n"
	case "imported":
		imports += "import {Fake as Effect} from \"./foreign.js\"\n"
	case "forbidding":
		imports += "import {Forbidding as Effect} from \"./foreign.js\"\n"
	case "admitting":
		imports += "import {Admitting as Effect} from \"./foreign.js\"\n"
	}
	expr := "risky()"
	if contract == "builtin" {
		expr = "JSON.parse(\"1\") as number"
	}
	if api == "tryPromise" || (binding == "promise-alias" || binding == "mixed-promise-alias") {
		expr = "Promise.resolve(" + expr + ")"
	}
	callback := "() => " + expr
	if choice&1 != 0 {
		callback = "function () {return " + expr + "}"
	}
	if choice&2 != 0 {
		callback = "(" + callback + ")"
	}
	if choice&4 != 0 && binding != "sync-alias" && binding != "promise-alias" && binding != "mixed-sync-alias" && binding != "mixed-promise-alias" {
		callback = "{try:" + callback + ",catch:(error)=>error}"
	}
	call := "Effect." + api + "(" + callback + ")"
	source := imports + declaration + "export const value=" + call + "\n"
	if binding == "parameter" {
		source = imports + "export function value(Effect:typeof Fake){return " + call + "}\n"
	}
	result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": `{"type":"module"}`}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","foreign.d.ts"]}`})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	want := 0
	if (binding == "constant" || binding == "parameter" || binding == "imported" || binding == "forbidding" || binding == "sync-alias" || binding == "promise-alias" || binding == "mixed-sync-alias" || binding == "mixed-promise-alias" || binding == "spread-overwritten-unsafe" || binding == "spread-mixed") && contract != "never" {
		want = 1
	}
	if binding == "fake-element-bind" && contract != "never" {
		want = 1
	}
	var errors []string
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		errors = append(errors, describe(d))
		if want == 0 || !IsEK(d) || d.Code() != 401 {
			Gap(t, wrapperIdentityTarget, key, "VIP-4 %q: unexpected %s", wrapperIdentityQuotes[0], describe(d))
		}
	}
	if len(errors) != want {
		Gap(t, wrapperIdentityTarget, key, "VIP-4 %q: got %v, want %d EK0401", wrapperIdentityQuotes[1], errors, want)
	}
}
func TestWrapperSignatureIdentity(t *testing.T) {
	assertWrapperIdentityRules(t)
	w := NewWorkspace(t)
	for _, key := range wrapperIdentityKeys() {
		t.Run(key, func(t *testing.T) { checkWrapperSignatureIdentity(t, w, key, 0) })
	}
}
func FuzzWrapperSignatureIdentity(f *testing.F) {
	startShortBudget(f)
	assertWrapperIdentityRules(f)
	keys := wrapperIdentityKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkWrapperSignatureIdentity(t, w, key, choice)
	})
}
