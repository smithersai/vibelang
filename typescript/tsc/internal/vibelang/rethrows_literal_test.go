package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 3: calls known to throw in a literal passed to a @rethrows
// parameter belong to the enclosing call. Nested source callables retain
// their own contexts, and caught exceptions do not escape the literal.
func TestRethrowsLiteralOwnership(t *testing.T) {
	const library = `/** @throws {Error} */
export declare function parse(s: string): string
/** @throws {Error} */
export declare function makeBase(): new () => object
/**
 * @throws {never}
 * @rethrows f
 */
export declare function invoke<T>(f: () => T): T
/**
 * @throws {never}
 * @rethrows f
 */
export declare function consume<T>(f: () => T): void
export declare class Invoke {
/**
 * @throws {never}
 * @rethrows f
 */
constructor(f: () => string)
}`
	for _, row := range []struct {
		name, host, body string
		code             int32
	}{
		{"effect-call", "effect ", "const v = ⟦invoke(() => parse(s))⟧", 403},
		{"plain-call", "", "const v = ⟦invoke(() => parse(s))⟧", 401},
		{"nested-call", "effect ", "const v = ⟦invoke(() => invoke(() => parse(s)))⟧", 403},
		{"array-map", "effect ", "const v = ⟦xs.map((x) => parse(x))⟧", 403},
		{"effect-constructor", "effect ", "const v = ⟦new Invoke(() => parse(s))⟧", 403},
		{"plain-constructor", "", "const v = ⟦new Invoke(() => parse(s))⟧", 401},
		{"safe", "effect ", "const v = invoke(() => s)", 0},
		{"safe-constructor", "effect ", "const v = new Invoke(() => s)", 0},
		{"caught-literal", "effect ", "const v = invoke(() => { try { return parse(s) } catch { return s } })", 0},
		{"caught-call", "", "try { invoke(() => parse(s)) } catch { }", 0},
		{"caught-constructor", "", "try { new Invoke(() => parse(s)) } catch { }", 0},
		{"bridge", "effect ", "const v = try Effect.try(() => invoke(() => parse(s)))", 0},
		{"constructor-bridge", "effect ", "const v = try Effect.try(() => new Invoke(() => parse(s)))", 0},
		{"nested-function", "effect ", "const v = invoke(() => { const f = () => ⟦parse(s)⟧; return s })", 401},
		{"async", "", "const v = invoke(async () => parse(s))", 0},
		{"class-field", "", "const v = invoke(() => { class C { value = ⟦parse(s)⟧ }; return 0 })", 401},
		{"effect-body", "", "const v = consume(effect () => { return ⟦parse(s)⟧ })", 403},
		{"effect-parameter", "", "const v = consume(effect (x = ⟦parse(s)⟧) => x)", 401},
		{"effectful-factory-body", "", "const v = consume(() => { const x = ⟦parse(s)⟧; return Effect.succeed(x) })", 401},
		{"effectful-factory-parameter", "", "const v = consume((x = ⟦parse(s)⟧) => Effect.succeed(x))", 401},
		{"mixed-factory", "", "⟦consume⟧(() => { const x = parse(s); return s.length ? Effect.succeed(x) : undefined })", 401},
		{"class-base", "effect ", "const v = ⟦invoke⟧(() => { class C extends makeBase() {}; return s })", 403},
		{"enum-initializer", "effect ", "const v = ⟦invoke⟧(() => { enum E { Value = parse(s).length }; return E.Value })", 403},
		{"do-expression", "effect ", "const v = ⟦invoke⟧(() => do { parse(s) })", 403},
		{"class-static-block", "effect ", "const v = invoke(() => { class C { static { ⟦parse(s)⟧ } }; return s })", 401},
		{"class-base-bridge", "effect ", "const v = try Effect.try(() => invoke(() => { class C extends makeBase() {}; return s }))", 0},
		{"class-base-caught", "effect ", "const v = invoke(() => { try { class C extends makeBase() {}; return s } catch { return s } })", 0},
		{"enum-caught", "effect ", "const v = invoke(() => { try { enum E { Value = parse(s).length }; return E.Value } catch { return 0 } })", 0},
		{"do-caught", "effect ", "const v = invoke(() => { try { return do { parse(s) } } catch { return s } })", 0},
	} {
		for _, ext := range []string{"ts", "d.ts"} {
			t.Run(row.name+"/"+ext, func(t *testing.T) {
				source := "import { parse, makeBase, invoke, consume, Invoke } from \"./lib.js\"\nexport " + row.host + "function probe(s: string, xs: string[]) {\n" + row.body + "\nreturn 0\n}"
				start := strings.Index(source, "⟦")
				end := strings.Index(source, "⟧") - len("⟦")
				source = strings.ReplaceAll(strings.ReplaceAll(source, "⟦", ""), "⟧", "")
				program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: library})
				errors := 0
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					errors++
					if row.code == 0 || d.Source() != diagnosticSource || d.Code() != row.code || d.Pos() > end || d.End() < start {
						t.Errorf("unexpected diagnostic: %s", d.String())
					}
				}
				want := 0
				if row.code != 0 {
					want = 1
				}
				if errors != want {
					t.Error(fmt.Sprintf("got %d errors, want %d at the marked site", errors, want))
				}
			})
		}
	}
}
