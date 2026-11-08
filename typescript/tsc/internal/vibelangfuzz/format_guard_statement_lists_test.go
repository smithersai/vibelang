package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

func TestFormatGuardRewriteWrittenStatementLists(t *testing.T) {
	bodies := []string{
		"(try Effect.sync(()=>{out.push(n)}));",
		"(record(n));",
		"[record(n)];",
		"`${record(n)}`;",
		"if(n) (record(n));",
		"while(n) (record(n));",
		"{(record(n)); [record(n)];}",
	}
	for _, header := range []string{
		"for concurrent(const n of [6,7])",
		"for concurrent(1)(const n of [6,7])",
		"for try(const n of stream)",
	} {
		for i, body := range bodies {
			t.Run(fmt.Sprintf("%s/body%d", header, i), func(t *testing.T) {
				source := "effect function f(){const out:number[]=[];" + header + " " + body + "}"
				if err := toolsSyntaxError("main.vibe", source); err != "" {
					t.Fatal(err)
				}
				after := formatGuardRewrite(source, []byte{255, 255, 255, 255})
				if err := vibelangfmt.SameProgram(source, after); err != nil {
					t.Fatalf("statement-list mutation changed the item body: %v\n%s\nafter:\n%s", err, source, after)
				}
				if strings.HasPrefix(body, "{") && source == after {
					t.Fatal("a written statement list was not exercised")
				}
				changed := strings.Replace(source, header+" ", header+" ;", 1)
				if err := vibelangfmt.SameProgram(source, changed); err == nil {
					t.Fatal("guard accepted replacing an item body with an empty statement")
				}
			})
		}
	}
}
