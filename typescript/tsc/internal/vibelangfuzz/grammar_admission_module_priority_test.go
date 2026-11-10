package vibelangfuzz

import (
	"testing"
)

// A redeclared inline module is not compiled. Its lost syntax diagnostics
// therefore take precedence over a construct nested in that unchecked body.
const grammarModuleRedeclaredPriorityWitness = "module twice { export const a = 1 }\nmodule twice { => try export export const b = 2 }"

var grammarModuleRedeclaredPriorityBodies = []string{
	"=> try export export const b = 2",
	"const f = () => try p;",
	"function f() { return try p; }",
	"function* f() { return try p; }",
	"const f = () => p catch () => 1;",
	"const x = p catch 1;",
	"const x = effect { return 1; };",
	"schema C { static id: string }",
	"schema C { async id: string }",
	"schema C { id: string = 'x' }",
	"type T = number!;",
	"const x = throw e;",
}

func TestGrammarAdmissionModulePriorityKeys(t *testing.T) {
	for _, body := range grammarModuleRedeclaredPriorityBodies {
		source := "module twice {}\nmodule twice { " + body + " }"
		if got := grammarAdmissionForm(source); got != "admission:module-redeclared-body" {
			t.Errorf("key=%q, want admission:module-redeclared-body: %q", got, source)
		}
	}
	if got := grammarAdmissionForm(grammarModuleRedeclaredPriorityWitness); got != "admission:module-redeclared-body" {
		t.Errorf("campaign witness key=%q", got)
	}
	for _, source := range []string{
		"const f = () => try p;",
		"module once { const f = () => try p; }",
		"module one {}\nmodule two { const f = () => try p; }",
		"const s = 'module twice {} module twice { => try p }';",
		"// module twice {}\nmodule twice { const f = () => try p; }",
		"function f() { module twice {} }\nmodule twice { const f = () => try p; }",
	} {
		if got := grammarAdmissionForm(source); got == "admission:module-redeclared-body" {
			t.Errorf("checked-body control keyed as a duplicate module: %q", source)
		}
	}
}

func TestGrammarAdmissionModulePriorityRegression(t *testing.T) {
	w := NewWorkspace(t)
	// Check the minimized campaign witness explicitly. The remaining bodies
	// exercise the same existing pending family with independent mutations.
	for _, body := range grammarModuleRedeclaredPriorityBodies {
		source := "module twice {}\nmodule twice { " + body + " }"
		t.Run(body, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	checkGrammarAdmission(t, w, grammarAdmissionMutationKey(grammarModuleRedeclaredPriorityWitness), grammarModuleRedeclaredPriorityWitness)
}
