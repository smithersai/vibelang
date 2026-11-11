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

// FuzzDurableCallSignatures parses task and workflow declarations whose
// effect call varies its parameter list and the slots of its return
// annotation.
//
// Chapter 5, Durable static rules: "A task's parameters are identifiers, not
// patterns or a rest parameter, and its annotation leaves the `R` slot out
// (`EK5501`)." VIP-55 says it of the task's call: "The `R` slot of `call` is
// never written." So a task whose call has a pattern or rest parameter, or
// whose annotation writes an R slot in any spelling (A!E!R, A!!R,
// Effect.Effect<A, E, R>, inside parentheses, never, (never) or an alias of
// never), is EK5501. The section's first bullet makes an untyped parameter
// EK5501 too: "A task's `call` writes a type for each parameter and its
// return type. Anything else is the syntax error `EK5501`." A task whose call
// has typed identifier parameters and an annotation with no R slot is not
// EK5501.
//
// The parameter and R rules name a task. A workflow is the control: "A
// workflow's written `A!E` leaves `R` unchecked", so a workflow call with
// typed identifier parameters and no R slot is not EK5501. Every other
// workflow cell checks only that parsing does not panic.
//
// The witness: task WithNever { effect call(x: number): number!string!never
// { return x } } draws no EK5501, while number!string!Users does.
const durableSignatureTarget = "FuzzDurableCallSignatures"

const (
	durableSignatureQuote = "A task's parameters are identifiers, not patterns or a rest parameter, and its annotation leaves the `R` slot out (`EK5501`)."
	durableTypedQuote     = "A task's `call` writes a type for each parameter and its return type. Anything else is the syntax error `EK5501`."
	durableWorkflowRQuote = "A workflow's written `A!E` leaves `R` unchecked"
	durableSignatureVIP   = "The `R` slot of `call` is never written."
)

func durableSignatureQuotes(tb testing.TB) {
	tb.Helper()
	for _, quote := range []string{durableSignatureQuote, durableTypedQuote, durableWorkflowRQuote} {
		chapterSays(tb, "005-services.md", quote)
	}
	chapterSays(tb, "../vips/0055-durable-tasks-workflows.md", durableSignatureVIP)
}

func TestDurableCallSignaturesQuoted(t *testing.T) { durableSignatureQuotes(t) }

// durableSignatureParameters are parameter lists of the call. typed reports
// that each parameter is an identifier with a written type: no pattern, no
// rest parameter.
var durableSignatureParameters = map[string]struct {
	source string
	typed  bool
}{
	"none":           {"", true},
	"identifier":     {"id: string", true},
	"identifiers":    {"id: string, n: number", true},
	"optional":       {"id: string, n?: number", true},
	"default":        {"id: string, n: number = 1", true},
	"untyped":        {"id", false},
	"object-pattern": {"{ id }: { id: string }", false},
	"array-pattern":  {"[id, n]: [string, number]", false},
	"rest":           {"...ids: ReadonlyArray<string>", false},
	"rest-pattern":   {"...[id, n]: [string, number]", false},
	"after-rest":     {"id: string, ...ns: ReadonlyArray<number>", false},
	"after-pattern":  {"id: string, { n }: { n: number }", false},
}

// durableSignatureAnnotations are return annotations of the call. r reports
// that the annotation writes an R slot.
var durableSignatureAnnotations = map[string]struct {
	source string
	r      bool
}{
	"a-e":                {"number!string", false},
	"a":                  {"number!!", false},
	"group-a-e":          {"(number!string)", false},
	"effect-a-e":         {"Effect.Effect<number, string>", false},
	"a-e-service":        {"number!string!Users", true},
	"a-service":          {"number!!Users", true},
	"a-e-union":          {"number!string!(Users | Orders)", true},
	"a-e-unknown":        {"number!string!unknown", true},
	"a-e-object":         {"number!string!{ users: Users }", true},
	"a-e-never":          {"number!string!never", true},
	"a-never":            {"number!!never", true},
	"a-e-never-group":    {"number!string!(never)", true},
	"a-e-never-alias":    {"number!string!Nothing", true},
	"group-a-e-service":  {"(number!string!Users)", true},
	"effect-a-e-service": {"Effect.Effect<number, string, Users>", true},
	"effect-a-e-never":   {"Effect.Effect<number, string, never>", true},
}

// durableSignatureCase is one cell: the declaration word, the parameter list
// and the annotation, then the home: whether the call has a body, whether the
// declaration is exported, whether a static readonly option comes before the
// call, and the file kind.
type durableSignatureCase struct {
	word, parameters, annotation  string
	body, exported, option, vibex bool
}

func (c durableSignatureCase) key() string {
	parts := []string{c.word, c.parameters, c.annotation, "bodyless", "local", "alone", "vibe"}
	if c.body {
		parts[3] = "body"
	}
	if c.exported {
		parts[4] = "export"
	}
	if c.option {
		parts[5] = "option"
	}
	if c.vibex {
		parts[6] = "vibex"
	}
	return strings.Join(parts, "/")
}

