package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// D24 and VIP-5: a structured Effect subtype runs only under try, so tried
// statements run with no discard diagnostic, and untried constructors stay data.
func TestS7DiscardedStructuredCalls(t *testing.T) {
	source := `import { Config, Exit } from "effect"; import type { SqlClient } from "effect/sql/SqlClient"; export effect function migration(sql: SqlClient) { try sql.unsafe("one"); (try sql.unsafe("two")); const outcome = Exit.fail("keep"); const port = Config.String("PORT"); return { outcome, port } }`
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		if len(projection.Diagnostics) != 0 {
			t.Fatalf("%v\n%s", projection.Diagnostics, projection.Text)
		}
		for _, want := range []string{`$try(sql.unsafe("one"))`, `$try(sql.unsafe("two"))`, `const outcome = Exit.fail("keep")`, `const port = Config.String("PORT")`} {
			if !strings.Contains(projection.Text, want) {
				t.Fatalf("missing %s:\n%s", want, projection.Text)
			}
		}
		if strings.Contains(projection.Text, "$run(Exit.") || strings.Contains(projection.Text, "$run(Config.") {
			t.Fatalf("untried structured data ran:\n%s", projection.Text)
		}
	}
}

// A value parameter still sees an assertion of the completed value (TS2352).
func TestS7AssertedProgramValuePosition(t *testing.T) {
	dir, stock := stockBuiltinProject(t)
	requireStockTypeScript(t, stock)
	source := `import { Effect } from "effect"; function known() { return 1 }; export function valuePosition() { return (known() as Effect.Effect<number>) |> Effect.succeed(%) }`
	projection := Project(source, testContext)
	if len(projection.Diagnostics) != 0 {
		t.Fatal(projection.Diagnostics)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "TS2352") {
		t.Fatalf("%v: %s\n%s", err, out, projection.Text)
	}
}
