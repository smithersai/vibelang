package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

const t3CodeGeneratorTarget = "FuzzT3CodeGeneratorFix"
const t3CodeGeneratorQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestT3CodeGeneratorFixQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), t3CodeGeneratorQuote) {
		t.Fatalf("chapter 7 no longer says %q", t3CodeGeneratorQuote)
	}
}

// Minimized from DesktopConnectionCatalogStore's migrateSavedEnvironmentRecords.
// This static oracle compares declarations with the .ts twin through the
// migration API-identity checker, rather than trusting inferred assignability.
func t3CodeGeneratorSource(key string, n byte) string {
	value := fmt.Sprintf("%d", int(n)%7)
	typ, returned := "{ readonly schemaVersion: "+value+" }", "{ schemaVersion: "+value+" }"
	if strings.HasSuffix(key, "tag") {
		typ, returned = "{ readonly tag: \"saved\"; readonly values: readonly string[] }", "{ tag: \"saved\", values: [] }"
	}
	annotation := ": Effect.fn.Return<Catalog>"
	destination := ""
	if strings.HasPrefix(key, "contextual") {
		annotation = ""
		destination = ": (records: readonly string[]) => Effect.Effect<Catalog>"
	}
	return "import * as Effect from \"effect/Effect\"\ntype Catalog = " + typ + "\nexport const migrate" + destination + " = Effect.fn(\"migrate\")(function* (records: readonly string[])" + annotation + " {\n const targets: string[] = []\n for (const record of records) targets.push(record)\n yield* Effect.succeed(0)\n return " + returned + "\n})\n"
}
