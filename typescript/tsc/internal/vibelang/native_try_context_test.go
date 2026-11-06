package vibelang

import (
	"strings"
	"testing"
)

func TestNativeTryFixPreservesContextualReturns(t *testing.T) {
	for _, tc := range []struct{ name, decl, body string }{
		{"discriminated", `type Outcome = { _tag: "Ready"; value: number } | { _tag: "Failed"; error: unknown }`, `export effect function f(): Outcome!! { try { return { _tag: "Ready", value: 1 } } catch(error) { return { _tag: "Failed", error } } }`},
		{"tuple", `type Pair = ["value", number]`, `export effect function f(): Pair!! { try { return ["value", 1] } finally {} }`},
		{"conditional", `type Outcome = { _tag: "Ready"; value: number } | { _tag: "Failed"; error: unknown }`, `export effect function f(flag: boolean): Outcome!! { try { return flag ? { _tag: "Ready", value: 1 } : { _tag: "Failed", error: null } } finally {} }`},
		{"generic", `type Outcome<T> = { _tag: "Ready"; value: T } | { _tag: "Failed"; error: unknown }`, `export effect function f<T>(value: T): Outcome<T>!! { try { return { _tag: "Ready", value } } catch(error) { return { _tag: "Failed", error } } }`},
		{"comments", `interface Result { readonly kind: "ready"; values: number[] }`, `export effect function f(): Result!! { try { return /* before */ { kind: "ready", values: [1] } /* after */ } finally {} }`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := fixProjectOf(t, map[string]string{"main.vibe": tc.decl + "\n" + tc.body})
			fixed := fixedText(result, "main.vibe")
			if fixed == "" || strings.Contains(fixed, "try {") {
				t.Fatalf("contextual return not repaired:\n%s\nrefused %+v", fixed, result.Refused)
			}
			for _, d := range errorsOf(t, fixed) {
				t.Errorf("fixed source: %s", d.String())
			}
			if tc.name == "comments" && (!strings.Contains(fixed, "/* before */") || !strings.Contains(fixed, "/* after */")) {
				t.Fatalf("comments lost: %s", fixed)
			}
			again := fixProjectOf(t, map[string]string{"main.vibe": fixed})
			if len(again.Files) != 0 {
				t.Fatalf("not idempotent: %+v", again.Files)
			}
		})
	}
}

func TestNativeTryFixPreservesImportedReturnContext(t *testing.T) {
	result := fixProjectOf(t, map[string]string{
		"shape.ts":  `export interface Outcome { readonly tag: "ready"; values: number[] }`,
		"main.vibe": `import * as Shapes from "./shape.ts"; export effect function f(): Shapes.Outcome!! { try { return {tag:"ready",values:[1]} } finally {} }`,
	})
	fixed := fixedText(result, "main.vibe")
	if fixed == "" || !strings.Contains(fixed, "satisfies Shapes.Outcome") {
		t.Fatalf("return context lost its source name: %s; refused %+v", fixed, result.Refused)
	}
	again := fixProjectOf(t, map[string]string{"shape.ts": `export interface Outcome { readonly tag: "ready"; values: number[] }`, "main.vibe": fixed})
	if len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("imported return repair not stable: %+v", again)
	}
}
