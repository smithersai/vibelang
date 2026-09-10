package compiler

import (
	"os/exec"
	"reflect"
	"sort"
	"strings"
	"testing"
	"unicode/utf16"
)

func durableModuleSpanText(source string, location Span) string {
	units := utf16.Encode([]rune(source))
	return string(utf16.Decode(units[location.Start : location.Start+location.Length]))
}

func TestPinnedForkDurableModule(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(DurableModuleAnalyzer)
	const imported = `import { durable } from "vibelang:flows";`
	const helper = `function helper(n: number) { return n + 1 }`
	for _, tc := range []struct{ name, imports, body, callee string }{
		{"direct", imported, "", "durable"},
		{"renamed import", `import { durable as pin } from "vibelang:flows";`, "", "pin"},
		{"namespace property", `import * as Flows from "vibelang:flows";`, "", "Flows.durable"},
		{"namespace element", `import * as Flows from "vibelang:flows";`, "", `Flows["durable"]`},
		{"parenthesized", imported, "", "(durable)"},
		{"typed alias", imported, `const pin: typeof durable = durable;`, "pin"},
		{"satisfies", imported, "", "(durable satisfies typeof durable)"},
		{"shadowed helper name", imported, `function ordinary(helper: () => number) { return helper() }`, "durable"},
		{"shadowed intrinsic name", `import { durable as pin } from "vibelang:flows";`, `function ordinary(pin: (n: number) => number) { return pin(1) }`, "pin"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			call := tc.callee + "(helper)"
			source := tc.imports + helper + tc.body + "export const Flow = " + call
			got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: source})
			if err != nil || len(got.Diagnostics) != 0 || len(got.Imports) != 1 || len(got.Calls) != 1 || len(got.Removals) != 1 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			if durableModuleSpanText(source, got.Calls[0]) != call || durableModuleSpanText(source, got.Removals[0]) != helper {
				t.Fatalf("incorrect authored ranges: %+v", got)
			}
		})
	}
	for _, tc := range []struct{ name, source string }{
		{"empty", ""},
		{"ordinary spelling", `function durable(f: () => number) { return f() } const Flow = durable(() => 42)`},
		{"shadowed import", imported + `function use(durable: (f: () => number) => number) { return durable(() => 42) }`},
		{"shadowed namespace", `import * as Flows from "vibelang:flows"; function use(Flows: { durable(f: () => number): number }) { return Flows.durable(() => 42) }`},
		{"unrelated module", `import { durable } from "vibelang/context"; const Flow = durable(() => 42)`},
		{"same-named method", `const local = { durable(f: () => number) { return f() } }; const Flow = local.durable(() => 42)`},
		{"authored ambient signature", `declare function durable(f: () => number): number; const Flow = durable(() => 42)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: tc.source})
			if err != nil || len(got.Diagnostics) != 0 || len(got.Calls) != 0 || len(got.Removals) != 0 {
				t.Fatalf("spelling supplied a compiler identity: %+v err=%v", got, err)
			}
		})
	}
	for _, exposure := range []string{
		`export { helper }`, `export { helper as renamed }`, `export const outside = { helper }`,
		`export const outside = () => helper(1)`, `export function outside(n = helper(41)) { return n }`,
		`function outside(n = helper(41)) { return n }; export { outside }`,
		`function outside(n = helper(41)) { return n }; export const api = { outside }`,
		`class Outside { static value = helper(1) }`, `const value = helper(1)`, `helper(1)`,
	} {
		t.Run("outside reference "+exposure, func(t *testing.T) {
			source := imported + helper + `export const Flow = durable(helper);` + exposure
			got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: source})
			if err != nil || len(got.Diagnostics) != 0 || len(got.Calls) != 1 || len(got.Removals) != 0 {
				t.Fatalf("externally reachable helper was removed: %+v err=%v", got, err)
			}
		})
	}
	for _, tc := range []struct {
		name, declarations string
		removed            []string
	}{
		{"one const", `const read = (n: number) => n;`, []string{`const read = (n: number) => n;`}},
		{"leading const", `const read = (n: number) => n, before = 1;`, []string{`read = (n: number) => n, `}},
		{"middle const", `const before = 1, read = (n: number) => n, after = 2;`, []string{`read = (n: number) => n, `}},
		{"trailing const", `const before = 1, read = (n: number) => n;`, []string{`, read = (n: number) => n`}},
		{"adjacent const run", `const read = (n: number) => second(n), second = (n: number) => n, kept = 1;`, []string{`read = (n: number) => second(n), second = (n: number) => n, `}},
		{"disjoint const runs", `const read = (n: number) => second(n), kept = 1, second = (n: number) => n;`, []string{`read = (n: number) => second(n), `, `, second = (n: number) => n`}},
		{"unrelated literal", `const read = (n: number) => n, second = (n: number) => n;`, []string{`read = (n: number) => n, `}},
		{"overload", `function read(n: number): number; function read(n: number) { return n }`, []string{`function read(n: number): number;`, `function read(n: number) { return n }`}},
		{"mutual recursion", `function read(n: number): number { return n ? other(n - 1) : 0 } function other(n: number): number { return read(n) }`, []string{`function read(n: number): number { return n ? other(n - 1) : 0 }`, `function other(n: number): number { return read(n) }`}},
		{"wrapped literal", `const read = ((n: number) => n) satisfies ((n: number) => number);`, []string{`const read = ((n: number) => n) satisfies ((n: number) => number);`}},
		{"let is retained", `let read = (n: number) => n;`, []string{}},
		{"call initializer is retained", `function make() { return (n: number) => n } const read = make();`, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := imported + tc.declarations + `export const Flow = durable((n: number) => read(n));`
			got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: source})
			if err != nil || len(got.Diagnostics) != 0 || len(got.Calls) != 1 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			removed := []string{}
			for _, item := range got.Removals {
				removed = append(removed, durableModuleSpanText(source, item))
			}
			if !reflect.DeepEqual(removed, tc.removed) {
				t.Fatalf("removed=%q expected=%q", removed, tc.removed)
			}
		})
	}
	for _, newline := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029"} {
		t.Run("UTF16 "+newline, func(t *testing.T) {
			source := "// 😀" + newline + imported + newline + "// 🧪" + newline + helper + newline + `export const Flow = durable(helper)`
			got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: source})
			if err != nil || len(got.Diagnostics) != 0 || len(got.Imports) != 1 || len(got.Calls) != 1 || len(got.Removals) != 1 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			if durableModuleSpanText(source, got.Imports[0]) != "// 😀"+newline+imported ||
				durableModuleSpanText(source, got.Calls[0]) != "durable(helper)" || durableModuleSpanText(source, got.Removals[0]) != helper {
				t.Fatalf("authored Unicode/trivia boundaries changed: %+v", got)
			}
		})
	}
	for _, tc := range []struct{ name, body, code string }{
		{"parse recovery", `export const Flow = durable((n: number) => { return n + });`, "VIBE1000"},
		{"braceless conditional", `export const Flow = durable((n: number) => { if (const x = n; x > 0) return x; return 0 })`, "VIBE1717"},
		{"var conditional", `export const Flow = durable((n: number) => { if (var x = n; x > 0) { return x }; return 0 })`, "VIBE1717"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: imported + tc.body})
			if err != nil || len(got.Diagnostics) == 0 || len(got.Calls)+len(got.Imports)+len(got.Removals) != 0 {
				t.Fatalf("refusal returned partial edits: %+v err=%v", got, err)
			}
			found := false
			for _, item := range got.Diagnostics {
				found = found || item.Code == tc.code
			}
			if !found {
				t.Fatalf("missing %s: %+v", tc.code, got)
			}
		})
	}
	t.Run("multiple and nested declarations do not produce a removal plan", func(t *testing.T) {
		for _, body := range []string{`const A = durable(helper); const B = durable(helper)`, `const A = durable(() => durable(helper))`} {
			got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: imported + helper + body})
			if err != nil || len(got.Diagnostics) != 0 || len(got.Calls) != 2 || len(got.Removals) != 0 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		}
	})
	t.Run("nested self-reference never overlaps the call", func(t *testing.T) {
		source := imported + `function helper(n: number) { return durable(helper) }`
		got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: source})
		if err != nil || len(got.Diagnostics) != 0 || len(got.Calls) != 1 || len(got.Removals) != 0 {
			t.Fatalf("got=%+v err=%v", got, err)
		}
	})
	t.Run("valid conditional declaration remains parser preserving", func(t *testing.T) {
		source := imported + `function helper(n: number) { if (const value = n; value > 0) { return value } return 0 }
export const Flow = durable(helper)`
		got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: source})
		if err != nil || len(got.Diagnostics) != 0 || len(got.Calls) != 1 || len(got.Removals) != 1 {
			t.Fatalf("got=%+v err=%v", got, err)
		}
	})
	t.Run("module mutation, observable initializer order and exported defaults execute unchanged", func(t *testing.T) {
		source := imported + `
const log: number[] = [];
function helper(n: number) { return n * 2 }
function outside(n = helper(21)) { return n }
export { outside };
const first = log.push(1);
class Static { static { log.push(2) } }
const second = log.push(3);
const Flow = durable((n: number) => helper(n));
console.log(outside(), log.join(","));`
		got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: source})
		if err != nil || len(got.Diagnostics) != 0 || len(got.Calls) != 1 || len(got.Removals) != 0 {
			t.Fatalf("got=%+v err=%v", got, err)
		}
		edits := append(append([]Span{}, got.Imports...), got.Removals...)
		edits = append(edits, got.Calls...)
		sort.Slice(edits, func(i, j int) bool { return edits[i].Start > edits[j].Start })
		units := utf16.Encode([]rune(source))
		for _, edit := range edits {
			replacement := []uint16{}
			if edit == got.Calls[0] {
				replacement = utf16.Encode([]rune("({ checked: true })"))
			}
			units = append(append(append([]uint16{}, units[:edit.Start]...), replacement...), units[edit.Start+edit.Length:]...)
		}
		emitted, err := backend.(Transpiler).Transpile(ctx, TranspileRequest{Files: []TranspileSource{{Path: "module.ts", Text: string(utf16.Decode(units))}}})
		if err != nil || len(emitted.Files) != 1 || len(emitted.Files[0].Diagnostics) != 0 {
			t.Fatalf("emit=%+v err=%v", emitted, err)
		}
		command := exec.CommandContext(ctx, "node", "--input-type=module")
		command.Stdin = strings.NewReader(emitted.Files[0].JavaScript)
		output, err := command.CombinedOutput()
		if err != nil || strings.TrimSpace(string(output)) != "42 1,2,3" {
			t.Fatalf("output=%q err=%v", output, err)
		}
	})
	t.Run("source budget", func(t *testing.T) {
		if got, err := analyzer.DurableModule(ctx, DurableModuleRequest{Source: strings.Repeat(" ", 2*1024*1024+1)}); err == nil {
			t.Fatalf("unbounded input: %+v", got)
		}
	})
}
