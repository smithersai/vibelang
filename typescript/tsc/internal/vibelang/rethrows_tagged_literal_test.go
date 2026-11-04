package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// A tagged invocation receives the template object before its substitutions.
// Literal callback throws belong to the parameter named by @rethrows (003).
func TestRethrowsTaggedLiteralOwnership(t *testing.T) {
	const library = `/** @throws {Error} */
export declare function parse(s: string): string
/**
 * @throws {never}
 * @rethrows f
 */
export declare function tag<T>(parts: TemplateStringsArray, f: () => T): T
/**
 * @throws {never}
 * @rethrows f
 */
export declare function later<T>(parts: TemplateStringsArray, prefix: string, f: () => T): T
/**
 * @throws {never}
 * @rethrows left
 * @rethrows right
 */
export declare function pair(parts: TemplateStringsArray, left: () => string, right: () => string): void
/**
 * @throws {never}
 * @rethrows callbacks
 */
export declare function rest(parts: TemplateStringsArray, ...callbacks: (() => string)[]): void
export declare const holder: {
 /**
  * @throws {never}
  * @rethrows f
  */
 tag<T>(parts: TemplateStringsArray, f: () => T): T
}
`
	for _, row := range []struct {
		name, host, body string
		code             int32
	}{
		{"effect", "effect ", "const v = ⟦tag⟧`value: ${() => parse(s)}`", 403},
		{"method", "effect ", "const v = ⟦holder.tag⟧`value: ${() => parse(s)}`", 403},
		{"alias", "effect ", "const t = tag; const v = ⟦t⟧`value: ${() => parse(s)}`", 403},
		{"nested-tags", "effect ", "const v = ⟦tag⟧`outer: ${() => tag`inner: ${() => parse(s)}`}`", 403},

		{"plain", "", "const v = ⟦tag⟧`value: ${() => parse(s)}`", 401},
		{"parentheses", "effect ", "const v = ⟦tag⟧`value: ${((() => parse(s)))}`", 403},
		{"function", "effect ", "const v = ⟦tag⟧`value: ${function () { return parse(s) }}`", 403},
		{"later-parameter", "effect ", "const v = ⟦later⟧`prefix: ${s} value: ${() => parse(s)}`", 403},
		{"two-parameters", "effect ", "⟦pair⟧`left: ${() => parse(s)} right: ${() => parse(s)}`", 403},
		{"rest-parameter", "effect ", "⟦rest⟧`safe: ${() => s} bad: ${() => parse(s)}`", 403},
		{"safe", "effect ", "const v = tag`value: ${() => s}`", 0},
		{"caught-in-literal", "effect ", "const v = tag`value: ${() => { try { return parse(s) } catch { return s } }}`", 0},
		{"caught-in-host", "", "try { tag`value: ${() => parse(s)}` } catch { }", 0},
		{"bridge", "effect ", "const v = try Effect.try(() => tag`value: ${() => parse(s)}`)", 0},
		{"nested-function", "effect ", "const v = tag`value: ${() => { const f = () => ⟦parse(s)⟧; return s }}`", 401},
		{"async", "", "const v = tag`value: ${async () => parse(s)}`", 0},
		{"effect-body", "", "const v = tag`value: ${effect () => ⟦parse(s)⟧}`", 403},
		{"effect-parameter", "", "const v = tag`value: ${effect (x = ⟦parse(s)⟧) => x}`", 401},
	} {
		for _, ext := range []string{"ts", "d.ts"} {
			t.Run(row.name+"/"+ext, func(t *testing.T) {
				source := "import { parse, tag, later, pair, rest, holder } from \"./lib.js\"\nexport " + row.host + "function probe(s: string) {\n" + row.body + "\nreturn 0\n}"
				start := strings.Index(source, "⟦")
				end := strings.Index(source, "⟧") - len("⟦")
				source = strings.ReplaceAll(strings.ReplaceAll(source, "⟦", ""), "⟧", "")
				p, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: library})
				errors := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
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
					t.Errorf("got %d errors, want %d at the marked site", errors, want)
				}
			})
		}
	}
}
