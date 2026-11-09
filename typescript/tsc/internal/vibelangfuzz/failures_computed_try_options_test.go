package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const computedTryOptionsTarget = "FuzzComputedTryOptions"

var computedTryOptionsQuotes = []string{
	"A function literal passed where the parameter's function type admits throws",
	"`Effect.try` and `Effect.tryPromise` declare their thunk `@throws {unknown}` in both overloads",
	"A function nested in that literal is its own plain code.",
	"A `throw` statement or throw expression in the literal is still `EK0401`.",
	"A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`",
}

func assertComputedTryOptionsRules(t testing.TB) {
	for _, quote := range computedTryOptionsQuotes {
		if !strings.Contains(SpecText(failuresChapter), quote) {
			t.Fatalf("computed options contract changed: %s", quote)
		}
	}
}
func TestComputedTryOptionsQuoted(t *testing.T) { assertComputedTryOptionsRules(t) }

func computedTryOptionsKeys() []string {
	var keys []string
	for _, api := range []string{"try", "tryPromise"} {
		for _, spelling := range []string{"direct", "quoted", "computed", "parenthesized", "constant", "typed-key", "template", "key-call"} {
			for _, site := range []string{"thunk", "catch", "nested", "throw", "key-throws"} {
				keys = append(keys, api+":"+spelling+":"+site)
				keys = append(keys, api+":"+spelling+":"+site+":call", api+":"+spelling+":"+site+":apply")
			}
		}
	}
	return keys
}

// computedTryOptionsProject prints valid TypeScript options, with the same
// literal key regardless of its source spelling. Key evaluation stays outside
// the deferred thunk, and nested functions keep their own throw contract.
func computedTryOptionsProject(key string, choice uint8) (Project, int) {
	parts := strings.Split(key, ":")
	api, spelling, site := parts[0], parts[1], parts[2]
	property, decl := "try", ""
	switch spelling {
	case "quoted":
		property = "\"try\""
	case "computed":
		property = "[\"try\"]"
	case "parenthesized":
		property = "[(\"try\")]"
	case "constant":
		property, decl = "[name]", "const name=\"try\" as const\n"
	case "typed-key":
		property, decl = "[name]", "declare const name:\"try\"\n"
	case "template":
		property = "[`try`]"
	case "key-call":
		property = "[key()]"
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
/** @throws {never} */
export declare function key():"try"
/** @throws {RangeError} */
export declare function throwingKey():"try"
`
	want := 0
	body := expression
	if site == "catch" {
		body = "1"
	}
	if site == "nested" {
		body = "(()=>" + expression + ")()"
	}
	if api == "tryPromise" {
		body = "Promise.resolve(" + body + ")"
	}
	callback := "()=>" + body
	if choice&1 != 0 {
		callback = "function(){return " + body + "}"
	}
	if choice&2 != 0 {
		callback = "(" + callback + ")"
	}
	mapper := "(error:unknown)=>error"
	if site == "catch" {
		mapper = "(error:unknown)=>" + expression
	}
	if (site == "catch" || site == "nested") && contract != "never" {
		want = 1
	}
	if site == "throw" {
		callback = "()=>{throw new RangeError()}"
		want = 1
	}
	if site == "key-throws" {
		property = "[throwingKey()]"
		want = 1
	}
	callee := "Effect." + api
	if choice&64 != 0 {
		decl += "const bridge=" + callee + "\n"
		callee = "bridge"
	}
	argument := "{" + property + ":" + callback + ",catch:" + mapper + "}"
	if len(parts) > 3 {
		switch parts[3] {
		case "call":
			callee += ".call"
			argument = "undefined," + argument
		case "apply":
			callee += ".apply"
			argument = "undefined,[" + argument + "]"
		}
	}
	source := "import {Effect} from \"effect\"\nimport {risky,Input,tag,key,throwingKey} from \"./foreign.js\"\n" + decl + "export const value=" + callee + "(" + argument + ")"
	return Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": `{"type":"module"}`}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","foreign.d.ts"]}`}, want
}
func checkComputedTryOptions(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	project, want := computedTryOptionsProject(key, choice)
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
			Gap(t, computedTryOptionsTarget, key, "%q: unexpected %s", computedTryOptionsQuotes[0], describe(d))
		}
	}
	if len(errors) != want {
		Gap(t, computedTryOptionsTarget, key, "%q: got %v, want %d EK0401", computedTryOptionsQuotes[2], errors, want)
	}
}
func TestComputedTryOptions(t *testing.T) {
	assertComputedTryOptionsRules(t)
	w := NewWorkspace(t)
	for _, key := range computedTryOptionsKeys() {
		t.Run(key, func(t *testing.T) { checkComputedTryOptions(t, w, key, 0) })
	}
}
func TestComputedTryOptionsVariants(t *testing.T) {
	assertComputedTryOptionsRules(t)
	w := NewWorkspace(t)
	for _, key := range computedTryOptionsKeys() {
		for _, choice := range []uint8{1, 2, 4, 8, 16, 32, 64, 127} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkComputedTryOptions(t, w, key, choice) })
		}
	}
}
func FuzzComputedTryOptions(f *testing.F) {
	startShortBudget(f)
	assertComputedTryOptionsRules(f)
	keys := computedTryOptionsKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkComputedTryOptions(t, w, key, choice)
	})
}
