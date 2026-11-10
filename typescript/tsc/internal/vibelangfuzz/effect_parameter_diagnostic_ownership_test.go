package vibelangfuzz

import (
	"fmt"
	"os/exec"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const effectParameterContextQuote = "`try` works like `await`, so an `effect` function's parameter list, a class field initializer and a `static` block are not effect code"
const effectParameterCaughtQuote = "A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function."

const effectParameterNoThrowQuote = "A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401`"

func TestEffectParameterDiagnosticOwnershipQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", effectParameterContextQuote)
	chapterSays(t, "003-failures.md", effectParameterCaughtQuote)
	if !strings.Contains(SpecText("003-failures.md"), effectParameterNoThrowQuote) {
		t.Fatal("strict parameter initialization rule changed")
	}
}
func FuzzEffectParameterDiagnosticOwnership(f *testing.F) {
	startShortBudget(f)
	for _, kind := range []string{"declaration", "arrow", "method", "producer"} {
		for _, contract := range []string{"unknown", "written-unknown", "known", "never"} {
			for shape := uint8(0); shape < 7; shape++ {
				f.Add(kind, contract, shape)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, kind, contract string, shape uint8) {
		TestEffectParameterDiagnosticOwnershipQuoted(t)
		if kind != "arrow" && kind != "method" && kind != "producer" {
			kind = "declaration"
		}
		if contract != "written-unknown" && contract != "known" && contract != "never" {
			contract = "unknown"
		}
		key := fmt.Sprintf("%s:%s:%d", kind, contract, shape%7)
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
		if shape%7 == 1 {
			parameter = "{value=read(\"x\")}:{value?:unknown}={}"
		}
		if shape%7 == 2 {
			parameter = "{[String(read(\"x\"))]:value}:{[key:string]:unknown}={}"
		}
		switch shape % 7 {
		case 3:
			parameter = "flag=false,value:unknown=do {if(flag)return; read(\"x\")}"
		case 4:
			parameter = "first=read(\"x\"),flag=false,value:unknown=do {if(flag)return; 1}"
		case 5:
			parameter = "flag=false,value:unknown=do {if(flag)return; 1},later=read(\"x\")"
		}
		if shape%7 == 6 {
			parameter = "flag=false,value:unknown=do {if(flag)return; try{JSON.parse(\"{\");0}catch{1}}"
			want = 0
		}
		body := "export effect function run(" + parameter + "){return value}"
		if kind == "arrow" {
			body = "export const run=effect (" + parameter + ")=>value"
		}
		if kind == "method" {
			body = "export class Reader {effect run(" + parameter + "){return value}}"
		}
		if kind == "producer" {
			body = "export effect function* run(" + parameter + "){yield value}"
		}
		source := "import {read} from \"./foreign.js\"\n" + body + "\n"
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
			Gap(t, "FuzzEffectParameterDiagnosticOwnership", key, "unexpected error: %s", strings.Join(details, "; "))
		}
		if want == 0 {
			checked := 0
			for name, js := range r.Outputs {
				if !strings.HasSuffix(name, ".js") {
					continue
				}
				checked++
				command := exec.CommandContext(t.Context(), "node", "--input-type=module", "--check")
				command.Stdin = strings.NewReader(js)
				if output, err := command.CombinedOutput(); err != nil {
					Gap(t, "FuzzEffectParameterDiagnosticOwnership", key, "plain parameter initialization must emit valid JavaScript: %v\n%s\n%s", err, output, js)
				}
			}
			if checked == 0 {
				t.Fatal("syntax oracle received no emitted JavaScript")
			}
		}
		if found != want {
			Gap(t, "FuzzEffectParameterDiagnosticOwnership", key, "want %d EK0401, got %d: %s\n%s", want, found, strings.Join(details, "; "), source)
		}
	})
}
