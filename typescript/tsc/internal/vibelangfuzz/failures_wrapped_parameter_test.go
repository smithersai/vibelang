package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const wrappedParameterTarget = "FuzzWrappedEffectParameters"

var wrappedParameterQuotes = []string{
	"A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401`",
	"A function literal passed where the parameter's function type admits throws",
	"**Parameter defaults and destructuring** run at the call, before the Effect exists.",
}

func assertWrappedParameterRules(t testing.TB) {
	for _, quote := range wrappedParameterQuotes {
		if !strings.Contains(SpecText(failuresChapter), quote) {
			t.Fatalf("wrapped parameter rule changed: %s", quote)
		}
	}
}
func TestWrappedEffectParametersQuoted(t *testing.T) { assertWrappedParameterRules(t) }

func wrappedParameterKeys() []string {
	var keys []string
	for _, shape := range []string{"function", "arrow", "options-function", "options-arrow", "producer", "options-producer", "plain", "plain-generator"} {
		for _, contract := range []string{"RangeError", "never", "untagged", "builtin", "constructor", "tagged"} {
			keys = append(keys, shape+":"+contract)
		}
	}
	return keys
}
func checkWrappedEffectParameters(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	parts := strings.Split(key, ":")
	shape, contract := parts[0], parts[1]
	tag := ""
	if contract != "untagged" {
		bound := contract
		if bound != "never" {
			bound = "RangeError"
		}
		tag = "/** @throws {" + bound + "} */\n"
	}
	library := tag + "export declare function risky():number\n" + tag + "export declare function riskyTag(parts:TemplateStringsArray):number\nexport declare class Risky {\n" + tag + "constructor()\n}\n"
	expr := "risky()"
	switch contract {
	case "builtin":
		expr = "JSON.parse(\"1\") as number"
	case "constructor":
		expr = "new Risky()"
	case "tagged":
		expr = "riskyTag\x60value\x60"
	}
	if choice&2 != 0 {
		expr = "(" + expr + ")"
	}
	parameter := "value=" + expr
	if choice&4 != 0 {
		parameter = "[value]=[" + expr + "]"
	}
	marked := shape != "plain" && shape != "plain-generator"
	marker := ""
	if marked {
		marker = "effect "
	}
	callback := marker + "function nested(" + parameter + ") { return value }"
	if strings.Contains(shape, "arrow") {
		callback = marker + "(" + parameter + ") => value"
	}
	if strings.Contains(shape, "producer") || shape == "plain-generator" {
		callback = marker + "function* nested(" + parameter + ") {yield value}"
	}
	if choice&1 != 0 {
		callback = "(" + callback + ")"
	}
	argument := callback
	if strings.HasPrefix(shape, "options-") {
		argument = "{try:" + callback + ",catch:(error)=>error}"
	}
	source := "import {risky,riskyTag,Risky} from \"./foreign.js\"\nexport const program=Effect.try(" + argument + ")\n"
	result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": `{"type":"module"}`}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","foreign.d.ts"]}`})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	want := 0
	if marked && contract != "never" {
		want = 1
	}
	var errors []string
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		errors = append(errors, describe(d))
		if want == 0 || !IsEK(d) || d.Code() != 401 {
			Gap(t, wrappedParameterTarget, key, "VIP-4 %q: unexpected %s", wrappedParameterQuotes[0], describe(d))
		}
	}
	if len(errors) != want {
		Gap(t, wrappedParameterTarget, key, "VIP-4 %q: got %v, want %d EK0401", wrappedParameterQuotes[0], errors, want)
	}
}
func TestWrappedEffectParameters(t *testing.T) {
	assertWrappedParameterRules(t)
	w := NewWorkspace(t)
	for _, key := range wrappedParameterKeys() {
		t.Run(key, func(t *testing.T) { checkWrappedEffectParameters(t, w, key, 0) })
	}
}
func FuzzWrappedEffectParameters(f *testing.F) {
	startShortBudget(f)
	assertWrappedParameterRules(f)
	keys := wrappedParameterKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkWrappedEffectParameters(t, w, key, choice)
	})
}
