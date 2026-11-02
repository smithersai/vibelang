package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// FormsOfType reads what a lambda, block, or value may be where the declared,
// uninstantiated expected type is t, with the classifier the checker uses for
// lambda forms (D56), by-name arguments (D147), and value conversions (D7,
// D49): expectedAt's classify(usefulTypes(…)) without the contextual-type
// fallback. Each step goes one level below t: "[]" to an array or iterable
// element, any other string to that property (a property t does not declare
// reads t's string index type, as an object literal's property does).
//
// forms holds P when an Effect value fits, E when a function that returns an
// Effect fits, and F when a plain function fits, in that order; "" means the
// type says nothing about form. isEffect reports, for t itself with no steps,
// whether t is effect's own Effect type: the test a dual's first parameter
// meets (takesEffectFirst), which the migration recorder of D188's block
// placement reads (dual_block_migration.go).
//
// cmd/vibelang-forms calls it to generate the forms table that VibeLang's
// text-only projector reads (internal/vibelangmapper/forms.go).
func FormsOfType(c *checker.Checker, t *checker.Type, steps ...string) (forms string, isEffect bool) {
	a := analyzerFor(c)
	types := []*checker.Type{t}
	for _, step := range steps {
		if step == "[]" {
			types = a.stepInto(types, pathStep{element: true})
		} else {
			types = a.stepInto(types, pathStep{property: step})
		}
	}
	e := a.classify(a.usefulTypes(types))
	if e.program {
		forms += "P"
	}
	if e.effectFn {
		forms += "E"
	}
	if e.plainFn {
		forms += "F"
	}
	return forms, len(steps) == 0 && isEffectType(c, t)
}

// IsFactoryFunction exposes D269's checked form to compiler tooling. A text
// projector decides from written types and reports EK9100 when it cannot.
func IsFactoryFunction(c *checker.Checker, fn *ast.Node) bool {
	return analyzerFor(c).isFactory(fn)
}
