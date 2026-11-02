package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
)

// A handler that runs Effect.fail is an effect function (VIP-1), and try runs
// the Effect (VIP-5); that is the call the direct-form fix edits to throw 1.
const factoryLabelSource = "export const cb:(...args:any[])=>number=Effect.catchTags({Bad:effect ()=>try Effect.fail(1)})\n"

func TestFixFactoryDiagnosticSurvivesArgumentEdit(t *testing.T) {
	p, file, _, _ := editorProgram(t, factoryLabelSource)
	before := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 2322 {
			before++
		}
	}
	if before != 1 {
		t.Fatalf("want one existing native return-type error; got %d", before)
	}
	result := FixProject(t.Context(), p.Host().FS(), bundled.LibPath(), p.CommandLine())
	fixed := result.Files[file.FileName()]
	if result.Err != nil || len(result.Refused) != 0 || fixed == nil || !strings.Contains(fixed.Text, "throw 1") {
		t.Fatalf("safe argument edit refused: %+v", result)
	}
}

func TestRepeatedFactoriesKeepDiagnosticIdentity(t *testing.T) {
	oldCall := "factory('old')"
	newCall := "factory('new')"
	head := "declare function factory<const T extends string>(value:T):()=>T;\ndeclare function take<T>(fn: (...args:any[])=>T):void;\n"
	before := head + "export const a=take<number>(" + oldCall + ");\nexport const b=take<any>(" + newCall + ");\n"
	next := head + "export const a=take<any>(" + oldCall + ");\nexport const b=take<number>(" + newCall + ");\n"

	p, file, _, _ := editorProgram(t, before)
	baseline := baselineOf(t.Context(), p)
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
