package parser_test

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// TestVibeLangDoEarlyErrors pins TC39's early errors for do expressions
// (VIP-2) and the code each one reports, at the statement it names.
func TestVibeLangDoEarlyErrors(t *testing.T) {
	for _, c := range []struct {
		text, at string
		code     int32
	}{
		{"function f() { return do { const a = 1 } }", "const a = 1", parser.DoEndsCode},
		{"function f() { return do { if (x) { 1 } } }", "if (x) { 1 }", parser.DoEndsCode},
		{"function f() { return do { while (x) {} } }", "while (x) {}", parser.DoEndsCode},
		{"function f() { return do { 1; if (x) { while (y) {} } else { 2 } } }", "while (y) {}", parser.DoEndsCode},
		{"function f() { return do { l: { let x = 1; break l } } }", "let x = 1;", parser.DoEndsCode},
		{"function f() { return do { switch (x) { case 1: let y = 1; break } } }", "let y = 1;", parser.DoEndsCode},
		{"function f() { for (const x of do { break; [] }) {} }", "break;", parser.DoLoopHeadCode},
		{"function f() { l: for (const x of do { continue l; [] }) {} }", "continue l;", parser.DoLoopHeadCode},
		{"function f(a = do { var y = 1; y }) {}", "var y = 1", parser.DoParameterVarCode},
		{"function f(a = do { return 1 }) {}", "return 1", parser.DoBoundaryCode},
		{"class C { x = do { var y = 1; y } }", "var y = 1", parser.DoBoundaryCode},
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, c.text, core.ScriptKindTS)
		items := file.Diagnostics()
		if len(items) != 1 || items[0].Source() != "EK" || items[0].Code() != c.code {
			t.Errorf("%s: want one EK%d, got %v", c.text, c.code, items)
			continue
		}
		if got := c.text[items[0].Pos():items[0].End()]; got != c.at {
			t.Errorf("%s: EK%d at %q, want %q", c.text, c.code, got, c.at)
		}
	}
	for _, text := range []string{
		"function f(n) { const v = match (n) { default: do { return 1 } }; return v }",
		"function f() { return do {} }",
		"function f() { return do { var n = 1; n } }",
		"effect function f() { return do { uninterruptible {} } }",
		"function f() { return do { 1; ; } }",
		"function f() { return do { 1; l: { break l } } }",
		"function f() { return do { l: { 1; break l } } }",
		"function f() { return do { switch (x) { case 1: 2; break; default: 3 } } }",
		"function f() { return do { try { 1 } finally { let z = 2 } } }",
		"function f() { for (;;) { const v = do { if (x) { break } else { continue } } } }",
		"function f() { var a = do { var b = 1; b }; return a + b }",
		"async function f() { return do { await g() } }",
		"function f() { return g(do { return 7; 0 }) }",
		"function f() { g(do { var n = 3; n }); return n }",
		"function f() { return x.map((y) => do { if (y) { return 1 } 2 }) }",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, text, core.ScriptKindTS)
		if len(file.Diagnostics()) != 0 {
			t.Errorf("valid do expression rejected: %v\n%s", file.Diagnostics(), text)
		}
	}
}

// TestVibeLangDoSnapshot keeps the pinned snapshot's constants and its
// vendored copy in step.
func TestVibeLangDoSnapshot(t *testing.T) {
	readme, err := os.ReadFile("../../../../docs/design/vips/tc39-do-expressions/README.md")
	if err != nil {
		t.Skipf("vendored snapshot not found: %v", err)
	}
	for _, want := range []string{parser.DoExpressionsCommit, parser.DoExpressionsDate} {
		if !strings.Contains(string(readme), want) {
			t.Errorf("docs/design/vips/tc39-do-expressions/README.md does not name %s", want)
		}
	}
}

// Every label in a consecutive chain denotes the same loop (VIP-2,
// Appendix B EK0205), whereas a label around a different loop is exempt.
func TestVibeLangDoLoopHeadLabels(t *testing.T) {
	heads := []struct{ name, text string }{
		{"while", "while ($do) {}"},
		{"do-while", "do {} while ($do);"},
		{"for-initializer", "for ($do; false;) {}"},
		{"for-declaration", "for (let value = $do; false;) {}"},
		{"for-condition", "for (; $do;) {}"},
		{"for-update", "for (; false; $do) {}"},
		{"for-of", "for (const value of $do) {}"},
		{"for-in", "for (const value in $do) {}"},
		{"for-binding-default", "for (const { value = $do } of [{}]) {}"},
	}
	for _, head := range heads {
		for length := 1; length <= 3; length++ {
			var labels []string
			for i := 0; i < length; i++ {
				labels = append(labels, fmt.Sprintf("label%d", i))
			}
			for _, keyword := range []string{"break", "continue"} {
				for _, target := range append(append([]string{""}, labels...), "enclosing", "local", "local-loop", "function") {
					name := fmt.Sprintf("%s/%d/%s/%s", head.name, length, keyword, target)
					t.Run(name, func(t *testing.T) {
						jump := keyword + ";"
						if target != "" {
							jump = keyword + " " + target + ";"
						}
						body := jump + " []"
						want := 1
						switch target {
						case "enclosing":
							want = 0
						case "local":
							body = "local: while (true) { " + jump + " } []"
							want = 0
						case "local-loop":
							body = "while (true) { " + keyword + "; } []"
							want = 0
						case "function":
							body = "function g() { while (true) { " + keyword + "; } } []"
							want = 0
						}
						loop := strings.ReplaceAll(head.text, "$do", "do { "+body+" }")
						text := "function f() { enclosing: while (true) { " + strings.Join(labels, ": ") + ": " + loop + " } }"
						file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, text, core.ScriptKindTS)
						got := 0
						for _, d := range file.Diagnostics() {
							if d.Source() == "EK" && d.Code() == parser.DoLoopHeadCode {
								got++
								if at := text[d.Pos():d.End()]; at != jump {
									t.Errorf("EK0205 at %q, want %q", at, jump)
								}
							} else if d.Source() != "EK" || d.Code() != parser.DoBoundaryCode {
								t.Errorf("unexpected diagnostic: %v", d)
							}
						}
						// EK0204 may additionally own an unsupported lowering
						// position; it must never hide the loop-head early error.
						if got != want {
							t.Errorf("want EK0205 x%d, got x%d: %v\n%s", want, got, file.Diagnostics(), text)
						}
					})
				}
			}
		}
	}
}