func (c durableSignatureCase) source() string {
	call := fmt.Sprintf("effect call(%s): %s", durableSignatureParameters[c.parameters].source, durableSignatureAnnotations[c.annotation].source)
	if c.body {
		call += " { return 1 }"
	}
	if c.option {
		call = "static readonly key = \"billing/Charge\"\n  " + call
	}
	declaration := fmt.Sprintf("%s Charge {\n  %s\n}\n", c.word, call)
	if c.exported {
		declaration = "export " + declaration
	}
	return "type Nothing = never\n" + declaration
}

func durableSignatureCases() []durableSignatureCase {
	var cases []durableSignatureCase
	for _, word := range []string{"task", "workflow"} {
		for _, p := range slices.Sorted(maps.Keys(durableSignatureParameters)) {
			for _, a := range slices.Sorted(maps.Keys(durableSignatureAnnotations)) {
				for _, body := range []bool{true, false} {
					// A workflow's call has a body (the shape rule,
					// FuzzDurableDeclarations).
					if word == "workflow" && !body {
						continue
					}
					for _, exported := range []bool{false, true} {
						for _, option := range []bool{false, true} {
							for _, vibex := range []bool{false, true} {
								cases = append(cases, durableSignatureCase{word, p, a, body, exported, option, vibex})
							}
						}
					}
				}
			}
		}
	}
	return cases
}

// durableSignatureCheck parses a cell on the calling goroutine, so a parser
// panic reaches recoverCompilerPanic, and checks EK5501 against the rule.
func durableSignatureCheck(t *testing.T, c durableSignatureCase) {
	t.Helper()
	defer recoverCompilerPanic(t, durableSignatureTarget)
	fileName := "/main.vibe"
	if c.vibex {
		fileName = "/main.vibex"
	}
	source := c.source()
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(fileName), PathKey: tspath.PathKey(fileName)}, source)
	ek5501 := 0
	var drawn []string
	for _, d := range file.Diagnostics() {
		if d.Source() == "EK" && d.Code() == parser.DurableCallDiagnosticCode {
			ek5501++
		}
		drawn = append(drawn, fmt.Sprintf("%s%d at %d: %s", d.Source(), d.Code(), d.Pos(), d.MessageText()))
	}
	source += "diagnostics: " + strings.Join(drawn, "; ")
	parameters, annotation := durableSignatureParameters[c.parameters], durableSignatureAnnotations[c.annotation]
	switch {
	case c.word == "task":
		var broken []string
		if !parameters.typed {
			broken = append(broken, c.parameters)
		}
		if annotation.r {
			broken = append(broken, c.annotation)
		}
		if len(broken) == 0 {
			gap := "task-rejected:" + c.parameters + "/" + c.annotation
			if ek5501 != 0 {
				Gap(t, durableSignatureTarget, gap, "%s\ntyped identifier parameters and no R slot, yet EK5501\n%s", durableSignatureQuote, source)
			}
			ExpectPending(t, durableSignatureTarget, gap)
			return
		}
		gap := "task-accepted:" + strings.Join(broken, "+")
		if ek5501 == 0 {
			Gap(t, durableSignatureTarget, gap, "%s\n%s\nno EK5501\n%s", durableSignatureQuote, durableSignatureVIP, source)
		}
		ExpectPending(t, durableSignatureTarget, gap)
	case parameters.typed && !annotation.r:
		gap := "workflow-rejected:" + c.parameters + "/" + c.annotation
		if ek5501 != 0 {
			Gap(t, durableSignatureTarget, gap, "%s\na workflow call with typed identifier parameters and no R slot drew EK5501\n%s", durableWorkflowRQuote, source)
		}
		ExpectPending(t, durableSignatureTarget, gap)
	}
}

func FuzzDurableCallSignatures(f *testing.F) {
	startShortBudget(f)
	durableSignatureQuotes(f)
	cases := durableSignatureCases()
	keys := make([]string, len(cases))
	for i, c := range cases {
		keys[i] = c.key()
	}
	// Each parameter list with each annotation once for each word, the home
	// turning with them. The matrix test runs every cell.
	i := 0
	for _, word := range []string{"task", "workflow"} {
		for _, p := range slices.Sorted(maps.Keys(durableSignatureParameters)) {
			for _, a := range slices.Sorted(maps.Keys(durableSignatureAnnotations)) {
				body := word == "workflow" || i%2 == 0
				f.Add(durableSignatureCase{word, p, a, body, i%3 == 1, i%5 == 2, i%7 == 3}.key())
				i++
			}
		}
	}
	f.Fuzz(func(t *testing.T, key string) {
		choice, _ := keyedChoice(keys, []byte(key))
		durableSignatureCheck(t, cases[choice])
		ExpectPending(t, durableSignatureTarget, specCorpusKey(t))
	})
}

// TestDurableCallSignaturesMatrix runs every cell. The cells only parse, so
// the matrix runs with -short.
func TestDurableCallSignaturesMatrix(t *testing.T) {
	durableSignatureQuotes(t)
	for _, c := range durableSignatureCases() {
		t.Run(c.key(), func(t *testing.T) { durableSignatureCheck(t, c) })
	}
}
