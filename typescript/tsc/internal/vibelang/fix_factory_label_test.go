package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
)

const factoryLabelSource = "export const cb:(...args:any[])=>void=Effect.catchTags({Bad:()=>Effect.fail(1)})\n"

func TestFixFactoryDiagnosticSurvivesArgumentEdit(t *testing.T) {
	p, file, _, _ := editorProgram(t, factoryLabelSource)
	before := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4301.Code {
			before++
		}
	}
	if before != 1 {
		t.Fatalf("want one existing callback error; got %d", before)
	}
	result := FixProject(t.Context(), p.Host().FS(), bundled.LibPath(), p.CommandLine())
	fixed := result.Files[file.FileName()]
	if result.Err != nil || len(result.Refused) != 0 || fixed == nil || !strings.Contains(fixed.Text, "throw 1") {
		t.Fatalf("safe argument edit refused: %+v", result)
	}
}

func TestRepeatedFactoriesKeepDiagnosticIdentity(t *testing.T) {
	oldCall := "Effect.catchTags({Bad:()=>Effect.fail('old')})"
	newCall := "Effect.catchTags({Bad:()=>Effect.fail('new')})"
	before := "export const a:(...args:any[])=>void=" + oldCall + ";\nexport const b:infer _=" + newCall + ";\n"
	next := "export const a:infer _=" + oldCall + ";\nexport const b:(...args:any[])=>void=" + newCall + ";\n"
	p, file, _, _ := editorProgram(t, before)
	baseline := errorCounts(t.Context(), p)
	fs := wrapvfs.Wrap(p.Host().FS(), wrapvfs.Replacements{ReadFile: func(name tspath.RootedFilePath) (string, bool) {
		if name == file.FileName() {
			return next, true
		}
		return p.Host().FS().ReadFile(name)
	}})
	after := compiler.NewProgram(compiler.ProgramOptions{Config: p.CommandLine(), Host: compiler.NewCompilerHost(fs, p.Host().DefaultLibraryPath(), nil, nil, nil)})
	if added := addedErrors(t.Context(), after, baseline); len(added) == 0 {
		t.Fatal("a new callback error replaced an old one under a repeated factory name")
	}
}

func TestFactoryLabelRejectsComputedCallee(t *testing.T) {
	_, file, _, _ := editorProgram(t, "declare const factories:any;declare const name:string;export const x=factories[name]({Bad:()=>Effect.fail(1)});\n")
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsCallExpression(n) && ast.IsElementAccessExpression(n.Expression()) {
			if got := stableFactoryResultLabel(file, n); got != "" {
				t.Fatalf("computed factory got stable label %q", got)
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
