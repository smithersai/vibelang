package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const resolvedTryTarget = "FuzzResolvedTrySignature"

var resolvedTryQuotes = []string{
	"A function literal passed where the parameter's function type admits throws",
	"`Effect.try` and `Effect.tryPromise` declare their thunk `@throws {unknown}` in both overloads",
	"A function nested in that literal is its own plain code.",
	"callable unions combine their alternatives.",
	"A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`",
}

func assertResolvedTryRules(t testing.TB) {
	for _, q := range resolvedTryQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("wrapper contract changed: %s", q)
		}
	}
}
func TestResolvedTrySignatureQuoted(t *testing.T) { assertResolvedTryRules(t) }
func resolvedTryKeys() []string {
	var keys []string
	for _, api := range []string{"try", "tryPromise"} {
		for _, spelling := range []string{"direct", "computed", "callee-parentheses", "receiver-parentheses", "namespace-alias", "function-alias", "comma-callee", "bound"} {
			for _, mode := range []string{"thunk", "options", "catch", "nested"} {
				keys = append(keys, api+":"+spelling+":"+mode)
			}
		}
	}
	for _, api := range []string{"try", "tryPromise"} {
		for _, spelling := range []string{"mixed-sync", "mixed-foreign", "admitting-union", "mixed-property", "mixed-shorthand", "mixed-or", "mixed-coalesce", "admitting-property"} {
			keys = append(keys, api+":"+spelling+":thunk")
		}
	}
	for _, api := range []string{"try", "tryPromise"} {
		for _, spelling := range []string{"nonnull-mixed-sync", "nonnull-mixed-foreign", "nonnull-admitting", "nonnull-object-mixed", "nonnull-object-admitting", "nonnull-nullish"} {
			keys = append(keys, api+":"+spelling+":thunk")
		}
	}
	return keys
}
func checkResolvedTrySignature(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	parts := strings.Split(key, ":")
	api, spelling, mode := parts[0], parts[1], parts[2]
	contract := "RangeError"
	if choice&4 != 0 {
		contract = "never"
	}
	library := `import {Effect} from "effect"
export declare const flag:boolean
export declare function strict(callback:()=>number):Effect.Effect<number>
export declare function asyncStrict(callback:()=>PromiseLike<number>):Effect.Effect<number>
/** @throws {` + contract + `} */
export declare function risky():number
export declare class Input {
/** @throws {` + contract + `} */
constructor()
value:number
}
/** @throws {` + contract + `} */
export declare function tag(parts:TemplateStringsArray):number
`
	expression := "risky()"
	switch choice >> 3 & 3 {
	case 1:
		expression = "new Input().value"
	case 2:
		expression = "tag`value`"
	case 3:
		expression = "JSON.parse(\"1\") as number"
		contract = "RangeError"
	}
	if strings.HasPrefix(spelling, "admitting-") || spelling == "nonnull-admitting" || spelling == "nonnull-object-admitting" {
		expression = "(" + expression + ") as 0"
	}
	callbackExpression := expression
	if api == "tryPromise" {
		callbackExpression = "Promise.resolve(" + expression + ")"
	}
	callback := "()=>" + callbackExpression
	if choice&1 != 0 {
		callback = "function(){return " + callbackExpression + "}"
	}
	if choice&2 != 0 {
		callback = "(" + callback + ")"
	}
	want := 0
	switch mode {
	case "options":
		callback = "{try:" + callback + ",catch:(error)=>error}"
	case "catch":
		callback = "{try:()=>"
		if api == "tryPromise" {
			callback += "Promise.resolve(1)"
		} else {
			callback += "1"
		}
		callback += ",catch:()=>" + expression + "}"
		if contract != "never" {
			want = 1
		}
	case "nested":
		callback = "()=>{const nested=()=>" + expression + ";return "
		if api == "tryPromise" {
			callback += "Promise.resolve(nested())}"
		} else {
			callback += "nested()}"
		}
		if contract != "never" {
			want = 1
		}
	}
	if strings.HasPrefix(spelling, "mixed-") && contract != "never" {
		want = 1
	}
	decl, callee := "", "Effect."+api
	switch spelling {
	case "mixed-property", "mixed-shorthand", "mixed-or", "mixed-coalesce", "admitting-property":
		allowed := "Effect." + api + "<number>"
		denied := "Effect.sync<number>"
		if api == "tryPromise" {
			denied = "Effect.promise<number>"
		}
		switch spelling {
		case "mixed-property":
			decl = "const bridge={run:flag?" + allowed + ":" + denied + "}\n"
			callee = "bridge.run"
		case "mixed-shorthand":
			decl = "const run=flag?" + allowed + ":" + denied + ";const bridge={run}\n"
			callee = "bridge.run"
		case "mixed-or":
			decl = "const bridge=(flag?" + allowed + ":undefined)||" + denied + "\n"
			callee = "bridge"
		case "mixed-coalesce":
			decl = "const bridge=(flag?" + allowed + ":undefined)??" + denied + "\n"
			callee = "bridge"
		case "admitting-property":
			decl = "const bridge=flag?{run:Effect." + api + "<0>}:{run:" + allowed + "}\n"
			callee = "bridge.run"
		}
	case "mixed-sync", "mixed-foreign":
		denied := "Effect.sync<number>"
		if api == "tryPromise" {
			denied = "Effect.promise<number>"
		}
		if spelling == "mixed-foreign" {
			denied = "strict"
			if api == "tryPromise" {
				denied = "asyncStrict"
			}
		}
		decl = "const bridge=flag?Effect." + api + "<number>:" + denied + "\n"
		callee = "bridge"
	case "admitting-union":
		decl = "const bridge=flag?Effect." + api + "<0>:Effect." + api + "<number>\n"
		callee = "bridge"
	case "nonnull-mixed-sync", "nonnull-mixed-foreign", "nonnull-admitting", "nonnull-object-mixed", "nonnull-object-admitting", "nonnull-nullish":
		allowed := "Effect." + api + "<number>"
		denied := "Effect.sync<number>"
		if api == "tryPromise" {
			denied = "Effect.promise<number>"
		}
		value := "flag?" + denied + ":" + allowed
		switch spelling {
		case "nonnull-mixed-foreign":
			denied = "strict"
			if api == "tryPromise" {
				denied = "asyncStrict"
			}
			value = "flag?" + denied + ":" + allowed
		case "nonnull-admitting":
			value = "flag?Effect." + api + "<0>:" + allowed
		case "nonnull-object-mixed":
			value = "flag?{run:" + denied + "}:{run:" + allowed + "}"
		case "nonnull-object-admitting":
			value = "flag?{run:Effect." + api + "<0>}:{run:" + allowed + "}"
		case "nonnull-nullish":
			value = "flag?" + allowed + ":undefined"
		}
		if strings.Contains(spelling, "mixed") && contract != "never" {
			want = 1
		}
		if strings.Contains(spelling, "object") {
			value = "(" + value + ")!.run"
		} else {
			value = "(" + value + ")!"
		}
		decl = "const bridge=" + value + "\n"
		callee = "bridge"
	case "computed":
		callee = "Effect[\"" + api + "\"]"
	case "callee-parentheses":
		callee = "(" + callee + ")"
	case "receiver-parentheses":
		callee = "(Effect)." + api
	case "namespace-alias":
		decl = "const E=Effect\n"
		callee = "E." + api
	case "function-alias":
		decl = "const bridge=Effect." + api + "\n"
		callee = "bridge"
	case "comma-callee":
		callee = "(0," + callee + ")"
	case "bound":
		decl = "const bridge=Effect." + api + ".bind(undefined)\n"
		callee = "bridge"
	}
	source := "import {Effect} from \"effect\"\nimport {risky,Input,tag,flag,strict,asyncStrict} from \"./foreign.js\"\n" + decl + "export const value=" + callee + "(" + callback + ")\n"
	result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": `{"type":"module"}`}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","foreign.d.ts"]}`})
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
			Gap(t, resolvedTryTarget, key, "VIP-4 %q: unexpected %s", resolvedTryQuotes[0], describe(d))
		}
	}
	if len(errors) != want {
		Gap(t, resolvedTryTarget, key, "VIP-4 %q: got %v, want %d EK0401", resolvedTryQuotes[2], errors, want)
	}
}
func TestResolvedTrySignature(t *testing.T) {
	assertResolvedTryRules(t)
	w := NewWorkspace(t)
	for _, key := range resolvedTryKeys() {
		t.Run(key, func(t *testing.T) { checkResolvedTrySignature(t, w, key, 0) })
	}
}
func FuzzResolvedTrySignature(f *testing.F) {
	startShortBudget(f)
	assertResolvedTryRules(f)
	keys := resolvedTryKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkResolvedTrySignature(t, w, key, choice)
	})
}
