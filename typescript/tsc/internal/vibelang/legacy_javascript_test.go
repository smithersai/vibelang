package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-1 and VIP-4: eval, Function, arguments, with, a function value's
// .constructor and data:/blob: specifiers are EK0107 anywhere in a .vibe
// file. want lists the source text each diagnostic covers, in order.
func TestLegacyJavaScript(t *testing.T) {
	for _, test := range []struct {
		name, source string
		want         []string
	}{
		{"direct-eval", `export const value = eval("1")`, []string{"eval"}},
		{"indirect-eval", `export const value = (0, eval)("1")`, []string{"eval"}},
		{"optional-eval", `export const value = eval?.("1")`, []string{"eval"}},
		{"eval-alias", `export const e = eval`, []string{"eval"}},
		{"eval-in-effect", `export effect function run() { return eval("1") }`, []string{"eval"}},
		{"eval-property", `export const row = { eval: 1 }; export const value = row.eval`, nil},
		{"eval-string", `export const value = "eval(1)" // eval in text`, nil},
		{"arguments", `export function count(x: number): number { return arguments.length }`, []string{"arguments"}},
		{"arguments-effect", `export effect function count(x: number) { return arguments.length }`, []string{"arguments"}},
		{"arguments-method", `export class Counter { count(x: number): number { return arguments.length } }`, []string{"arguments"}},
		{"arguments-shorthand", `export function count(x: number) { return { arguments } }`, []string{"arguments"}},
		{"arguments-property", `export const row = { arguments: 1 }; export const value = row.arguments`, nil},
		{"rest-control", `export function count(...xs: number[]): number { return xs.length }`, nil},
		{"function-new", `export const f = new Function("a", "return a")`, []string{"Function"}},
		{"function-call", `export const f = Function("return 1")`, []string{"Function"}},
		{"function-optional-call", `export const f = Function?.("return 1")`, []string{"Function"}},
		{"function-alias", `export const F = Function`, []string{"Function"}},
		{"function-call-method", `export const f = Function.call(null, "return 7")`, []string{"Function"}},
		{"function-name", `export const n = Function.name`, []string{"Function"}},
		{"function-in-effect", `export effect function make() { return Function("return 1") }`, []string{"Function"}},
		{"function-instanceof", `export const isFn = (x: unknown) => x instanceof Function`, nil},
		{"function-prototype", `export const s = Function.prototype.toString.call(() => 1)`, nil},
		{"function-prototype-optional", `export const p = Function?.prototype`, nil},
		{"function-prototype-element", `export const p = Function["prototype"]`, nil},
		{"function-type", `export const f: Function = () => 1`, nil},
		{"function-typeof-type", `export type Ctor = typeof Function`, nil},
		{"function-shadowed", `export function shadow(Function: number): number { return Function + 1 }`, nil},
		{"with", `export function read(o: { x: number }): number { with (o) { return 1 } }`, []string{"with"}},
		{"constructor-arrow", `export const AF = (async () => {}).constructor`, []string{"constructor"}},
		{"constructor-function", `function f() { return 1 }; export const C = f.constructor`, []string{"constructor"}},
		{"constructor-element", `function f() { return 1 }; export const C = f["constructor"]`, []string{`"constructor"`}},
		{"constructor-class-value", `class K {}; export const C = K.constructor`, []string{"constructor"}},
		{"constructor-object", `export const C = ({}).constructor`, nil},
		{"constructor-any", `const v: any = 1; export const C = v.constructor`, nil},
		{"constructor-instance", `class K {}; export const C = new K().constructor`, nil},
		{"constructor-declaration", `export class K { constructor() {} }`, nil},
		{"data-import-call", `const m = import("data:text/javascript,export default 1"); export { m }`, []string{`"data:text/javascript,export default 1"`}},
		{"blob-import-call", `const m = import("blob:https://example.test/1"); export { m }`, []string{`"blob:https://example.test/1"`}},
		{"data-import-declaration", `import value from "data:text/javascript,export default 1"; export { value }`, []string{`"data:text/javascript,export default 1"`}},
		{"computed-import", `const spec = "./other.js"; const m = import(spec); export { m }`, nil},
		{"file-import", `import { Effect } from "effect"; export const e = Effect.succeed(1)`, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			var got []string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != "EK" || d.Code() != 107 {
					continue
				}
				if d.Category() != diagnostics.CategoryError {
					t.Errorf("EK0107 category = %v, want error", d.Category())
				}
				loc := d.Loc()
				got = append(got, file.Text()[loc.Pos():loc.End()])
			}
			if strings.Join(got, "|") != strings.Join(test.want, "|") {
				t.Fatalf("EK0107 spans = %q, want %q: %s", got, test.want, test.source)
			}
		})
	}
}

