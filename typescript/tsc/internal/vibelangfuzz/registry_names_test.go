package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Appendix B spells VIP-block identities with four digits, including zeroes;
// imported ordinals past 99 extend the complete code rather than truncating it.
func TestDiagnosticCodeNames(t *testing.T) {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/project/main.vibe", PathKey: "/project/main.vibe"}, "x", core.ScriptKindTS)
	for _, test := range []struct {
		code      int32
		name, gap string
	}{
		{100, "EK0100", "registry:EK0100"},
		{101, "EK0101", "ek:EK0101"},
		{38108, "EK38108", ""},
	} {
		// EK38108 keeps its table default, so only its name is under test.
		category := diagnostics.CategoryWarning
		if test.gap == "" {
			category = diagnostics.CategoryError
		}
		d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", category, test.code, "identity")
		if got := diagnosticKey(d); got != test.name {
			t.Errorf("diagnosticKey(%d) = %s, want %s", test.code, got, test.name)
		}

		for path, got := range map[string]string{
			"key text":     (DiagnosticKey{Source: "EK", Code: test.code}).String(),
			"global CLI":   (cliDiagnostic{Prefix: "EK", Code: int(test.code)}).String(),
			"file CLI":     (cliDiagnostic{File: "main.vibe", Prefix: "EK", Code: int(test.code)}).String(),
			"formatter":    toolsFormatKey(&Result{Diagnostics: []*ast.Diagnostic{d}}, &Result{}),
			"native await": strings.Join(nativeAwaitOptionCodes(&Result{Diagnostics: []*ast.Diagnostic{d}}), ", "),
		} {
			if !strings.Contains(got, test.name) {
				t.Errorf("%s: got %q, want %s", path, got, test.name)
			}
		}
		source, kind := "EK", lsproto.CodeActionKindQuickFix
		lsp := &lsproto.Diagnostic{Source: &source, Code: &lsproto.IntegerOrString{Integer: &test.code}}
		if got := toolsActionKey(&lsproto.CodeAction{Kind: &kind}, lsp); got != test.name {
			t.Errorf("quick fix key = %s, want %s", got, test.name)
		}
		if got := toolsDiagnosticKey(lsp); !strings.HasPrefix(got, test.name+" ") {
			t.Errorf("LSP key = %s, want %s", got, test.name)
		}

		g := &Gaps{}
		CheckDiagnostics(g, "/project", []*ast.Diagnostic{d}, true)
		if test.gap == "" {
			if g.Any() {
				t.Errorf("%s: unexpected gaps %+v", test.name, g.found)
			}
		} else if len(g.found) != 1 || g.found[0].key != test.gap {
			t.Errorf("%s: gaps %+v, want %s", test.name, g.found, test.gap)
		}
	}
	if got := diagnosticCodeName("TS", 42); got != "TS42" {
		t.Errorf("TypeScript identity changed: %s", got)
	}
	for _, name := range []string{"EK0508", "EK0703", "EK0801", "EK38108"} {
		if problems := settingProblems(map[string]any{"severities": map[string]any{name: "off"}}); len(problems) != 0 {
			t.Errorf("canonical settings key %s: %v", name, problems)
		}
	}
	if got := deadKey(PendingEntry{Key: "registry:EK38108"}); got == "" {
		t.Error("a registered extended imported identity left a live registry gap")
	}
	if got := deadKey(PendingEntry{Key: "ek:EK38108"}); got != "" {
		t.Errorf("extended imported identity is registered: %s", got)
	}

	if problems := settingProblems(map[string]any{"severities": map[string]any{"EK508": "off"}}); len(problems) == 0 {
		t.Error("noncanonical EK508 admitted")
	}
}
