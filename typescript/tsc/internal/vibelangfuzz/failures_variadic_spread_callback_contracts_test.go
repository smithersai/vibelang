package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

func variadicSpreadKeys() []string {
	var keys []string
	for _, shape := range []string{"saved", "inline", "readonly", "alias"} {
		for _, bound := range []string{"never", "same", "other", "unknown", "rethrows", "own"} {
			for _, source := range []string{"safe", "risky", "unknown", "any"} {
				keys = append(keys, shape+":"+bound+":"+source)
			}
		}
	}
	return keys
}
func variadicSpreadSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	shape, bound, callback := parts[0], parts[1], parts[2]
	boundDoc := ""
	switch bound {
	case "same":
		boundDoc = "/** @throws {RangeError} */\n"
	case "other":
		boundDoc = "/** @throws {string} */\n"
	case "unknown":
		boundDoc = "/** @throws {unknown} */\n"
	}
	library := "export interface Handler {\n" + boundDoc + "():number\n}\n"
	for _, name := range []string{"safe", "risky", "unknown", "any"} {
		thrown := name
		switch name {
		case "safe":
			thrown = "never"
		case "risky":
			thrown = "RangeError"
		}
		library += "/** @throws {" + thrown + "} */\nexport declare function " + name + "():number\n"
	}
	receiver := ""
	if choice&4 != 0 {
		receiver = "this:void,"
	}
	parameters := receiver
	prefix := ""
	if choice&1 != 0 {
		parameters += "label:number,"
		prefix = "1,"
	}
	target := "Handler"
	if bound == "own" {
		target = "typeof " + callback
	}
	parameters += "...callbacks:" + target + "[]"
	doc := "/** @throws {never} */\n"
	if bound == "rethrows" {
		doc = "/** @throws {never}\n * @rethrows callbacks\n */\n"
	}
	if choice&8 != 0 {
		library += "export declare class Holder {\n" + doc + "constructor(" + strings.TrimPrefix(parameters, receiver) + ");\nreadonly value:number\n}\n"
	} else {
		library += doc + "export declare function strict(" + parameters + "):number\n"
	}
	element := callback
	if choice&2 != 0 {
		element = "(" + element + ")"
	}
	setup := "const args=[" + element + "]\n"
	array := "args"
	switch shape {
	case "inline":
		setup = ""
		array = "[" + element + "]"
	case "readonly":
		setup = "const args:ReadonlyArray<typeof " + callback + ">=[" + element + "]\n"
	case "alias":
		setup = "type Inputs=Array<typeof " + callback + ">\nconst args:Inputs=[" + element + "]\n"
	}
	if choice&16 != 0 {
		array = "(" + array + ")"
	}
	call := "strict(" + prefix + "..." + array + ")"
	imported := "strict"
	if choice&8 != 0 {
		call = "new Holder(" + prefix + "..." + array + ").value"
		imported = "Holder"
	}
	want := 0
	if callback != "safe" && bound != "unknown" && bound != "rethrows" && bound != "own" {
		if bound == "never" || callback == "unknown" || bound == "other" && callback == "risky" {
			want = 402
		}
	}
	source := "import {" + imported + ",safe,risky,unknown,any} from \"./foreign.js\"\n" + setup
	if choice&64 != 0 {
		return "import {Effect} from \"effect\"\n" + source + "export const value=Effect.try({try:()=>" + call + ",catch:(error:unknown)=>error})", library, 0
	}
	return source + "export function main(){try{return " + call + "}catch{return 0}}", library, want
}

const variadicSpreadTarget = "FuzzVariadicSpreadCallbackContracts"
const variadicSpreadQuote = "A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, `@throws {unknown}` admits anything, and a parameter named by `@rethrows` admits anything."

func assertVariadicSpreadRule(t testing.TB) {
	if !strings.Contains(SpecText(failuresChapter), variadicSpreadQuote) {
		t.Fatalf("callback assignability changed: %s", variadicSpreadQuote)
	}
}
func TestVariadicSpreadCallbackContractsQuoted(t *testing.T) { assertVariadicSpreadRule(t) }
func checkVariadicSpread(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := variadicSpreadSource(key, choice)
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
			Gap(t, variadicSpreadTarget, key, "%q: unexpected %s", variadicSpreadQuote, describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, variadicSpreadTarget, key, "%q: got %v, want EK%04d", variadicSpreadQuote, got, want)
	}
}
func TestVariadicSpreadCallbackContracts(t *testing.T) {
	assertVariadicSpreadRule(t)
	w := NewWorkspace(t)
	for _, key := range variadicSpreadKeys() {
		t.Run(key, func(t *testing.T) { checkVariadicSpread(t, w, key, 0) })
	}
}
func TestVariadicSpreadCallbackContractVariants(t *testing.T) {
	assertVariadicSpreadRule(t)
	w := NewWorkspace(t)
	for _, key := range variadicSpreadKeys() {
		for _, choice := range []uint8{1, 2, 4, 8, 31, 64} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkVariadicSpread(t, w, key, choice) })
		}
	}
}
func FuzzVariadicSpreadCallbackContracts(f *testing.F) {
	startShortBudget(f)
	assertVariadicSpreadRule(f)
	keys := variadicSpreadKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkVariadicSpread(t, w, key, choice)
	})
}
