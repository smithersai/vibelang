package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

var pipeArrowAdmissionQuotes = []struct{ chapter, quote string }{
	{"900-appendices.md", "VibeLang's grammar is TypeScript's, plus four TC39 proposals and the productions below."},
	{"900-appendices.md", "covering-production restrictions on conditional, yield, assignment and arrow bodies, an `EffectArrow` included"},
	{"002-running.md", "const closed = 1 |> (effect () => %)"},
	{"900-appendices.md", "Diagnostic ownership follows the source rule, not the parser helper: new VibeLang productions, placement rules, adopted proposal early errors and explicit reconciliations use their owning VIP's `EK` code."},
	{"900-appendices.md", "| `EK2301` | adopted pipe grammar and early errors without a more specific code"},
}

func TestPipeArrowAdmissionQuoted(t *testing.T) {
	for _, quote := range pipeArrowAdmissionQuotes {
		r3Quoted(t, quote.chapter, quote.quote)
	}
}

// The keyed modifier and mutation bytes vary the head, concise/block body,
// enclosing expression and preceding stages. Only the whole bare arrow is
// rejected; nested arrows and parentheses remain grammar barriers.
func FuzzPipeArrowAdmission(f *testing.F) {
	startShortBudget(f)
	f.Add([]byte("conditional-colon:\x00"))
	f.Add([]byte("conditional-colon:\x01"))
	for _, quote := range pipeArrowAdmissionQuotes {
		r3Quoted(f, quote.chapter, quote.quote)
	}
	for _, key := range []string{"plain", "async", "effect"} {
		for head := byte(0); head < 4; head++ {
			f.Add([]byte(fmt.Sprintf("%s:%c%c%c", key, head, head%2, head%5)))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		key, mutation, _ := strings.Cut(string(data), ":")

		if key == "conditional-colon" {
			condition := "true"
			if len(mutation) > 0 && mutation[0]&1 != 0 {
				condition = "false"
			}
			source := "let n = 0; export const value: number | ((m: number) => number) = " + condition + " ? 1 |> (n = %) : m => m; export const after = 2;"
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.vibe"), PathKey: tspath.PathKey("/main.vibe")}, source, core.ScriptKindTS)
			if ds := file.Diagnostics(); len(ds) != 0 {
				Gap(t, "FuzzPipeArrowAdmission", "conditional-colon:"+condition, "TypeScript's conditional colon must terminate the pipe body, got %v:\n%s", ds, source)
			}
			if len(file.Statements.Nodes) != 3 {
				t.Fatalf("lost following declaration: %s", source)
			}
			return
		}
		prefix := ""
		switch key {
		case "plain":
		case "async":
			prefix = "async "
		case "effect":
			prefix = "effect "
		default:
			key = "plain"
			mutation = string(data)
		}
		b := []byte(mutation)
		at := func(i int) byte {
			if i < len(b) {
				return b[i]
			}
			return 0
		}
		heads := []string{"()", "x", "(x: number)", "<T>(x: T)"}
		arrow := prefix + heads[int(at(0))%len(heads)] + " => "
		if at(1)%2 == 0 {
			arrow += "%"
		} else {
			arrow += "{ return % }"
		}
		bodies := []string{arrow, "(" + arrow + ")", "[" + arrow + "]", "({ f: " + arrow + " })", "f(" + arrow + ")"}
		shape := int(at(2)) % len(bodies)
		stages := strings.Repeat("% + 1 |> ", int(at(3)%3))
		source := "export const value = 1 |> " + stages + bodies[shape] + ";\nexport const after = 2;"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.vibe"), PathKey: tspath.PathKey("/main.vibe")}, source, core.ScriptKindTS)
		ds := file.Diagnostics()
		if shape == 0 {
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 2301 {
				Gap(t, "FuzzPipeArrowAdmission", "owner:"+key, "VIP-23/detail246: whole bare arrow needs exactly EK2301, got %v:\n%s", ds, source)
			}
		} else if len(ds) != 0 {
			Gap(t, "FuzzPipeArrowAdmission", "barrier:"+key, "VIP-23/detail246: nested/parenthesized arrow must parse, got %v:\n%s", ds, source)
		}
		if len(file.Statements.Nodes) != 2 {
			Gap(t, "FuzzPipeArrowAdmission", "recovery:"+key, "pipe recovery lost the following declaration:\n%s", source)
		}
	})
}
