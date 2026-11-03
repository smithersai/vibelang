package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const provideFiberQuote = "A fiber forked inside the block keeps the block's services after the layer is released, as in `Effect.provide`"

func provideFiberQuoted(tb testing.TB) {
	tb.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(chapter), provideFiberQuote) {
		tb.Fatalf("chapter 5 no longer says %q", provideFiberQuote)
	}
}

func TestProvideFiberOwnerQuoted(t *testing.T) { provideFiberQuoted(t) }

// Static acceptance follows Chapter 5: a provide block cannot reject a handle
// stored in its enclosing fiber's locals. Runtime lifetime and inherited
// services are checked by coverage-ch005-fork-provider-lifetime.
func FuzzProvideFiberOwner(f *testing.F) {
	startShortBudget(f)
	provideFiberQuoted(f)
	keys := []string{"direct", "alias", "nested", "list", "branch", "loop"}
	for _, key := range keys {
		for variant := byte(0); variant < 4; variant++ {
			f.Add([]byte(key + "\x00" + string([]byte{variant})))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			key = keys[len(data)%len(keys)]
		}
		variant := byte(0)
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0] % 4
		}
		work := []string{"Effect.succeed(1)", "(Effect.succeed(2))", "effect { return 3 }", "(effect () => 4)()"}[variant]
		body := "provide Layer.empty { fiber = fork " + work + " }"
		switch key {
		case "alias":
			body = "provide Layer.empty { const local = fork " + work + "; fiber = local }"
		case "nested":
			body = "provide Layer.empty { " + body + " }"
		case "list":
			body = "provide Layer.empty, Layer.empty { fiber = fork " + work + " }"
		case "branch":
			body = "provide Layer.empty { if (true) { fiber = fork " + work + " } }"
		}
		source := "export effect function main() { let fiber: Fiber.Fiber<number>; " + body + "; return join fiber! }"
		if key == "loop" {
			source = "export effect function main() { let result = 0; for (const n of [1]) { let fiber: Fiber.Fiber<number>; " + body + "; result = join fiber! } return result }"
		}
		result, err := w.Compile(t.Context(), Project{
			Config: `{"compilerOptions":{"strict":true,"noEmit":true,"target":"ES2022","module":"NodeNext","skipLibCheck":true,"types":[]},"files":["main.vibe"]}`,
			Files:  map[string]string{"main.vibe": source},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzProvideFiberOwner", key, "chapter 5: %s; unexpected %s in %q", provideFiberQuote, d.String(), source)
			}
		}
		ExpectPending(t, "FuzzProvideFiberOwner", key)
	})
}
