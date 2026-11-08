package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const nestedWrapperTarget = "FuzzNestedWrapperContract"

var nestedWrapperQuotes = []string{
	"(nested source callables keep their own contexts)",
	"In an effectful function's parameter list a default whose thrown type is not `never` is `EK0401`",
	"| no tag | `unknown` |",
	"| In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |",
}

func assertNestedWrapperRules(t testing.TB) {
	for _, q := range nestedWrapperQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("nested wrapper rule changed: %s", q)
		}
	}
}
func TestNestedWrapperContractQuoted(t *testing.T) { assertNestedWrapperRules(t) }

func nestedWrapperKeys() []string {
	var keys []string
	for _, wrapper := range []string{"Effect.sync", "Effect.promise", "capture"} {
		for _, shape := range []string{"function", "arrow", "block", "default", "direct-function", "direct-arrow"} {
			if wrapper == "Effect.promise" && strings.HasPrefix(shape, "direct-") {
				continue
			}
			for _, contract := range []string{"untagged", "RangeError", "never"} {
				keys = append(keys, wrapper+":"+shape+":"+contract)
			}
		}
	}
	return keys
}

func checkNestedWrapperContract(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	parts := strings.Split(key, ":")
	wrapper, shape, contract := parts[0], parts[1], parts[2]
	annotation := ""
	if contract != "untagged" {
		annotation = "/** @throws {" + contract + "} */\n"
	}
	lib := annotation + "export function foreign(): number { return 1 }\n"
	invocation := "foreign()"
	if choice&1 != 0 {
		invocation = "do { foreign() }"
	}
	expr := ""
	switch shape {
	case "function", "direct-function":
		expr = "effect function nested() { return " + invocation + " }"
	case "arrow", "direct-arrow":
		expr = "effect () => " + invocation
	case "block":
		expr = "effect { return " + invocation + " }"
	case "default":
		expr = "effect function nested(value = " + invocation + ") { return value }"
	}
	if choice&2 != 0 {
		expr = "(() => (" + expr + "))()"
	}
	if wrapper == "Effect.promise" {
		expr = "Promise.resolve(" + expr + ")"
	}
	argument := "() => { return " + expr + " }"
	if strings.HasPrefix(shape, "direct-") {
		argument = expr
	}
	source := "import {foreign} from \"./foreign.js\"\nimport {sync as capture} from \"effect/Effect\"\nexport const probe = " + wrapper + "(" + argument + ")\n"
	config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","foreign.ts"]}`
	result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "foreign.ts": lib, "package.json": `{"type":"module"}`}, Config: config})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	want := 0
	if contract != "never" {
		want = 1
	}
	code := int32(403)
	if shape == "default" {
		code = 401
	}
	var errors []string
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		errors = append(errors, describe(d))
		if contract == "never" || !IsEK(d) || d.Code() != code {
			Gap(t, nestedWrapperTarget, key, "VIP-4 %q: unexpected %s", nestedWrapperQuotes[0], describe(d))
		}
	}
	if len(errors) != want {
		Gap(t, nestedWrapperTarget, key, "VIP-4 %q: got %v, want %d EK%04d", nestedWrapperQuotes[0], errors, want, code)
	}
}
func TestNestedWrapperContract(t *testing.T) {
	assertNestedWrapperRules(t)
	w := NewWorkspace(t)
	for _, key := range nestedWrapperKeys() {
		t.Run(key, func(t *testing.T) { checkNestedWrapperContract(t, w, key, 0) })
	}
}
func FuzzNestedWrapperContract(f *testing.F) {
	startShortBudget(f)
	assertNestedWrapperRules(f)
	keys := nestedWrapperKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkNestedWrapperContract(t, w, key, choice)
	})
}
