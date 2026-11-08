package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const nativeTryForwardingTarget = "FuzzNativeTryForwarding"

var nativeTryForwardingQuotes = []string{
	"A function literal passed where the parameter's function type admits throws",
	"`Effect.try` and `Effect.tryPromise` declare their thunk `@throws {unknown}` in both overloads",
	"A function nested in that literal is its own plain code.",
	"So `sync(() => parse(s))` is an error.",
	"A `throw` statement or throw expression in the literal is still `EK0401`.",
}

func assertNativeTryForwardingRules(t testing.TB) {
	for _, quote := range nativeTryForwardingQuotes {
		if !strings.Contains(SpecText(failuresChapter), quote) {
			t.Fatalf("native forwarding rule changed: %s", quote)
		}
	}
}

func TestNativeTryForwardingQuoted(t *testing.T) { assertNativeTryForwardingRules(t) }

func nativeTryForwardingKeys() []string {
	var keys []string
	for _, api := range []string{"try", "tryPromise", "sync", "promise", "fake", "fakePromise"} {
		for _, method := range []string{"call", "apply"} {
			for _, input := range []string{"thunk", "options"} {
				if input == "options" && api != "try" && api != "tryPromise" {
					continue
				}
				for _, site := range []string{"thunk", "catch", "nested", "throw"} {
					if site == "catch" && input != "options" {
						continue
					}
					keys = append(keys, api+":"+method+":"+input+":"+site)
				}
			}
		}
	}
	return keys
}

func nativeTryForwardingProject(key string, choice uint8) (Project, int) {
	parts := strings.Split(key, ":")
	api, method, input, site := parts[0], parts[1], parts[2], parts[3]
	contract := "RangeError"
	if choice&4 != 0 {
		contract = "never"
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
export declare const Fake:{
call(thisArg:undefined,thunk:()=>number):number
apply(thisArg:undefined,thunks:[()=>number]):number
}
export declare const FakePromise:{
call(thisArg:undefined,thunk:()=>PromiseLike<number>):number
apply(thisArg:undefined,thunks:[()=>PromiseLike<number>]):number
}
`
	known := contract != "never"
	expression := "risky()"
	if choice&32 != 0 {
		expression = "JSON.parse(\"1\") as number"
		known = true
	} else if choice&64 != 0 {
		expression = "new Input().value"
	} else if choice&128 != 0 {
		expression = "tag`value`"
	}
	admitting := api == "try" || api == "tryPromise"
	promise := api == "tryPromise" || api == "promise" || api == "fakePromise"
	receiver := "Effect." + api
	fake := api == "fake" || api == "fakePromise"
	if fake {
		receiver = "Fake"
		if promise {
			receiver = "FakePromise"
		}
	}
	declaration := ""
	if choice&16 != 0 {
		declaration = "const bridge=" + receiver + "\n"
		receiver = "bridge"
	}
	if input == "thunk" && !fake {
		receiver = "(" + receiver + "<number>)"
	}
	callbackExpression := expression
	if site == "nested" {
		callbackExpression = "(()=>" + expression + ")()"
	}
	if promise {
		callbackExpression = "Promise.resolve(" + callbackExpression + ")"
	}
	callback := "()=>" + callbackExpression
	if choice&1 != 0 {
		callback = "function(){return " + callbackExpression + "}"
	}
	if site == "throw" {
		callback = "()=>{throw new RangeError()}"
		if choice&1 != 0 {
			callback = "function(){throw new RangeError()}"
		}
	}
	if choice&2 != 0 {
		callback = "(" + callback + ")"
	}
	if input == "options" {
		mapper := "(error:unknown)=>error"
		if site == "catch" {
			callback = "()=>1"
			if promise {
				callback = "()=>Promise.resolve(1)"
			}
			mapper = "(error:unknown)=>" + expression
		}
		callback = "{try:" + callback + ",catch:" + mapper + "}"
	}
	if method == "apply" {
		callback = "[" + callback + "]"
	}
	member := "." + method
	if choice&8 != 0 {
		member = "[\"" + method + "\"]"
	}
	source := "import {Effect} from \"effect\"\nimport {risky,Input,tag,Fake,FakePromise} from \"./foreign.js\"\n" + declaration + "export const value=" + receiver + member + "(undefined," + callback + ")"
	want := 0
	if site == "throw" || known && (!admitting || site == "catch" || site == "nested") {
		want = 1
	}
	return Project{
		Files:  map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": `{"type":"module"}`},
		Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","foreign.d.ts"]}`,
	}, want
}

func checkNativeTryForwarding(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	project, want := nativeTryForwardingProject(key, choice)
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
		if !IsEK(d) || d.Code() != 401 {
			Gap(t, nativeTryForwardingTarget, key, "VIP-4 %q: unexpected %s", nativeTryForwardingQuotes[0], describe(d))
		}
	}
	if len(errors) != want {
		Gap(t, nativeTryForwardingTarget, key, "VIP-4 %q: got %v, want %d EK0401", nativeTryForwardingQuotes[0], errors, want)
	}
}

func TestNativeTryForwarding(t *testing.T) {
	assertNativeTryForwardingRules(t)
	w := NewWorkspace(t)
	for _, key := range nativeTryForwardingKeys() {
		t.Run(key, func(t *testing.T) { checkNativeTryForwarding(t, w, key, 0) })
	}
}

func TestNativeTryForwardingVariants(t *testing.T) {
	assertNativeTryForwardingRules(t)
	w := NewWorkspace(t)
	for _, key := range nativeTryForwardingKeys() {
		for _, choice := range []uint8{0, 1, 2, 4, 8, 16, 32, 64, 128, 255} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkNativeTryForwarding(t, w, key, choice) })
		}
	}
}

func FuzzNativeTryForwarding(f *testing.F) {
	startShortBudget(f)
	assertNativeTryForwardingRules(f)
	keys := nativeTryForwardingKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkNativeTryForwarding(t, w, key, choice)
	})
}