// VIP-1/detail75 rejects obtaining the constructor, not write-only targets.
func TestLegacyJavaScriptWriteControls(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"constructor-write-control", "function f(): number { return 1 }; function g(): number { return 2 }; f.constructor = g; return f", 0},
		{"constructor-element-write-control", "function f(): number { return 1 }; function g(): number { return 2 }; f[\"constructor\"] = g; return f", 0},
		{"constructor-destructure-write-control", "function f(): number { return 1 }; function g(): number { return 2 }; ({ value: f.constructor } = { value: g }); return f", 0},
		{"constructor-for-of-write-control", "function f(): number { return 1 }; function g(): number { return 2 }; for (f.constructor of [g]) {} return f", 0},
		{"constructor-read-write", "function f(): number { return 1 }; function g(): number { return 2 }; f.constructor ||= g; return f", 1},
		{"constructor-write-rhs-control", "function f(): number { return 1 }; function g(): number { return 2 }; f.constructor = eval(\"1\"); return f", 1},
		{"constructor-global-write", "function f(): number { return 1 }; function g(): number { return 2 }; Function.constructor = g; return f", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export function run(): unknown { "+tc.body+" }")
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 107 {
					count++
					continue
				}
				if tc.want == 0 && d.Category() == diagnostics.CategoryError {
					t.Errorf("invalid write control: %s", d.String())
				}
			}
			if count != tc.want {
				t.Fatalf("EK0107 count=%d, want%d: %s", count, tc.want, tc.body)
			}
		})
	}
}

// The source reference rules are independent of TS2790: strict TypeScript
// diagnoses deletion of a required property, but no EK0107 should be added.
func TestLegacyJavaScriptReferenceControls(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"constructor-delete-control", "function f(): number { return 1 }; function g(): number { return 2 }; delete f.constructor; return f", 0},
		{"constructor-delete-parens-control", "function f(): number { return 1 }; function g(): number { return 2 }; delete ((f[\"constructor\"])); return f", 0},
		{"constructor-assert-write-control", "function f(): number { return 1 }; function g(): number { return 2 }; (f.constructor as Function) = g; return f", 0},
		{"constructor-nonnull-write-control", "function f(): number { return 1 }; function g(): number { return 2 }; (f.constructor!) = g; return f", 0},
		{"constructor-satisfies-write-control", "function f(): number { return 1 }; function g(): number { return 2 }; (f.constructor satisfies Function) = g; return f", 0},
		{"constructor-assert-read", "function f(): number { return 1 }; function g(): number { return 2 }; return (f.constructor as Function)", 1},
		{"constructor-delete-base-read", "function f(): number { return 1 }; function g(): number { return 2 }; delete (f.constructor as any).property; return f", 1},
		{"constructor-delete-global", "function f(): number { return 1 }; function g(): number { return 2 }; delete Function.constructor; return f", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export function run(): unknown { "+tc.body+" }")
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 107 {
					count++
				}
			}
			if count != tc.want {
				t.Fatalf("EK0107 count=%d, want%d: %s", count, tc.want, tc.body)
			}
		})
	}
}
