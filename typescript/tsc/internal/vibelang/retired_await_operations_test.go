package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestRetiredAwaitOperationAction(t *testing.T) {
	source := "export effect function main() { return await.all [Effect.succeed(1)] }"
	got := applyQuickFixOf(t, source, int32(1802), diagnostics.CategoryError)
	if !strings.Contains(got, "(try.all [effect { return try Effect.succeed(1) }])") {
		t.Fatal(got)
	}
}
