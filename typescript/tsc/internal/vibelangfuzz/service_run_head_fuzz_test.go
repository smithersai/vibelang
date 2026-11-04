package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Bare service-key calls retain native class-static diagnostics; explicit
// service lookups retain implementation members and environment requirements.
const serviceRunHeadQuote = "There is no `Users.find(id)` shorthand"
const serviceRunHeadRequirementsQuote = "`Users` is the identifier, the type that appears in R."
const serviceRunHeadCollisionQuote = "Class statics collide with member names"
const serviceRunHeadTarget = "FuzzServiceRunHead"

var serviceRunHeadForms = []string{"catch", "try", "pipe", "pipe-catch", "try-catch", "nested"}

func TestServiceRunHeadQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), serviceRunHeadQuote) {
		t.Fatalf("service lookup rule moved: %q", serviceRunHeadQuote)
	}
	if !strings.Contains(SpecText("../vips/0009-service-declarations.md"), serviceRunHeadRequirementsQuote) {
		t.Fatalf("service requirement rule moved: %q", serviceRunHeadRequirementsQuote)
	}
	if !strings.Contains(SpecText("../vips/0010-service-call-shorthand-denied.md"), serviceRunHeadCollisionQuote) {
		t.Fatalf("service static-member rule moved: %q", serviceRunHeadCollisionQuote)
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
		TestServiceRunHeadQuoted(t)
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
		declaration := "export error Refused\nexport service Audit { static readonly key = \"service-run-head/Audit\"; " + shape + " }\n"
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
		// Use the ordinary TypeScript class twin to distinguish a missing
		// member from existing native statics such as name and pipe.
		native := fmt.Sprintf("import { Context, Effect } from \"effect\"\nclass Audit extends Context.Service<Audit, { %s: (n: number) => Effect.Effect<number> }>()(\"service-run-head/Audit\") {}\nexport function probe() { return Audit.%s(%d) }\n", member, member, n)
		twin, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": native}})
		if err != nil {
			t.Fatal(err)
		}
		defer twin.Remove()
		nativeCodes := map[int32]bool{}
		for _, d := range twin.Diagnostics {
			if d.Category() == diagnostics.CategoryError && d.Source() == "" {
				nativeCodes[d.Code()] = true
			}
		}
		if len(nativeCodes) == 0 {
			t.Fatal("native class-static negative control unexpectedly compiled")
		}
		found := false
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError && d.Source() == "" && nativeCodes[d.Code()] {
				found = true
			}
		}
		if !found {
			Gap(t, serviceRunHeadTarget, "native/"+key+":"+member, "want native class-static rejection %v, got %v\n%s", nativeCodes, legacyErrors(r), source)
		}

		// Secondary recovery diagnostics on an invalid bare call do not
		// establish correctness. A valid lookup must also compile and emit
		// the implementation call while retaining Audit in its environment.
		explicit := owner + fmt.Sprintf(" { const implementation = try Audit; return try implementation.%s(%d) }\n", member, n)
		positiveFiles := map[string]string{"main.vibe": declaration + explicit}
		if len(files) > 1 {
			explicit = strings.ReplaceAll(explicit, "try Audit;", "try Services.Audit;")
			positiveFiles = map[string]string{"main.vibe": "import * as Services from \"./audit.vibe\"\n" + explicit, "audit.vibe": declaration}
		}
		positive, err := w.Compile(t.Context(), Project{Files: positiveFiles})
		if err != nil {
			t.Fatal(err)
		}
		defer positive.Remove()
		if errors := legacyErrors(positive); len(errors) > 0 {
			Gap(t, serviceRunHeadTarget, "explicit/"+key+":"+member, "explicit lookup rejected: %v\n%s", errors, positiveFiles["main.vibe"])
			return
		}
		js, decl := positive.Outputs["out/main.js"], positive.Outputs["out/main.d.ts"]
		compact := strings.Join(strings.Fields(js), "")
		if js == "" || strings.Contains(compact, "Audit."+member+"(") || !strings.Contains(compact, "implementation."+member+"(") {
			Gap(t, serviceRunHeadTarget, "lookup/"+key+":"+member, "explicit lookup lost its implementation call:\n%s", js)
		}
		if !strings.Contains(decl, "Audit>") {
			Gap(t, serviceRunHeadTarget, "requirements/"+key+":"+member, "explicit lookup lost its requirement:\n%s", decl)
		}
	})
}
