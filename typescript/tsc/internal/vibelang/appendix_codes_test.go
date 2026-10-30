package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"strings"
	"testing"
)

// Appendix B preserves the rule while assigning VIP-1 its own hundred-block.
func TestAppendixAwaitEffectCode(t *testing.T) {
	program, file, _, converters := editorProgram(t, "import { Effect } from \"effect\";\nexport async function f() { await Effect.succeed(1) }")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == 103 {
			lsp := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
			if lsp.Code == nil || lsp.Code.Integer == nil || *lsp.Code.Integer != 103 || lsp.Source == nil || *lsp.Source != "EK" {
				t.Fatalf("LSP did not preserve numeric code 103 with source EK: %+v", lsp)
			}
			caps := *lsproto.GetClientCapabilities(t.Context())
			caps.VSSupportsVisualStudioExtensions = true
			vs := lsconv.DiagnosticToLSPPush(lsproto.WithClientCapabilities(t.Context(), &caps), converters, d)
			if vs.Code == nil || vs.Code.String == nil || *vs.Code.String != "EK0103" {
				t.Fatalf("Visual Studio LSP code = %+v, want EK0103", vs.Code)
			}
			if m := registry[d.Code()]; m == nil || m.String() != "EK0103" {
				t.Fatalf("registered code = %v, want EK0103", m)
			}
			return
		}
	}
	t.Fatal("await on an Effect did not report Appendix B code EK0103")
}

// --fix summaries and refusals use the same public code spelling as diagnostics.
func TestAppendixFixReportCodes(t *testing.T) {
	const file tspath.RootedFilePath = "/main.vibe"
	result := FixResult{
		Files:   map[tspath.RootedFilePath]*FixedFile{file: {Counts: map[int32]int{103: 1}}},
		Order:   []tspath.RootedFilePath{file},
		Refused: []FixRefusal{{File: file, Line: 1, Code: 502, Error: "bad"}},
	}
	var out strings.Builder
	result.Report(&out, func(path tspath.RootedFilePath) string { return path.AsString() })
	for _, want := range []string{"EK0103 ×1", "EK0502 not fixed:"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("%q does not contain %q", out.String(), want)
		}
	}
}
