package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestDiagnosticFormatPreservesArgumentText(t *testing.T) {
	if got := format("{0} and {1}; {0}; {2}", []any{"{1}", "x"}); got != "{1} and x; {1}; {2}" {
		t.Errorf("format = %q", got)
	}
}

func TestDiagnosticPresentationRegressions(t *testing.T) {
	for _, tc := range []struct {
		name, source, span, text string
		code                     int32
	}{
		{"concurrency limit", "export effect function invalid() {\n for concurrent(\n /* limit */ \"many\") (const x of [1]) {}\n}", "\"many\"", "Types.Concurrency", 1907},
		{"service separator", "service Users { find(id: string): string list(): string }", "list", "The members of a service need a separator", 908},
		{"ambient abstract error", "declare abstract error Root { id: string }", "Root", "cannot be ambient", 1307},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			var codes []int32
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != diagnosticSource {
					continue
				}
				codes = append(codes, d.Code())
				if d.Code() == tc.code && (tc.source[d.Pos():d.End()] != tc.span || !strings.Contains(d.MessageText(), tc.text)) {
					t.Errorf("got span %q and message %q, want %q and text containing %q", tc.source[d.Pos():d.End()], d.MessageText(), tc.span, tc.text)
				}
			}
			if !slices.Equal(codes, []int32{tc.code}) {
				t.Errorf("got EK codes %v, want only %d", codes, tc.code)
			}
		})
	}
}

func TestDiagnosticDirectiveIgnoresTemplateText(t *testing.T) {
	for _, tc := range []struct {
		name, prefix string
		want         bool
	}{
		{"template head", "const text = `\n// @vibelang-diagnostics *:off\n`\n", true},
		{"template tail", "const text = `\n${1}\n// @vibelang-diagnostics *:off\n`\n", true},
		{"multiline string", "const text = \"\\\n// @vibelang-diagnostics *:off example\\\n\"\n", true},
		{"template expression comment", "const text = `\n${\n// @vibelang-diagnostics *:off\n1}\n`\n", false},
		{"block comment first line", "/* @vibelang-diagnostics *:off\n * explanation\n */\n", false},
		{"block comment interior line", "/**\n * @vibelang-diagnostics *:off\n * explanation\n */\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.prefix+"declare const run: any\nexport effect function main() { return run() }")
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4409.Code {
					found = true
					if d.Category() != diagnostics.CategoryWarning {
						t.Errorf("got category %v, want warning", d.Category())
					}
				}
			}
			if found != tc.want {
				t.Errorf("warning present = %v, want %v", found, tc.want)
			}
		})
	}
}

func TestCanonicalDiagnosticRegistry(t *testing.T) {
	for _, m := range []*Message{EK0407, EK0707, EK0901, EK0902, EK0903, EK1201, EK1401, EK2104, EK2301, EK2803, EK5501} {
		if got := registry[m.Code]; got != m {
			t.Errorf("registry[%s] = %#v, want %#v", m, got, m)
		}
	}
	if EK5501.Text != parser.DurableCallDiagnosticText {
		t.Errorf("durable diagnostic text = %q, want %q", EK5501.Text, parser.DurableCallDiagnosticText)
	}
}
