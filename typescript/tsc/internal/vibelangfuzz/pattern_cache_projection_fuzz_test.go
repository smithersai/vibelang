package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const patternCacheProjectionQuote = "For each property retain key evaluation, presence check, cached value read, sub-pattern and binding initialization in order"

func TestPatternCacheProjectionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), patternCacheProjectionQuote) {
		t.Fatal("chapter 004 changed; update the cached-pattern projection oracle")
	}
}

var patternCacheProjectionSources = map[string]string{
	"computed-name":     `const key = "value"; export function f(s: {value: number}) { return match(s){when {[key]: Number(let x)}:x;default:0;} }`,
	"computed-member":   `const keys = {field: "value" as const}; export function f(s: {value: number}) { return match(s){when {[keys.field]: Number(let x)}:x;default:0;} }`,
	"computed-index":    `const keys = ["value"] as const; export function f(s: {value: number}) { return match(s){when {[keys[0]]: Number(let x)}:x;default:0;} }`,
	"primitive-string":  `export function f(s: unknown) { return match(s){when String(let x):x;default:undefined;} }`,
	"primitive-number":  `export function f(s: unknown) { return match(s){when Number(let x):x;default:undefined;} }`,
	"primitive-boolean": `export function f(s: unknown) { return match(s){when Boolean(let x):x;default:undefined;} }`,
	"primitive-bigint":  `export function f(s: unknown) { return match(s){when BigInt(let x):x;default:undefined;} }`,
	"primitive-symbol":  `export function f(s: unknown) { return match(s){when Symbol(let x):x;default:undefined;} }`,
}

func FuzzPatternCacheProjection(f *testing.F) {
	startShortBudget(f)
	for key := range patternCacheProjectionSources {
		f.Add(key)
	}
	prelude, err := os.ReadFile("../../../../packages/ts-mapper/prelude.d.ts")
	if err != nil {
		f.Fatal(err)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		if !strings.Contains(SpecText("004-match.md"), patternCacheProjectionQuote) {
			t.Fatal("cached-pattern authority changed")
		}
		variants := []string{"computed-name", "computed-member", "computed-index", "primitive-string", "primitive-number", "primitive-boolean", "primitive-bigint", "primitive-symbol"}
		var mode uint64
		for i := 0; i < len(key) && i < 16; i++ {
			mode = mode*131 + uint64(key[i])
		}
		source, ok := patternCacheProjectionSources[key]
		if !ok {
			source = patternCacheProjectionSources[variants[mode%uint64(len(variants))]]
		}
		fields := []string{"value", "constructor", "__proto__"}
		source = strings.ReplaceAll(source, "value", fields[(mode/8)%uint64(len(fields))])
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "match(s)", "match((s))")
		}
		// Generated nodes carry source positions. Mutate offsets as well as
		// assertion/key shapes, so a renderer cannot copy their source token.
		source = strings.Repeat("\n", int(mode%5)) + strings.Repeat(" ", int(mode%17)) + source
		context := vibelangmapper.FileContext{}
		projected := vibelangmapper.Project(source, context)
		for _, diagnostic := range projected.Diagnostics {
			if diagnostic.Code == 9001 || diagnostic.Code == 9002 {
				t.Fatalf("%s checking projection: %v\n%s", key, diagnostic, projected.Text)
			}
		}
		// Check the rendered TypeScript against the shipped declaration surface,
		// independently of the projection's own diagnostics and runtime emitter.
		checked, err := w.CompileOrdered(t.Context(), Project{
			Files: map[string]string{
				"main.ts":      strings.ReplaceAll(projected.Text, "vibelang-ts-mapper/prelude", "./prelude.js"),
				"prelude.d.ts": string(prelude),
				"package.json": "{\"type\":\"module\"}",
			},
			Config: "{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":true,\"target\":\"esnext\",\"module\":\"nodenext\",\"moduleResolution\":\"nodenext\",\"noEmit\":true,\"types\":[]},\"files\":[\"main.ts\"]}",
		}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer checked.Remove()
		for _, diagnostic := range checked.Diagnostics {
			if diagnostic.Category() == diagnostics.CategoryError {
				t.Fatalf("%s checked projection: %s", key, diagnostic)
			}
		}
		js, _, diagnostics := vibelangmapper.Emit(source, context)
		for _, diagnostic := range diagnostics {
			if diagnostic.Code == 9001 || diagnostic.Code == 9002 {
				t.Fatalf("%s executable projection: %v\n%s", key, diagnostic, js)
			}
		}
	})
}
