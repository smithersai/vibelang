package vibelangfuzz

import (
	"context"
	"maps"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzModuleSpecifierExpressions compiles import and export declarations
// whose module specifier is an expression other than a string, with
// declaration output on.
//
// Appendix A: "ModuleSpecifier = StringLiteral | IdentifierReference". Any
// other specifier is a syntax error, so each such cell must report an error,
// and no input may make the compiler panic (a panic is keyed by the function
// that panicked). The witness is a fuzzer's input: import type { Model }
// from throw './model.js' followed by a type that uses Model, which panicked
// in declaration emit.
const specifierTarget = "FuzzModuleSpecifierExpressions"

const specifierQuote = "ModuleSpecifier = StringLiteral | IdentifierReference"

func TestModuleSpecifierExpressionsQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", specifierQuote)
}

// The specifiers. string is the control: a StringLiteral naming model.ts.
var specifierExpressions = map[string]string{
	"string":        `'./model.js'`,
	"throw":         `throw './model.js'`,
	"throw-group":   `(throw './model.js')`,
	"template":      "`./model.js`",
	"concat":        `'./model' + '.js'`,
	"call":          `resolve('./model.js')`,
	"await":         `await './model.js'`,
	"parenthesized": `('./model.js')`,
	"member":        "paths.model",
	"number":        "1",
}

// The declarations; %s is the specifier.
var specifierForms = map[string]string{
	"import-type-named": "import type { Model } from %s",
	"import-named":      "import { Model } from %s",
	"import-namespace":  "import * as Model from %s",
	"import-default":    "import Model from %s",
	"import-equals":     "import Model = require(%s)",
	"side-effect":       "import %s",
	"export-named":      "export { Model } from %s",
	"export-type-named": "export type { Model } from %s",
	"export-star":       "export * from %s",
	"export-star-as":    "export * as Model from %s",
}

// What follows the declaration. bang is the witness's use: a contract type
// over the imported name.
var specifierUses = map[string]string{
	"bang":  "export type Program = Model ! !\n",
	"alias": "export type Alias = Model\n",
	"value": "export const value: Model = 1 as never\n",
	"none":  "",
}

type specifierCase struct {
	expression, form, use string
	vibex                 bool
}

func (c specifierCase) key() string {
	ext := "vibe"
	if c.vibex {
		ext = "vibex"
	}
	return c.expression + "/" + c.form + "/" + c.use + "/" + ext
}

func (c specifierCase) project() Project {
	main := "main.vibe"
	if c.vibex {
		main = "main.vibex"
	}
	source := strings.Replace(specifierForms[c.form], "%s", specifierExpressions[c.expression], 1) + "\n" + specifierUses[c.use]
	project := Project{Files: map[string]string{
		"package.json": `{"type":"module"}`,
		"model.ts":     "export type Model = number\nexport const Model = 1\nexport default Model\n",
		main:           source,
	}}
	if c.vibex {
		project.Config = strings.Replace(DefaultConfig, `"target":`, `"jsx": "preserve", "target":`, 1)
	}
	return project
}

// declaration reports whether the cell is an import or export declaration:
// import followed by a parenthesized expression is a dynamic import() call,
// which takes any expression.
func (c specifierCase) declaration() bool {
	return c.form != "side-effect" || !strings.HasPrefix(specifierExpressions[c.expression], "(")
}

func specifierCases() []specifierCase {
	var cases []specifierCase
	for _, e := range slices.Sorted(maps.Keys(specifierExpressions)) {
		for _, f := range slices.Sorted(maps.Keys(specifierForms)) {
			for _, u := range slices.Sorted(maps.Keys(specifierUses)) {
				for _, vibex := range []bool{false, true} {
					cases = append(cases, specifierCase{e, f, u, vibex})
				}
			}
		}
	}
	return cases
}

// specifierCheck compiles a cell on the calling goroutine, so a compiler
// panic reaches recoverCompilerPanic, and checks that a specifier the
// grammar does not admit is an error.
func specifierCheck(t *testing.T, w *Workspace, c specifierCase) {
	t.Helper()
	defer recoverCompilerPanic(t, specifierTarget)
	r, err := w.CompileOrdered(context.Background(), c.project(), OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	if c.declaration() && c.expression != "string" {
		errors := 0
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError && d.File() != nil && strings.Contains(string(d.File().FileName()), "/main.vibe") {
				errors++
			}
		}
		gap := "accepted:" + c.expression + "/" + c.form
		if errors == 0 {
			Gap(t, specifierTarget, gap, "%s: the specifier %s is neither, yet main reports no error\n%s", specifierQuote, specifierExpressions[c.expression], c.project().Files["main.vibe"]+c.project().Files["main.vibex"])
		}
		ExpectPending(t, specifierTarget, gap)
	}
}

func FuzzModuleSpecifierExpressions(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "900-appendices.md", specifierQuote)
	cases := specifierCases()
	keys := make([]string, len(cases))
	for i, c := range cases {
		keys[i] = c.key()
	}
	// Each specifier in each declaration once, with the witness's use; the
	// file kind turns with them. The matrix test runs every cell.
	i := 0
	for _, e := range slices.Sorted(maps.Keys(specifierExpressions)) {
		for _, form := range slices.Sorted(maps.Keys(specifierForms)) {
			f.Add([]byte(specifierCase{e, form, "bang", i%2 == 1}.key()))
			i++
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		specifierCheck(t, w, cases[choice])
		ExpectPending(t, specifierTarget, specCorpusKey(t))
	})
}

func TestModuleSpecifierExpressionsMatrix(t *testing.T) {
	if testing.Short() && os.Getenv("VIBELANG_SPECIFIER_MATRIX") == "" {
		t.Skip("the complete specifier, declaration, use and file-kind matrix runs separately")
	}
	TestModuleSpecifierExpressionsQuoted(t)
	w := NewWorkspace(t)
	for _, c := range specifierCases() {
		t.Run(c.key(), func(t *testing.T) { specifierCheck(t, w, c) })
	}
}
