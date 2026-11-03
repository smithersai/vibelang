package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Accepted legacy inputs must retain the explicit lookup this rule requires.
// This is an emit/type hygiene oracle, not a second runtime differential runner.
const serviceRunHeadQuote = "There is no `Users.find(id)` shorthand"
const serviceRunHeadRequirementsQuote = "`Users` is the identifier, the type that appears in R."
const serviceRunHeadTarget = "FuzzServiceRunHead"

var serviceRunHeadForms = []string{"catch", "try", "pipe", "pipe-catch", "try-catch", "nested"}

func TestServiceRunHeadQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), serviceRunHeadQuote) {
		t.Fatalf("service lookup rule moved: %q", serviceRunHeadQuote)
	}
	if !strings.Contains(SpecText("../vips/0009-service-declarations.md"), serviceRunHeadRequirementsQuote) {
		t.Fatalf("service requirement rule moved: %q", serviceRunHeadRequirementsQuote)
	}
}

func FuzzServiceRunHead(f *testing.F) {
	startShortBudget(f)
	for _, key := range serviceRunHeadForms {
		for _, member := range []string{"record", "write", "name", "pipe"} {
			f.Add([]byte(key + ":" + member))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.Split(string(data), ":")
		key := parts[0]
		if !slices.Contains(serviceRunHeadForms, key) {
			if len(data) == 0 {
				key = serviceRunHeadForms[0]
			} else {
				key = serviceRunHeadForms[int(data[0])%len(serviceRunHeadForms)]
			}
		}
		n := len(data) % 17
		members := []string{"record", "write", "name", "pipe"}
		member := members[0]
		if len(parts) > 1 && slices.Contains(members, parts[1]) {
			member = parts[1]
		} else if len(data) > 1 {
			member = members[int(data[1])%len(members)]
		}
		call := fmt.Sprintf("Audit.%s(%d)", member, n)
		expression := map[string]string{
			"catch":      call + " catch () => -1",
			"try":        "try " + call,
			"pipe":       "try (" + call + " |> Effect.map(%, (n) => n + 1))",
			"pipe-catch": "(" + call + " |> Effect.map(%, (n) => n + 1)) catch () => -1",
			"try-catch":  "(try " + call + ") catch () => -1",
			"nested":     "(" + call + " catch () => -1) catch () => -2",
		}[key]
		shape := fmt.Sprintf("%s(n: number): number!Refused", member)
		if len(data) > 2 && data[2]%2 == 1 {
			shape = fmt.Sprintf("%s: (n: number) => number!Refused", member)
		}
		declaration := "export error Refused\nexport service Audit { " + shape + " }\n"
		owner := "export effect function probe()"
		if len(data) > 3 && data[3]%2 == 1 {
			owner = "export const probe = effect () =>"
		}
		source := "import { Effect } from \"effect\"\n" + declaration + owner + " { return " + expression + " }\n"
		files := map[string]string{"main.vibe": source}
		if len(data) > 4 && data[4]%2 == 1 {
			source = "import { Effect } from \"effect\"\nimport * as Services from \"./audit.vibe\"\n" + owner + " { return " + strings.ReplaceAll(expression, "Audit.", "Services.Audit.") + " }\n"
			files = map[string]string{"main.vibe": source, "audit.vibe": declaration}
		}
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if errors := legacyErrors(r); len(errors) > 0 {
			// The service retirement may reject the shorthand with TS2339.
			// Other diagnostics are not evidence of a valid rejection.
			for _, d := range r.Diagnostics {
				if d.Code() != 2339 && d.Category() == diagnostics.CategoryError {
					Gap(t, serviceRunHeadTarget, "compile/"+key, "unexpected rejection: %v\n%s", errors, source)
				}
			}
			return
		}
		js, decl := r.Outputs["out/main.js"], r.Outputs["out/main.d.ts"]
		compact := strings.Join(strings.Fields(js), "")
		if js == "" || strings.Contains(compact, "Audit."+member+"(") {
			Gap(t, serviceRunHeadTarget, "lookup/"+key, "accepted head emits a bare key member call:\n%s\nsource:\n%s", js, source)
		}
		if !strings.Contains(decl, "Audit>") {
			Gap(t, serviceRunHeadTarget, "requirements/"+key, "accepted head lost its lookup requirement:\n%s\nsource:\n%s", decl, source)
		}
	})
}
