package vibelangmapper

import (
	"strings"
	"testing"
)

func TestSchemaWrittenTypeProjection(t *testing.T) {
	for _, schema := range []string{"export schema Message { id: string }", "export schema Message = string;"} {
		for _, before := range []bool{false, true} {
			alias := "/** Type docs. */\nexport type Message = typeof Message.Type;"
			source := "/** Value docs. */\n" + schema + "\n" + alias
			if before {
				source = alias + "\n/** Value docs. */\n" + schema
			}
			projection := Project(source, testContext)
			if len(projection.Diagnostics) != 0 {
				t.Fatal(projection.Diagnostics)
			}
			if strings.Count(projection.Text, "type Message =") != 1 || strings.Contains(projection.Text, "interface Message") {
				t.Fatalf("projection duplicates written type: %s", projection.Text)
			}
			if !strings.Contains(projection.Text, "/** Type docs. */") || !strings.Contains(projection.Text, "/** Value docs. */") {
				t.Fatalf("projection loses docs: %s", projection.Text)
			}
			assertValidMap(t, projection, source)
			assertParses(t, projection.Text)
		}
	}
}
