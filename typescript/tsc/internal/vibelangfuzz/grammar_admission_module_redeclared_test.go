package vibelangfuzz

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-40 compiles each module declaration to a JavaScript module of its own,
// and a module that redeclares a name of its file is EK4005. The redeclared
// module's body is then never compiled, so a native grammar error inside it
// is lost: `module twice { export export const b = 2 }` alone reports
// TS1030, but after another `module twice { }` the program reports EK4005
// alone. The Cases campaign found it by doubling `export` in the
// modules.fail case. Appendix A inherits TypeScript's grammar for the body,
// so the body must keep its rejections; the gap is keyed
// admission:module-redeclared-body until the compiler checks that body.
const grammarModuleRedeclaredWitness = "module twice { export const a = 1 }\nmodule twice { export export const b = 2 }"

// grammarModuleRedeclared reports two top-level module declarations with
// the same name, the shape under which a body's own rejection is lost.
func grammarModuleRedeclared(file *ast.SourceFile) bool {
	seen := map[string]bool{}
	for _, statement := range file.Statements.Nodes {
		if !parser.IsVibeLangModuleDeclaration(statement) {
			continue
		}
		name := statement.Name().Text()
		if name == "" {
			continue
		}
		if seen[name] {
			return true
		}
		seen[name] = true
	}
	return false
}

var grammarModuleRedeclaredGaps = []string{
	grammarModuleRedeclaredWitness,
	"module twice { }\nmodule twice { async async function f() { } }",
	"module twice { }\nmodule twice { readonly const b = 2 }",
}

func TestGrammarAdmissionModuleRedeclaredKeys(t *testing.T) {
	for _, source := range grammarModuleRedeclaredGaps {
		if got := grammarAdmissionForm(source); got != "admission:module-redeclared-body" {
			t.Errorf("key=%q, want admission:module-redeclared-body: %q", got, source)
		}
	}
	// The classifier reads the shape alone; the oracle consults it only for a
	// program the lab does not derive, so two well-formed same-named modules
	// never reach it. Distinct names and text that spells the form stay out.
	for _, source := range []string{
		"module once { export export const b = 2 }",
		"module a { export export const b = 2 }\nmodule c { }",
		"const s = 'module twice { } module twice { }';",
		"module { }\nmodule { }",
	} {
		if got := grammarAdmissionForm(source); got == "admission:module-redeclared-body" {
			t.Errorf("control keyed as a redeclared module body: %q", source)
		}
	}
}

func TestGrammarAdmissionModuleRedeclaredRegression(t *testing.T) {
	w := NewWorkspace(t)
	// A single module keeps its body's native grammar error (TS1030, TS1024),
	// and two modules with the same name and well-formed bodies derive.
	for _, source := range []string{
		"module once { export export const b = 2 }",
		"module once { readonly const b = 2 }",
		"module a { export export const b = 2 }\nmodule c { }",
		"module twice { export const a = 1 }\nmodule twice { export const b = 2 }",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("a checked module body reads as an admission gap: %q", source)
		}
	}
	for _, source := range grammarModuleRedeclaredGaps {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
