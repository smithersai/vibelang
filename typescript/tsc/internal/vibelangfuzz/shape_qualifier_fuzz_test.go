package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const shapeQualifierTarget = "FuzzShapeQualifier"
const shapeQualifierQuote = "`Users.Shape` is the members, the type an implementation has"

func TestShapeQualifierQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), shapeQualifierQuote) {
		t.Fatalf("Chapter 5 no longer says %q", shapeQualifierQuote)
	}
}

// Each name is written before .Shape and is no service, so the sentence does
// not apply and the name keeps TypeScript's meaning (Will, 2026-11-03: "It is
// already implied we match typescript"). The comparison is of the compiler
// with stock rules on the same text, as a .vibe and as a .ts file.
var shapeQualifierNames = map[string]struct{ declarations, name string }{
	"missing":        {"", "Missing"},
	"missing-nested": {"", "Missing.Inner"},
	"global-class":   {"", "Date"},
	"global-ns":      {"", "Intl"},
	"local-enum":     {"enum E { A }\n", "E"},
	"local-alias":    {"type Local = number\n", "Local"},
	"local-class":    {"class Plain {}\n", "Plain"},
	"local-ns":       {"namespace N { export type Other = number }\n", "N"},
	"import-missing": {"import type * as M from \"./absent.js\"\n", "M"},
}

var shapeQualifierPositions = map[string]string{
	"alias":     "export type T = %s.Shape\n",
	"parameter": "export function f(value: %s.Shape) { return value }\n",
	"result":    "export function f(): %s.Shape { return null as never }\n",
	"argument":  "export type T = ReadonlyArray<%s.Shape>\n",
	"body":      "export function f() {\n  let value: %s.Shape\n  return value\n}\n",
}

func shapeQualifierCodes(ds []*ast.Diagnostic) []string {
	var codes []string
	for _, d := range ds {
		if HasError([]*ast.Diagnostic{d}) {
			codes = append(codes, fmt.Sprintf("%d@%d", d.Code(), d.Pos()))
		}
	}
	slices.Sort(codes)
	return codes
}

func FuzzShapeQualifier(f *testing.F) {
	startShortBudget(f)
	for _, name := range []string{"missing", "missing-nested", "global-class", "global-ns", "local-enum", "local-alias", "local-class", "local-ns", "import-missing"} {
		f.Add(name, "alias")
	}
	for _, position := range []string{"parameter", "result", "argument", "body"} {
		f.Add("missing", position)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, nameKey, positionKey string) {
		TestShapeQualifierQuoted(t)
		name, ok := shapeQualifierNames[nameKey]
		position, placed := shapeQualifierPositions[positionKey]
		if !ok || !placed {
			return
		}
		source := name.declarations + fmt.Sprintf(position, name.name)
		compile := func(file string) []string {
			var result *Result
			var err error
			within(t, "compile", func() {
				result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": `{"name":"shape-qualifier","type":"module"}`}})
			})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			return shapeQualifierCodes(result.Diagnostics)
		}
		vibe, ts := compile("main.vibe"), compile("main.ts")
		if !slices.Equal(vibe, ts) {
			Gap(t, shapeQualifierTarget, "name:"+nameKey, "Chapter 5: %q; %s is no service, yet .vibe reports %v and tsc %v for\n%s", shapeQualifierQuote, name.name, vibe, ts, source)
		}
		ExpectPending(t, shapeQualifierTarget, "name:"+nameKey)
	})
}
