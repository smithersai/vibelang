package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const transparentTryTarget = "FuzzTransparentTryArguments"

var transparentTryQuotes = []string{"A function literal passed where the parameter\x27s function type admits throws", "`Effect.try` and `Effect.tryPromise` declare their thunk `@throws {unknown}` in both overloads", "A function nested in that literal is its own plain code.", "A `throw` statement or throw expression in the literal is still `EK0401`."}

func assertTransparentTryRules(t testing.TB) {
	for _, q := range transparentTryQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("throwing callback rule changed: %s", q)
		}
	}
}
func TestTransparentTryArgumentsQuoted(t *testing.T) { assertTransparentTryRules(t) }

func transparentTryKeys() []string {
	var keys []string
	for _, api := range []string{"try", "tryPromise"} {
		for _, invoke := range []string{"direct", "call", "apply"} {
			for _, place := range []string{"function", "property", "object", "apply-array"} {
				if place == "apply-array" && invoke != "apply" {
					continue
				}
				if place == "function" && invoke != "direct" {
					continue
				}
				for _, site := range []string{"thunk", "nested", "throw", "catch"} {
					if place == "function" && site == "catch" {
						continue
					}
					keys = append(keys, strings.Join([]string{api, invoke, place, site}, ":"))
				}
			}
		}
	}
	return keys
}
func transparentTrySource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	api, invoke, place, site := parts[0], parts[1], parts[2], parts[3]
	contract := "RangeError"
	if choice&8 != 0 {
		contract = "never"
	}
	expression := "risky()"
	if choice&16 != 0 {
		expression = "JSON.parse(\"1\") as number"
		contract = "RangeError"
	} else if choice&32 != 0 {
		expression = "new Input().value"
	} else if choice&64 != 0 {
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
`
	want := 0
	body := expression
	if site == "nested" {
		body = "(()=>" + expression + ")()"
		if contract != "never" {
			want = 1
		}
	}
	if site == "catch" {
		body = "1"
		if contract != "never" {
			want = 1
		}
	}
	valueType := "number"
	if api == "tryPromise" {
		body = "Promise.resolve(" + body + ")"
		valueType = "Promise<number>"
	}
	body = "return " + body
	if site == "throw" {
		body = "throw new RangeError()"
		want = 1
	}
	callback := "()=>{" + body + "}"
	functionType := "()=>" + valueType
	objectType := "{try:" + functionType + ",catch:(error:unknown)=>unknown}"
	wrap := func(value, typ string) string {
		switch choice & 3 {
		case 0:
			return "((" + value + ") as (" + typ + "))"
		case 1:
			return "((" + value + ") satisfies (" + typ + "))"
		case 2:
			return "((" + value + ")!)"
		default:
			return "(<(" + typ + ")>(" + value + "))"
		}
	}
	if place == "function" || place == "property" {
		callback = wrap(callback, functionType)
	}
	mapper := "error"
	if site == "catch" {
		mapper = expression
	}
	arg := callback
	if place != "function" {
		arg = "{try:" + callback + ",catch:(error:unknown)=>{" + "return " + mapper + "}}"
	}
	if place == "object" {
		arg = wrap(arg, objectType)
	}
	callee := "Effect." + api
	switch invoke {
	case "call":
		callee += ".call"
		arg = "undefined," + arg
	case "apply":
		callee += ".apply"
		arg = "[" + arg + "]"
		if place == "apply-array" {
			arg = wrap(arg, "["+objectType+"]")
		}
		arg = "undefined," + arg
	}
	source := "import {Effect} from \"effect\"\nimport {risky,Input,tag} from \"./foreign.js\"\nexport const value=" + callee + "(" + arg + ")"
	return source, library, want
}

func checkTransparentTryArguments(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := transparentTrySource(key, choice)
	project := Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": `{"type":"module"}`}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","foreign.d.ts"]}`}
	result, err := w.Compile(t.Context(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	got := 0
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		got++
		if !IsEK(d) || d.Code() != 401 || want == 0 {
			Gap(t, transparentTryTarget, key, "%q: unexpected %s", transparentTryQuotes[0], describe(d))
		}
	}
	if got != want {
		Gap(t, transparentTryTarget, key, "%q: got %d errors, want %d EK0401", transparentTryQuotes[2], got, want)
	}
}
func TestTransparentTryArguments(t *testing.T) {
	assertTransparentTryRules(t)
	w := NewWorkspace(t)
	for _, key := range transparentTryKeys() {
		t.Run(key, func(t *testing.T) { checkTransparentTryArguments(t, w, key, 0) })
	}
}
func TestTransparentTryArgumentsVariants(t *testing.T) {
	assertTransparentTryRules(t)
	w := NewWorkspace(t)
	for _, key := range transparentTryKeys() {
		for _, choice := range []uint8{1, 2, 3, 8, 16, 32, 64, 255} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkTransparentTryArguments(t, w, key, choice) })
		}
	}
}
func FuzzTransparentTryArguments(f *testing.F) {
	startShortBudget(f)
	assertTransparentTryRules(f)
	keys := transparentTryKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkTransparentTryArguments(t, w, key, choice)
	})
}
