package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const effectParameterNoThrowQuote = "A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401`"

func TestEffectParameterDiagnosticOwnershipQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), effectParameterNoThrowQuote) {
		t.Fatal("strict parameter initialization rule changed")
	}
}
func FuzzEffectParameterDiagnosticOwnership(f *testing.F) {
	startShortBudget(f)
	for _, kind := range []string{"declaration", "arrow", "method"} {
		for _, contract := range []string{"unknown", "written-unknown", "known", "never"} {
			for shape := uint8(0); shape < 3; shape++ {
				f.Add(kind, contract, shape)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, kind, contract string, shape uint8) {
		TestEffectParameterDiagnosticOwnershipQuoted(t)
		tag := ""
		want := 1
		switch contract {
		case "written-unknown":
			tag = "/** @throws {unknown} */\n"
		case "known":
			tag = "/** @throws {RangeError} */\n"
		case "never":
			tag = "/** @throws {never} */\n"
			want = 0
		}
		parameter := "value:unknown=read(\"x\")"
		if shape%3 == 1 {
			parameter = "{value=read(\"x\")}:{value?:unknown}={}"
		}
		if shape%3 == 2 {
			parameter = "{[String(read(\"x\"))]:value}:{[key:string]:unknown}={}"
		}
		body := "export effect function run(" + parameter + "){return value}"
		if kind == "arrow" {
			body = "export const run=effect (" + parameter + ")=>value"
		}
		if kind == "method" {
			body = "export class Reader {effect run(" + parameter + "){return value}}"
		}
		source := "import {read} from \"./foreign.ts\"\n" + body + "\n"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "foreign.ts": tag + "export function read(value:string):unknown{return value}\n"}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		found := 0
		var details []string
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			details = append(details, fmt.Sprintf("%s%d[%d,%d): %s", d.Source(), d.Code(), d.Pos(), d.End(), d.String()))
			if IsEK(d) && d.Code() == 401 {
				found++
				continue
			}
			t.Fatalf("unexpected error for %s/%s/%d: %s", kind, contract, shape, strings.Join(details, "; "))
		}
		if found != want {
			t.Fatalf("%s/%s/%d: want %d EK0401, got %d: %s\n%s", kind, contract, shape, want, found, strings.Join(details, "; "), source)
		}
	})
}
