package vibelang

import (
	"strings"
	"testing"
)

// rule-evidence: docs/design/src/900-appendices.md#f0bd0463c7375449
func TestSchemaMembershipAdvice(t *testing.T) {
	for _, setting := range []string{"", "warning", "off"} {
		for _, class := range []string{"Person", "Alias"} {
			t.Run(setting+"/"+class, func(t *testing.T) {
				source := "class Person extends Schema.Class<Person>(\"Person\")({name:Schema.String}) {}\nconst Alias = Person\nexport function check(value: unknown) { return value instanceof " + class + " }\n"
				if setting != "" {
					source = "// @vibelang-diagnostics EK4817:" + setting + "\n" + source
				}
				program, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == "EK" && d.Code() == 4817 {
						count++
						if !strings.Contains(d.MessageText(), "Schema.is("+class+") tests the schema") {
							t.Errorf("missing membership advice: %s", d.MessageText())
						}
					}
				}
				want := 0
				if setting == "warning" {
					want = 1
				}
				if count != want {
					t.Fatalf("EK4817 count = %d, want %d", count, want)
				}
			})
		}
	}
}
