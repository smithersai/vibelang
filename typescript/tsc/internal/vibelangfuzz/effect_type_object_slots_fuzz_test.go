package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// FuzzEffectTypeObjectSlots parses return annotations whose Effect type
// writes an object type in a slot, in every callable home that has a return
// annotation.
//
// Chapter 1, The A!E!R type shorthand: "Only the optional `R` after `!!`
// excludes an unparenthesized `{`; required error and requirement slots admit
// object types, so `): number!! {` begins the body; write `A!!({ … })` for a
// type-literal requirement." So number!{ code: string } { … } and
// number!string!{ users: Users } { … } are an annotation followed by a body,
// in a method as in a function, and number!! { … } is an annotation with no
// R followed by a body. Each cell is a whole valid program: it must parse
// with no diagnostic.
//
// An arrow's ({ users: Users }) => is left out: an EffectOperand is a type
// at the type-operator level, and Appendix A adds that "All existing
// line-break and union, intersection, function-type and conditional-type
// restrictions still apply", under which TypeScript reads a parenthesized
// binding pattern followed by => as the start of a function type.
//
// The finding: in a task's call, number!string!{ users: Users } { return 1 }
// read the object type as the body (FuzzDurableCallSignatures, key
// task-accepted:a-e-object), and so does every class or object-literal
// method.
const objectSlotTarget = "FuzzEffectTypeObjectSlots"

const objectSlotQuote = "required error and requirement slots admit object types, so `): number!! {` begins the body"

func TestEffectTypeObjectSlotsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", objectSlotQuote)
}

// objectSlotShapes are return annotations. Each is complete: the first five
// write an object type in a required slot, the rest are controls.
var objectSlotShapes = map[string]string{
	"e-object":        "number!{ code: string }",
	"r-object":        "number!string!{ users: Users }",
	"e-r-object":      "number!{ code: string }!{ users: Users }",
	"e-object-r":      "number!{ code: string }!Users",
	"r-object-nested": "number!string!{ users: { id: string } }",
	"a-e":             "number!string",
	"bang-bang":       "number!!",
	"r-group":         "number!string!({ users: Users })",
	"bang-bang-group": "number!!({ users: Users })",
}

// objectSlotHomes are callables with a return annotation; %[1]s is the
// parameter list and %[2]s the annotation. The value of a body is never
// checked: the cells only parse.
var objectSlotHomes = map[string]string{
	"function":             "function f(%[1]s): %[2]s { return 1 as never }\n",
	"effect-function":      "effect function f(%[1]s): %[2]s { return 1 }\n",
	"function-expression":  "const f = function (%[1]s): %[2]s { return 1 as never }\n",
	"arrow":                "const f = (%[1]s): %[2]s => { return 1 as never }\n",
	"class-method":         "class C {\n  m(%[1]s): %[2]s { return 1 as never }\n}\n",
	"class-static-method":  "class C {\n  static m(%[1]s): %[2]s { return 1 as never }\n}\n",
	"class-effect-method":  "class C {\n  effect m(%[1]s): %[2]s { return 1 }\n}\n",
	"class-expression":     "const C = class {\n  m(%[1]s): %[2]s { return 1 as never }\n}\n",
	"object-method":        "const o = {\n  m(%[1]s): %[2]s { return 1 as never }\n}\n",
	"object-effect-method": "const o = {\n  effect m(%[1]s): %[2]s { return 1 }\n}\n",
	"interface-method":     "interface I {\n  m(%[1]s): %[2]s\n  n(): void\n}\n",
	"abstract-method":      "abstract class A {\n  abstract m(%[1]s): %[2]s\n  n(): void {}\n}\n",
	"declare-function":     "declare function f(%[1]s): %[2]s\nconst after = 1\n",
}

var objectSlotParameters = map[string]string{"none": "", "typed": "id: string"}

type objectSlotCase struct {
	home, shape, parameters string
	vibex                   bool
}

func (c objectSlotCase) key() string {
	ext := "vibe"
	if c.vibex {
		ext = "vibex"
	}
	return c.home + "/" + c.shape + "/" + c.parameters + "/" + ext
}

func (c objectSlotCase) source() string {
	return fmt.Sprintf(objectSlotHomes[c.home], objectSlotParameters[c.parameters], objectSlotShapes[c.shape])
}

func objectSlotCases() []objectSlotCase {
	var cases []objectSlotCase
	for _, home := range slices.Sorted(maps.Keys(objectSlotHomes)) {
		for _, shape := range slices.Sorted(maps.Keys(objectSlotShapes)) {
			if objectSlotAmbiguous(home, shape) {
				continue
			}
			for _, parameters := range slices.Sorted(maps.Keys(objectSlotParameters)) {
				for _, vibex := range []bool{false, true} {
					cases = append(cases, objectSlotCase{home, shape, parameters, vibex})
				}
			}
		}
	}
	return cases
}

// objectSlotAmbiguous reports a cell left out of the matrix: an arrow whose
// parenthesized requirement is followed by its own =>.
func objectSlotAmbiguous(home, shape string) bool {
	return home == "arrow" && (shape == "r-group" || shape == "bang-bang-group")
}

// objectSlotCheck parses a cell on the calling goroutine, so a parser panic
// reaches recoverCompilerPanic, and requires a parse with no diagnostic.
func objectSlotCheck(t *testing.T, c objectSlotCase) {
	t.Helper()
	defer recoverCompilerPanic(t, objectSlotTarget)
	fileName := "/main.vibe"
	if c.vibex {
		fileName = "/main.vibex"
	}
	source := c.source()
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(fileName), PathKey: tspath.PathKey(fileName)}, source)
	var drawn []string
	for _, d := range file.Diagnostics() {
		drawn = append(drawn, fmt.Sprintf("%s%d at %d", d.Source(), d.Code(), d.Pos()))
	}
	gap := "parse:" + c.home + ":" + c.shape
	if len(drawn) != 0 {
		Gap(t, objectSlotTarget, gap, "%s\na valid annotation and body drew %s\n%s", objectSlotQuote, strings.Join(drawn, ", "), source)
	}
	ExpectPending(t, objectSlotTarget, gap)
}

func FuzzEffectTypeObjectSlots(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "001-functions.md", objectSlotQuote)
	cases := objectSlotCases()
	keys := make([]string, len(cases))
	for i, c := range cases {
		keys[i] = c.key()
	}
	// Each shape in each home once, the parameters and file kind turning
	// with them. The matrix test runs every cell.
	i := 0
	for _, home := range slices.Sorted(maps.Keys(objectSlotHomes)) {
		for _, shape := range slices.Sorted(maps.Keys(objectSlotShapes)) {
			if objectSlotAmbiguous(home, shape) {
				continue
			}
			parameters := []string{"none", "typed"}[i%2]
			f.Add(objectSlotCase{home, shape, parameters, i%3 == 1}.key())
			i++
		}
	}
	f.Fuzz(func(t *testing.T, key string) {
		choice, _ := keyedChoice(keys, []byte(key))
		objectSlotCheck(t, cases[choice])
		ExpectPending(t, objectSlotTarget, specCorpusKey(t))
	})
}

// TestEffectTypeObjectSlotsMatrix runs every cell. The cells only parse, so
// the matrix runs with -short.
func TestEffectTypeObjectSlotsMatrix(t *testing.T) {
	TestEffectTypeObjectSlotsQuoted(t)
	for _, c := range objectSlotCases() {
		t.Run(c.key(), func(t *testing.T) { objectSlotCheck(t, c) })
	}
}
