package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const callbackUnionTarget = "FuzzCallbackUnionAdmission"

var callbackUnionQuotes = []string{
	"A function literal passed where the parameter's function type admits throws",
	"A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`",
	"without `@throws`, they admit only `never`",
}

func assertCallbackUnionRules(t testing.TB) {
	for _, quote := range callbackUnionQuotes {
		if !strings.Contains(SpecText(failuresChapter), quote) {
			t.Fatalf("callback admission rule changed: %s", quote)
		}
	}
}
func TestCallbackUnionAdmissionQuoted(t *testing.T) { assertCallbackUnionRules(t) }
func callbackUnionKeys() []string {
	var keys []string
	for _, shape := range []string{"direct", "object-union", "optional", "optional-parameter", "callable-union", "intersection", "tuple", "denied-object", "denied-direct", "untagged-union", "untagged-direct"} {
		for _, contract := range []string{"RangeError", "never", "builtin"} {
			keys = append(keys, shape+":"+contract)
		}
	}
	return keys
}
func checkCallbackUnionAdmission(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	parts := strings.Split(key, ":")
	shape, contract := parts[0], parts[1]
	parameters := map[string]string{
		"direct":             "input:Allowed",
		"object-union":       "input:Allowed|{label:string}",
		"optional":           "input:Allowed|undefined",
		"optional-parameter": "input?:Allowed",
		"callable-union":     "input:Allowed|Denied",
		"intersection":       "input:Allowed&{readonly label?:string}",
		"tuple":              "...args:[input:Allowed|{label:string}]",
		"denied-object":      "input:Denied|{label:string}",
		"denied-direct":      "input:Denied",
		"untagged-union":     "input:(()=>number)|{label:string}",
		"untagged-direct":    "input:()=>number",
	}[shape]
	tag := contract
	if tag == "builtin" {
		tag = "RangeError"
	}
	lib := `export type Allowed={
/** @throws {unknown} */
():number
}
export type Denied={
/** @throws {never} */
():number
}
/** @throws {` + tag + `} */
export declare function risky():number
/** @throws {never} */
export declare function invoke(` + parameters + `):number
`
	expr := "risky()"
	if contract == "builtin" {
		expr = "JSON.parse(\"1\") as number"
	}
	if choice&1 != 0 {
		expr = "do { " + expr + " }"
	}
	callback := "() => " + expr
	if choice&2 != 0 {
		callback = "function () {return " + expr + "}"
	}
	if choice&4 != 0 {
		callback = "(" + callback + ")"
	}
	source := "import {invoke,risky} from \"./foreign.js\"\nexport const value=invoke(" + callback + ")\n"
	result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": lib, "package.json": `{"type":"module"}`}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","foreign.d.ts"]}`})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	want := 0
	if (strings.HasPrefix(shape, "denied") || strings.HasPrefix(shape, "untagged")) && contract != "never" {
		want = 1
	}
	var errors []string
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		errors = append(errors, describe(d))
		if want == 0 || !IsEK(d) || d.Code() != 401 {
			Gap(t, callbackUnionTarget, key, "VIP-4 %q: unexpected %s", callbackUnionQuotes[0], describe(d))
		}
	}
	if len(errors) != want {
		Gap(t, callbackUnionTarget, key, "VIP-4 %q: got %v, want %d EK0401", callbackUnionQuotes[0], errors, want)
	}
}
func TestCallbackUnionAdmission(t *testing.T) {
	assertCallbackUnionRules(t)
	w := NewWorkspace(t)
	for _, key := range callbackUnionKeys() {
		t.Run(key, func(t *testing.T) { checkCallbackUnionAdmission(t, w, key, 0) })
	}
}
func FuzzCallbackUnionAdmission(f *testing.F) {
	startShortBudget(f)
	assertCallbackUnionRules(f)
	keys := callbackUnionKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkCallbackUnionAdmission(t, w, key, choice)
	})
}
