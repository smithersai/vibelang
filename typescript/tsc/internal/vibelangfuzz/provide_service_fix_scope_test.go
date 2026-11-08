package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const provideServiceFixMeaningQuote = "without changing the meaning of TypeScript-style source."
const provideServiceFixLayerQuote = "which means `Layer.succeed(Key, value)`"

var provideServiceFixScopeKeys = []string{"native", "alias", "qualified", "layer"}

func TestProvideServiceFixScopeQuoted(t *testing.T) { provideServiceFixScopeQuoted(t) }
func provideServiceFixScopeQuoted(t testing.TB) {
	t.Helper()
	for file, quote := range map[string]string{"007-tooling.md": provideServiceFixMeaningQuote, "005-services.md": provideServiceFixLayerQuote} {
		text, err := os.ReadFile(SpecPath(file))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), quote) {
			t.Fatalf("%s no longer says %q", file, quote)
		}
	}
}
func provideServiceFixDiagnostic(d *ast.Diagnostic) string {
	text := d.String()
	for _, child := range d.MessageChain() {
		text += "\n" + provideServiceFixDiagnostic(child)
	}
	return text
}

// Native service provision leaves no Layer memo map. Layer provision creates
// one. Both editor actions and --fix must preserve those pinned observations.
// main is marked effect and tries the provision: under VIP-1 an unmarked
// function is plain JavaScript that returns the program unrun, and EK4836's
// block repair and its scope advice apply to effect code.
// Chapter 007 / provide repairs preserve cold factories and CurrentMemoMap: docs/design/src/007-tooling.md#10fe388bcbf9c49b
// Chapter 007 / provide repairs preserve cold factories and CurrentMemoMap: docs/design/src/007-tooling.md#e6d04a4ede5b0933
// Chapter 007 / provide repairs preserve cold factories and CurrentMemoMap: docs/design/src/007-tooling.md#4187f09a06bc9fbb
// Chapter 007 / provide repairs preserve cold factories and CurrentMemoMap: docs/design/src/007-tooling.md#d8364cc628a733b7
// Chapter 007 / provide repairs preserve cold factories and CurrentMemoMap: docs/design/src/007-tooling.md#7d5987968b922bb6
