package vibelangmapper

import (
	"strings"
	"testing"
)

func TestRetiredAwaitOperations(t *testing.T) {
	for _, op := range []string{"all", "race", "any", "allSettled"} {
		source := "effect function f() { return await." + op + " [Effect.succeed(1)] }"
		projection := Project(source, testContext)
		if len(projection.Diagnostics) != 1 || projection.Diagnostics[0].Code != 1802 {
			t.Fatalf("%s: %v", op, projection.Diagnostics)
		}
		if strings.Contains(virtualBody(t, projection), "$await") {
			t.Fatalf("legacy lowering survived: %s", projection.Text)
		}
		assertParses(t, projection.Text)
	}
}
