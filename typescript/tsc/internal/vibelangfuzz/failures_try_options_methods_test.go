package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const tryOptionsMethodsTarget = "FuzzTryOptionsMethods"

var tryOptionsMethodsQuotes = []string{
	"plain methods, constructors, accessors, plain generators",
	"A function literal passed where the parameter's function type admits throws",
	"`Effect.try` and `Effect.tryPromise` declare their thunk `@throws {unknown}` in both overloads",
	"A function nested in that literal is its own plain code.",
	"A `throw` statement or throw expression in the literal is still `EK0401`.",
}

func assertTryOptionsMethodsRules(t testing.TB) {
	for _, quote := range tryOptionsMethodsQuotes {
		if !strings.Contains(SpecText(failuresChapter), quote) {
			t.Fatalf("method callback rule changed: %s", quote)
		}
	}
}
func TestTryOptionsMethodsQuoted(t *testing.T) { assertTryOptionsMethodsRules(t) }
func tryOptionsMethodsKeys() []string {
	var keys []string
	for _, api := range []string{"try", "tryPromise"} {
		for _, invoke := range []string{"direct", "call", "apply"} {
			for _, spelling := range []string{"identifier", "quoted", "computed", "constant"} {
				for _, site := range []string{"thunk", "catch", "nested", "throw", "async", "key-throws"} {
					keys = append(keys, api+":"+invoke+":"+spelling+":"+site)
				}
			}
		}
	}
	return keys
}
func tryOptionsMethodsProject(key string, choice uint8) (Project, int) {
	parts := strings.Split(key, ":")
	api, invoke, spelling, site := parts[0], parts[1], parts[2], parts[3]
	property, decl := "try", ""
	switch spelling {
	case "quoted":
		property = "\"try\""
	case "computed":
		property = "[\"try\"]"
	case "constant":
		property, decl = "[name]", "const name=\"try\" as const\n"
	}
	if choice&128 != 0 {
		property = "[(name)]"
		if decl == "" {
			decl = "const name=\"try\" as const\n"
		}
	}
	contract := "RangeError"
	if choice&4 != 0 {
		contract = "never"
	}
	expression := "risky()"
	switch {
	case choice&8 != 0:
		expression = "JSON.parse(\"1\") as number"
		contract = "RangeError"
	case choice&16 != 0:
		expression = "new Input().value"
	case choice&32 != 0:
		expression = "tag`value`"
	}
	library := `/** @throws {` + contract + `} */
export declare function risky():number
export declare class Input {
/** @throws {` + contract + `} */
constructor()
value:number
}
/** @throws {` + contract + `} */
export declare function tag(parts:TemplateStringsArray):number
/** @throws {RangeError} */
export declare function throwingKey():"try"
`
	body, want, prefix := expression, 0, ""
	if site == "catch" {
		body = "1"
	}
	if site == "nested" {
		body = "(()=>" + expression + ")()"
	}
	if api == "tryPromise" {
		body = "Promise.resolve(" + body + ")"
	}
	body = "return " + body
	if (site == "catch" || site == "nested") && contract != "never" {
		want = 1
	}
	if site == "throw" {
		body = "throw new RangeError()"
		want = 1
	}
	if site == "async" {
		prefix = "async "
		body = "return " + expression
	}
	if site == "key-throws" {
		property = "[throwingKey()]"
		want = 1
	}
	mapper := "return error"
	if site == "catch" {
		mapper = "return " + expression
	}
	parameters := ""
	if choice&1 != 0 {
		parameters = "<T>"
	}
	argument := "{" + prefix + property + parameters + "(){" + body + "},catch(error:unknown){" + mapper + "}}"
	callee := "Effect." + api
	if choice&64 != 0 {
		decl += "const bridge=" + callee + "\n"
		callee = "bridge"
	}
	if choice&2 != 0 {
		callee = "(" + callee + ")"
		argument = "(" + argument + ")"
	}
	switch invoke {
	case "call":
		callee += ".call"
		argument = "undefined," + argument
	case "apply":
		callee += ".apply"
		argument = "undefined,[" + argument + "]"
	}
	source := "import {Effect} from \"effect\"\nimport {risky,Input,tag,throwingKey} from \"./foreign.js\"\n" + decl + "export const value=" + callee + "(" + argument + ")"
	return Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": `{"type":"module"}`}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","foreign.d.ts"]}`}, want
}
func checkTryOptionsMethods(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	project, want := tryOptionsMethodsProject(key, choice)
	result, err := w.Compile(t.Context(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var errors []string
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		errors = append(errors, describe(d))
		if want == 0 || !IsEK(d) || d.Code() != 401 {
			Gap(t, tryOptionsMethodsTarget, key, "%q: unexpected %s", tryOptionsMethodsQuotes[1], describe(d))
		}
	}
	if len(errors) != want {
		Gap(t, tryOptionsMethodsTarget, key, "%q: got %v,want %d EK0401", tryOptionsMethodsQuotes[3], errors, want)
	}
}
func TestTryOptionsMethods(t *testing.T) {
	assertTryOptionsMethodsRules(t)
	w := NewWorkspace(t)
	for _, key := range tryOptionsMethodsKeys() {
		t.Run(key, func(t *testing.T) { checkTryOptionsMethods(t, w, key, 0) })
	}
}
func TestTryOptionsMethodsVariants(t *testing.T) {
	assertTryOptionsMethodsRules(t)
	w := NewWorkspace(t)
	for _, key := range tryOptionsMethodsKeys() {
		for _, choice := range []uint8{1, 2, 4, 8, 16, 32, 64, 255} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkTryOptionsMethods(t, w, key, choice) })
		}
	}
}
func FuzzTryOptionsMethods(f *testing.F) {
	startShortBudget(f)
	assertTryOptionsMethodsRules(f)
	keys := tryOptionsMethodsKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkTryOptionsMethods(t, w, key, choice)
	})
}
