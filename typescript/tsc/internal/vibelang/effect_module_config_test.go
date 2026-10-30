package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestEffectModuleSwitchEditorCandidates(t *testing.T) {
	for _, setting := range []core.Tristate{core.TSUnknown, core.TSTrue, core.TSFalse} {
		program, file, _, _ := editorProgram(t, "export const languageHelper = wire\nexport function task() { return [Option.some(1), Hex.encode(new Uint8Array())] }")
		program.Options().VibeLang = &core.VibeLangOptions{EffectModules: setting}
		program.GetSemanticDiagnostics(t.Context(), file)
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		location := astnav.GetTouchingToken(file, strings.Index(file.Text(), "return"))
		for label, candidates := range map[string][]*ast.Symbol{
			"completion": preludeCompletions(c, location, ast.SymbolFlagsValue),
			"spelling":   preludeSpellingCandidates(c, location, ast.SymbolFlagsValue),
		} {
			names := map[string]bool{}
			for _, symbol := range candidates {
				names[symbol.Name()] = true
			}
			for _, name := range []string{"Option", "Hex", "Effect", "Schema", "Layer", "Scope", "pipe", "flow"} {
				if got, want := names[name], setting != core.TSFalse; got != want {
					t.Errorf("%s %s with setting %v: got %v, want %v", label, name, setting, got, want)
				}
			}
			for _, name := range []string{"fork", "wire", "TaggedError", "retry"} {
				if !names[name] {
					t.Errorf("%s lost language helper or function global %s with setting %v", label, name, setting)
				}
			}
		}
		done()
	}
}
