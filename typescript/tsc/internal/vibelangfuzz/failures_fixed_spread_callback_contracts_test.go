package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const spreadCallbackContractsTarget = "FuzzFixedSpreadCallbackContracts"

var spreadCallbackContractsQuotes = []string{
	"A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, `@throws {unknown}` admits anything, and a parameter named by `@rethrows` admits anything.", "a parameter named by `@rethrows` admits anything", "| `/** @rethrows p */` | its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it |", "A function literal passed where the parameter's function type admits throws", "In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`."}

func assertFixedSpreadCallbackContractsRules(t testing.TB) {
	for _, q := range spreadCallbackContractsQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("callback contract changed: %s", q)
		}
	}
}
func TestFixedSpreadCallbackContractsQuoted(t *testing.T) { assertFixedSpreadCallbackContractsRules(t) }

func spreadCallbackKeys() []string {
	var keys []string
	for _, shape := range []string{"inline", "alias", "readonly", "optional"} {
		for _, bound := range []string{"never", "same", "other", "unknown", "rethrows"} {
			for _, source := range []string{"safe", "risky"} {
				for _, slot := range []string{"first", "rest"} {
					keys = append(keys, shape+":"+bound+":"+source+":"+slot)
				}
			}
		}
	}
	return keys
}
func spreadCallbackSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	shape, bound, callback, slot := parts[0], parts[1], parts[2], parts[3]
	boundDoc := ""
	switch bound {
	case "same":
		boundDoc = "/** @throws {RangeError} */\n"
	case "other":
		boundDoc = "/** @throws {string} */\n"
	case "unknown":
		boundDoc = "/** @throws {unknown} */\n"
	}
	doc := "/** @throws {never} */\n"
	if bound == "rethrows" {
		doc = "/** @throws {never} @rethrows cb */\n"
	}
	if choice&8 != 0 {
		doc = strings.Replace(doc, " */", "\n */", 1)
	}
	library := "export interface Handler{\n" + boundDoc + "():number\n}\n/** @throws {never} */\nexport declare function safe():number\n/** @throws {RangeError} */\nexport declare function risky():number\n"
	parameters := "cb:Handler"
	prefix := ""
	if shape == "optional" {
		parameters = "cb?:Handler"
	}
	if slot == "rest" {
		parameters = "other:()=>number,...cb:(Handler|undefined)[]"
		prefix = "safe,"
	} else if choice&1 != 0 {
		parameters = "other:()=>number," + parameters
		prefix = "safe,"
	}
	library += doc + "export declare function accept(" + parameters + "):number\n"
	element := callback
	if choice&2 != 0 {
		element = "(" + element + ")"
	}
	tuple := "[" + element + "] as const"
	setup := ""
	switch shape {
	case "alias":
		setup = "const args=[" + element + "] as const\n"
		tuple = "args"
	case "readonly":
		setup = "const args:readonly[typeof " + callback + "]=[" + element + "]\n"
		tuple = "args"
	case "optional":
		setup = "const args:[cb?:typeof " + callback + "]=[" + element + "]\n"
		tuple = "args"
	}
	if choice&4 != 0 {
		tuple = "(" + tuple + ")"
	}
	if slot == "rest" && choice&1 != 0 {
		prefix += "...([] as const),"
	}
	call := "accept(" + prefix + "..." + tuple + ")"
	want := 0
	if callback == "risky" && (bound == "never" || bound == "other") {
		want = 402
	}
	if choice&64 != 0 {
		return "import {Effect} from \"effect\"\nimport {accept,safe,risky} from \"./foreign.js\"\n" + setup + "export const value=Effect.try({try:()=>" + call + ",catch:(error:unknown)=>error})", library, 0
	}
	return "import {accept,safe,risky} from \"./foreign.js\"\n" + setup + "export function main(){try{return " + call + "}catch{return 0}}", library, want
}

func checkFixedSpreadCallbackContracts(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := spreadCallbackSource(key, choice)
	project := Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": "{\"type\":\"module\"}"}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"noEmit\":true},\"files\":[\"main.vibe\",\"foreign.d.ts\"]}"}
	result, err := w.Compile(t.Context(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var got []int
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		got = append(got, int(d.Code()))
		if !IsEK(d) || int(d.Code()) != want {
			Gap(t, spreadCallbackContractsTarget, key, "%q: unexpected %s", spreadCallbackContractsQuotes[0], describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, spreadCallbackContractsTarget, key, "%q: got %v, want EK%04d", spreadCallbackContractsQuotes[1], got, want)
	}
}
func TestFixedSpreadCallbackContracts(t *testing.T) {
	assertFixedSpreadCallbackContractsRules(t)
	w := NewWorkspace(t)
	for _, key := range spreadCallbackKeys() {
		t.Run(key, func(t *testing.T) { checkFixedSpreadCallbackContracts(t, w, key, 0) })
	}
}
func TestFixedSpreadCallbackContractVariants(t *testing.T) {
	assertFixedSpreadCallbackContractsRules(t)
	w := NewWorkspace(t)
	for _, key := range spreadCallbackKeys() {
		for _, choice := range []uint8{1, 2, 4, 8, 15, 64} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkFixedSpreadCallbackContracts(t, w, key, choice) })
		}
	}
}
func FuzzFixedSpreadCallbackContracts(f *testing.F) {
	startShortBudget(f)
	assertFixedSpreadCallbackContractsRules(f)
	keys := spreadCallbackKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkFixedSpreadCallbackContracts(t, w, key, choice)
	})
}
