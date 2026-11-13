package vibelangfuzz

import (
	"strings"
	"testing"
)

// These controls exercise the same positive obligations as both fuzz targets.
// Losing the error, its identity or its advice must fail independently.
func TestPreludeGlobalValueOracleControls(t *testing.T) {
	module := "Response is Effect's Response module (effect/ai/Response), in scope without an import."
	platform := "The global Response is platform code, which lives in a .ts file."
	global := "For the global Response, write globalThis.Response."
	for _, form := range []string{"new", "instanceof"} {
		code := "TS2351"
		if form == "instanceof" {
			code = "TS2359"
		}
		for _, row := range []struct {
			key, lib, note string
			codes          []string
			spelled        []string
			want           bool
		}{
			{"host", "dom", module + platform, []string{code}, []string{"EK4402"}, true},
			{"missing-error", "dom", "", nil, []string{"EK4402"}, false},
			{"wrong-source", "dom", module + platform, []string{"EK2351"}, []string{"EK4402"}, false},
			{"wrong-error", "dom", module + platform, []string{"TS2304"}, []string{"EK4402"}, false},
			{"duplicate-error", "dom", module + platform, []string{code, code}, []string{"EK4402"}, false},
			{"missing-module-note", "dom", platform, []string{code}, []string{"EK4402"}, false},
			{"missing-platform-advice", "dom", module, []string{code}, []string{"EK4402"}, false},
			{"reworded-module-note", "dom", strings.ReplaceAll(module+platform, "in scope without an import", "available"), []string{code}, []string{"EK4402"}, false},
			{"reworded-platform-note", "dom", module + "host", []string{code}, []string{"EK4402"}, false},
			{"banned-advice", "dom", module + platform + global, []string{code}, []string{"EK4402"}, false},
			{"hatch-advice", "dom", module + platform + " inside a hatch", []string{code}, []string{"EK4402"}, false},
			{"custom-global", "workers", module + global, []string{code}, nil, true},
			{"lost-global-advice", "workers", module, []string{code}, nil, false},
			{"unavailable-global", "class", module, []string{code}, []string{"TS7017"}, true},
			{"refused-global-advice", "class", module + global, []string{code}, []string{"TS7017"}, false},
		} {
			t.Run(form+"/"+row.key, func(t *testing.T) {
				g := &Gaps{}
				in := preludeGlobalValueInput{lib: unionChoice{name: row.lib}, name: "Response", form: form, context: "plain"}
				var notes []string
				if row.note != "" {
					notes = []string{row.note}
				}
				checkPreludeGlobalValueDiagnostics(g, in, row.codes, notes, row.spelled)
				if got := !g.Any(); got != row.want {
					t.Fatalf("accepted=%t want=%t: %+v", got, row.want, g.found)
				}
			})
		}
	}
}

func TestPreludeGlobalMemberOracleControls(t *testing.T) {
	module := "Response is Effect's Response module (effect/ai/Response), in scope without an import."
	platform := "The global Response has Response.json, and it is platform code, which lives in a .ts file."
	for _, row := range []struct {
		key, lib, note string
		want           bool
	}{
		{"host", "dom", module + platform, true},
		{"missing-error", "dom", "", false},
		{"missing-note", "dom", "TS2339", false},
		{"missing-module-note", "dom", platform, false},
		{"missing-platform-advice", "dom", module, false},
		{"banned-advice", "dom", module + platform + " write globalThis.Response.json", false},
		{"custom-global", "workers", module + " write globalThis.Response.json", true},
		{"lost-global-advice", "workers", module, false},
	} {
		t.Run(row.key, func(t *testing.T) {
			g := &Gaps{}
			var notes []string
			if row.note != "" {
				notes = []string{row.note}
			}
			checkPreludeGlobalMemberNotes(g, preludeGlobalInput{lib: unionChoice{name: row.lib}, name: unionChoice{name: "Response"}, member: "json"}, true, notes, nil)
			if got := !g.Any(); got != row.want {
				t.Fatalf("accepted=%t want=%t: %+v", got, row.want, g.found)
			}
		})
	}
}
