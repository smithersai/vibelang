package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestDoConcurrentEnding(t *testing.T) {
	for _, head := range []string{"for concurrent", "for concurrent(2)", "for try", "for concurrent(2) (const { n } of rows)"} {
		for _, test := range []struct {
			name, body string
			bad        bool
		}{
			{"final", "LOOP {}", true},
			{"empty-suffix", "LOOP {}; {}; ;", true},
			{"label", "label: LOOP {}", true},
			{"nested-block", "{ LOOP {} }", true},
			{"if-else", "if (true) { LOOP {} } else { 1 }", true},
			{"switch", "switch (1) { default: LOOP {}; break }", true},
			{"nonfinal", "LOOP {}; 1", false},
			{"nonfinal-body-visited", "label: { LOOP { let x; break label }; 1 }", true},
			{"nonfinal-body-value", "label: { LOOP { let x; x; break label }; 1 }", false},
		} {
			t.Run(head+"/"+test.name, func(t *testing.T) {
				loop := head
				if !strings.Contains(head, "rows") {
					loop += " (const n of xs)"
				}
				source := "effect function f() { return do { " + strings.ReplaceAll(test.body, "LOOP", loop) + " } }"
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				items := file.Diagnostics()
				if test.bad {
					if len(items) != 1 || items[0].Source() != "EK" || items[0].Code() != parser.DoEndsCode {
						t.Fatalf("want one EK0201, got %v\n%s", items, source)
					}
					if test.name != "nonfinal-body-visited" && !strings.Contains(items[0].MessageText(), "a loop") {
						t.Fatalf("diagnostic should identify a loop: %v", items)
					}
				} else if len(items) != 0 {
					t.Fatalf("valid nonfinal loop: %v\n%s", items, source)
				}
			})
		}
	}
}
