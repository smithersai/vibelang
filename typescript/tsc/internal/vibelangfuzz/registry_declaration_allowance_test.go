package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"strings"
	"testing"
)

// A declaration allowance is never an assignment or an emitted-code waiver.
// This checks the diagnostic oracle, not compiler behavior.
func TestRegistryDeclarationAllowanceQuoted(t *testing.T) {
	requireQuote(currentSpecText("900-appendices.md"), "Every diagnostic has an `EK` code and a message that says how to fix it (VIP-34).")
}

func checkDeclarationAllowance(t *testing.T, code int32, warning, defaults bool) {
	t.Helper()
	if Facts().IsRegistered(code) {
		t.Fatalf("%s is now assigned; retire its declaration-only allowance", specCodeName(code))
	}
	const name = "/project/main.vibe"
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName: tspath.RootedFilePathFromAbsolute(name), PathKey: tspath.PathKey(name),
	}, "1", core.ScriptKindTS)
	category := diagnostics.CategoryError
	if warning {
		category = diagnostics.CategoryWarning
	}
	d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", category, code, "declaration allowance probe")
	gaps := &Gaps{}
	CheckDiagnostics(gaps, "/project", []*ast.Diagnostic{d}, defaults)
	want := "registry:" + specCodeName(code)
	if len(gaps.found) != 1 || gaps.found[0].key != want {
		t.Fatalf("declaration-only %s must still fail the emission oracle: %+v", specCodeName(code), gaps.found)
	}
}

func TestRegistryDeclarationAllowancesStayStrict(t *testing.T) {
	for code, reason := range legacyDeclared {
		if strings.Contains(reason, "declaration only: ") {
			t.Run(specCodeName(code), func(t *testing.T) { checkDeclarationAllowance(t, code, false, true) })
		}
	}
	for _, code := range []int32{4301, 4406, 4611, 4612, 4704} {
		for _, target := range []string{"FuzzCompile", "FuzzSplice"} {
			for _, key := range []string{"registry:" + specCodeName(code), "corpus:registry-" + specCodeName(code)} {
				if _, ok := Pending(target, key); ok {
					t.Errorf("%s %s: graduated witness must not waive emissions", target, key)
				}
			}
		}
	}
}

func FuzzRegistryDeclarationAllowances(f *testing.F) {
	startShortBudget(f)
	keys := []string{"EK4301", "EK4406", "EK4611", "EK4612", "EK4704"}
	for _, key := range keys {
		f.Add(key, false, true)
	}
	f.Fuzz(func(t *testing.T, key string, warning, defaults bool) {
		// Stable textual keys preserve the named neighbourhood under corpus replay.
		if len(key) < 6 || len(key) > 12 {
			return
		}
		var code int32
		if _, err := fmt.Sscanf(key, "EK%d", &code); err != nil {
			return
		}
		if key != specCodeName(code) {
			return
		}
		reason, ok := legacyDeclared[code]
		if !ok || !strings.Contains(reason, "declaration only: ") {
			return
		}
		checkDeclarationAllowance(t, code, warning, defaults)
	})
}
