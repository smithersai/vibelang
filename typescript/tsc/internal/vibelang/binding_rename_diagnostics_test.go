package vibelang

import (
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const bindingAdviceSource = "export function pick(a: unknown, b: unknown) { if (a is { id: let id }) return id; if (b is { id: let id }) return id; return 0 }"
const bindingAdviceWant = "Two is patterns bind id in one block: use distinct names or separate blocks."

func TestBindingRenameAdvice(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         int
	}{
		{"patterns", bindingAdviceSource, 2},
		{"three patterns", "export function f(a: unknown) { if (a is let id) {} if (a is let id) {} if (a is let id) {} }", 3},
		{"local", "export function f(a: unknown) { const id = 0; if (a is { const id }) {} }", 2},
		{"parameter", "export function f(id: number, a: unknown) { if (a is { id: let id }) {} }", 2},
		{"separate blocks", "export function f(a: unknown) { { if (a is let id) {} } { if (a is let id) {} } }", 0},
		{"ordinary duplicate", "export function f() { let id = 0; let id = 1; }", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				text := diagnosticWithNotes(d)
				if strings.Contains(text, "quick fix") {
					t.Errorf("diagnostic promises an unavailable quick fix: %s", text)
				}
				for _, child := range d.MessageChain() {
					if child.MessageText() == bindingAdviceWant {
						count++
					}
				}
			}
			if count != tc.want {
				t.Errorf("binding advice count = %d, want %d", count, tc.want)
			}
			for _, d := range file.BindDiagnostics() {
				if len(d.MessageChain()) != 0 {
					t.Errorf("shared bind diagnostic was changed: %s", diagnosticWithNotes(d))
				}
			}
		})
	}
}

type bindingAdviceSharedHost struct {
	compiler.CompilerHost
	file *ast.SourceFile
}

func (h bindingAdviceSharedHost) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	if opts.FileName == h.file.FileName() {
		return h.file
	}
	return h.CompilerHost.GetSourceFile(opts)
}

func TestBindingRenameSharedDiagnostics(t *testing.T) {
	first, file, _, _ := editorProgram(t, bindingAdviceSource)
	first.BindSourceFiles()
	second := compiler.NewProgram(compiler.ProgramOptions{
		Config: first.CommandLine(),
		Host:   bindingAdviceSharedHost{CompilerHost: first.Host(), file: file},
	})
	second.BindSourceFiles()
	if second.GetSourceFile(file.FileName()) != file {
		t.Fatal("programs do not share the parsed file")
	}
	ds := file.BindDiagnostics()
	if len(ds) != 2 {
		t.Fatalf("bind diagnostics = %d, want 2", len(ds))
	}
	c1, done1 := first.GetTypeCheckerForFile(t.Context(), file)
	defer done1()
	c2, done2 := second.GetTypeCheckerForFile(t.Context(), file)
	defer done2()
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, c := range []*checker.Checker{c1, c2} {
		wg.Go(func() {
			<-start
			for range 16 {
				got := explainBindingRename(c, file, slices.Clip(ds))
				for i, d := range got {
					if d == ds[i] {
						t.Error("annotated diagnostic aliases the shared bind diagnostic")
					}
					if len(d.MessageChain()) != 1 || d.MessageChain()[0].MessageText() != bindingAdviceWant {
						t.Errorf("binding advice = %s", diagnosticWithNotes(d))
					}
				}
				again := explainBindingRename(c, file, got)
				if &again[0] != &got[0] {
					t.Error("unchanged diagnostics should retain their slice")
				}
				for i := range got {
					if again[i] != got[i] || len(again[i].MessageChain()) != 1 {
						t.Error("repeated hook changed an already annotated diagnostic")
					}
				}
			}
		})
	}
	close(start)
	wg.Wait()
	for _, d := range ds {
		if len(d.MessageChain()) != 0 {
			t.Error("shared bind diagnostics carry checker-owned advice")
		}
	}
}

func TestBindingRenamePreservesExistingNotes(t *testing.T) {
	p, file, _, _ := editorProgram(t, bindingAdviceSource)
	p.BindSourceFiles()
	c, done := p.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	original := file.BindDiagnostics()[0].Clone()
	chain := make([]*ast.Diagnostic, 1, 4)
	chain[0] = ast.NewExternalDiagnostic(nil, core.TextRange{}, diagnosticSource, diagnostics.CategoryMessage, 0, "Existing advice.")
	original.SetMessageChain(chain)
	unrelated := ast.NewExternalDiagnostic(file, core.TextRange{}, "", diagnostics.CategoryError, 9999, "Unrelated.")
	ds := []*ast.Diagnostic{original, unrelated}
	got := explainBindingRename(c, file, ds)
	if ds[0] != original || got[0] == original || got[1] != unrelated {
		t.Fatal("hook did not preserve input slice and unrelated diagnostic")
	}
	if len(original.MessageChain()) != 1 || chain[:cap(chain)][1] != nil {
		t.Fatal("hook changed the original message-chain storage")
	}
	if len(got[0].MessageChain()) != 2 || got[0].MessageChain()[0] != chain[0] || got[0].MessageChain()[1].MessageText() != bindingAdviceWant {
		t.Fatalf("existing advice was lost or duplicated: %s", diagnosticWithNotes(got[0]))
	}
}
