package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestConfiguredAwaitWarningInLanguageServer(t *testing.T) {
	for _, test := range []struct {
		category string
		severity lsproto.DiagnosticSeverity
	}{
		{"error", lsproto.DiagnosticSeverityError},
		{"warning", lsproto.DiagnosticSeverityWarning},
		{"suggestion", lsproto.DiagnosticSeverityHint},
		{"off", 0},
	} {
		t.Run(test.category, func(t *testing.T) {
			program, file, _, converters := editorProgramConfig(t, "import type { Fiber } from \"effect\"\nexport async function wait(fiber: Fiber.Fiber<number>) { return await fiber }", editorPackageJSON, editorPackages, fmt.Sprintf(`{"compilerOptions":{"strict":true,"module":"NodeNext","target":"ES2022","skipLibCheck":true,"noEmit":true},"files":["main.vibe"],"vibe":{"severities":{"EK4609":%q}}}`, test.category))
			found := false
			diagnostics := append(program.GetSemanticDiagnostics(t.Context(), file), program.GetSuggestionDiagnostics(t.Context(), file)...)
			for _, d := range diagnostics {
				if d.Source() != "EK" || d.Code() != 4609 {
					continue
				}
				found = true
				lsp := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
				if lsp.Severity == nil || *lsp.Severity != test.severity {
					t.Fatalf("LSP severity: %+v", lsp)
				}
			}
			if found != (test.category != "off") {
				t.Fatalf("warning presence=%v for %s", found, test.category)
			}
		})
	}
}
