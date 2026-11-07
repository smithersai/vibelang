// docs/design/vips/0034-compiler-and-tooling.md#acf50e7788cd53bb
// VIP-34: escaped directive versus strict directive semantic oracle rejects changed meaning.
package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// Chapter 007 / semantic comparison preserves directives, receivers, literal values and raw templates: docs/design/src/007-tooling.md#acf50e7788cd53bb
// Chapter 007 / semantic comparison preserves directives, receivers, literal values and raw templates: docs/design/src/007-tooling.md#9ce5d03719823cde
// Chapter 007 / semantic comparison preserves directives, receivers, literal values and raw templates: docs/design/src/007-tooling.md#91d061dfbfe52381
func TestToolsFormatSemanticContract(t *testing.T) {
	cases := []struct {
		name, before, after string
		same                bool
	}{
		{"quotes", "export const x = 'ok';", "export const x = \"ok\";", true},
		{"ordinary escapes", "export const x = '\\x61';", "export const x = 'a';", true},
		{"grouping", "export const x = (1);", "export const x = 1;", true},
		{"trailing comma", "export const x = {a: 1,};", "export const x = {a: 1};", true},
		{"function layout", "export function label() { return 'x' }", "export function label() {\n return \"x\";\n}", true},
		{"number spelling", "export const x = 0x10;", "export const x = 16;", true},
		{"bigint spelling", "export const x = 0x10n;", "export const x = 16n;", true},
		{"directive quotes", "'use strict'; function f() {}", "\"use strict\"; function f() {}", true},
		{"lone surrogate", "export const x = '\\uD800';", "export const x = '\\uD801';", false},
		{"data", "export const x = 'a';", "export const x = 'b';", false},
		{"operator", "export const x = a + b;", "export const x = a - b;", false},
		{"receiver", "export const x = obj.m();", "export const x = (0, obj.m)();", false},
		{"direct eval", "eval('x')", "(0, eval)('x')", false},
		{"optional boundary", "export const x = (a?.b).c;", "export const x = a?.b.c;", false},
		{"tagged raw", "export const x = tag`\\x61`;", "export const x = tag`a`;", false},
		{"tagged cooked", "export const x = tag`a`;", "export const x = tag`b`;", false},
		{"regex", "export const x = /a/g;", "export const x = /b/g;", false},
		{"escaped directive", "'use\\x20strict'; function f() {}", "'use strict'; function f() {}", false},
		{"directive grouping", "('use strict'); function f() {}", "'use strict'; function f() {}", false},
		{"directive boundary", "; 'use strict'; function f() {}", "'use strict'; function f() {}", false},
		{"parameter length", "function f(x) {}", "function f(x = 0) {}", false},
		{"function name", "export function f() {}", "export function g() {}", false},
		{"property name", "export const x = {a: 1};", "export const x = {b: 1};", false},
		{"declaration kind", "let x = 1;", "const x = 1;", false},
		{"async", "export function f() {}", "export async function f() {}", false},
		{"generator", "export function f() {}", "export function* f() {}", false},
		{"for child role", "for (a;;) {}", "for (;a;) {}", false},
		{"array hole", "export const x = [1,];", "export const x = [1,,];", false},
		{"binding scope", "{ let x = 1; }", "let x = 1;", false},
		{"declaration type", "export declare const x: string;", "export declare const x: number;", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			name := "out/main.js"
			if c.name == "declaration type" {
				name = "out/main.d.ts"
			}
			before := &Result{Outputs: map[string]string{name: c.before}}
			after := &Result{Outputs: map[string]string{name: c.after}}
			difference := toolsFormatDifference(before, after)
			if (difference == "") != c.same {
				t.Fatalf("same=%v, difference=%q", c.same, difference)
			}
		})
	}
}

// A real formatter run keeps an escaped string a non-directive. The oracle
// above rejects the opposite rewrite, so the two prologues stay distinct.
func TestToolsFormatEscapedDirectiveWitness(t *testing.T) {
	w := NewWorkspace(t)
	formatter := toolsFormatter(t)
	for _, c := range []struct{ name, source, kept string }{
		{"escaped", "'use\\x20strict'\nexport function f() {\n    'use\\u0020strict'\n    return 1\n}\n", "use\\x20strict|use\\u0020strict"},
		{"directive", "'use strict'\nexport function f() {\n    \"use strict\"\n    return 1\n}\n", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			once, err := vibelangfmt.Format("main.vibe", c.source, formatter)
			if err != nil {
				t.Fatal(err)
			}
			before, err := w.Compile(t.Context(), Single(c.source))
			if err != nil {
				t.Fatal(err)
			}
			defer before.Remove()
			after := toolsRecompile(t, w, before, Single(once).Files)
			// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#acf50e7788cd53bb | For example, changing an escaped string into an actual `use strict` directive changes meaning.
			for _, escape := range strings.Split(c.kept, "|") {
				if escape != "" && !strings.Contains(once, escape) {
					t.Fatalf("formatting dropped the escape %s:\n%s", escape, once)
				}
			}
			if difference := toolsFormatDifference(before, after); difference != "" {
				t.Fatalf("%s\n%s\n---\n%s", difference, c.source, once)
			}
			escaped := &Result{Outputs: map[string]string{"out/main.js": strings.ReplaceAll(strings.ReplaceAll(after.Outputs["out/main.js"], "use\\x20strict", "use strict"), "use\\u0020strict", "use strict")}}
			if c.kept != "" && toolsFormatDifference(after, escaped) == "" {
				t.Fatalf("the oracle accepts an escaped string turned into a directive:\n%s", after.Outputs["out/main.js"])
			}
		})
	}
}
