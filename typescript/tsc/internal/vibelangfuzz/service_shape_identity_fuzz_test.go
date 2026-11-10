package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceShapeIdentityQuote = "the TypeScript type annotation supplies the exact Shape"

func serviceShapeIdentityQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), serviceShapeIdentityQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceShapeIdentityQuote)
	}
}

func TestServiceShapeIdentityQuoted(t *testing.T) { serviceShapeIdentityQuoted(t) }

// A bare service identifier type is independent of its implementation Shape.
// Written whole shapes preserve that type, just as the native Service does.
func FuzzServiceShapeIdentity(f *testing.F) {
	startShortBudget(f)
	serviceShapeIdentityQuoted(f)
	keys := []string{"direct", "array", "property", "readonly-array", "method", "generic-method", "alias", "shadow", "concrete", "reference-control"}
	for _, key := range keys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			key = keys[len(data)%len(keys)]
		}
		variant := byte(len(data))
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		shape, prefix, extra := "", "", ""
		switch key {
		case "direct":
			shape = "S"
		case "array":
			shape = "S[]"
		case "property":
			shape = "{ self?: S }"
		case "readonly-array":
			shape = "{ readonly peers: readonly S[] }"
		case "method":
			shape = "{ read(): S }"
		case "generic-method":
			shape = "{ read<T>(other: T): S }"
		case "alias":
			prefix, shape = "type Shape = { self: S }; ", "Shape"
		case "shadow":
			shape = "{ read<S>(other: S): S }"
		case "concrete":
			shape = "{ value: number }"
		case "reference-control":
			shape, extra = "number", "; static readonly defaultValue = () => 1"
		}
		source := prefix + "service S: " + shape + " { static readonly key = \"identity/S\"" + extra + " }"
		if variant&1 != 0 {
			source = "export function make(): unknown { " + source + "; return S }"
		} else {
			source += "; export { S }"
		}
		r, err := w.Compile(t.Context(), Project{Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]},"files":["main.vibe"]}`, Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzServiceShapeIdentity", key, "%s; written shape rejected: %s", serviceShapeIdentityQuote, d.String())
				return
			}
		}
		ExpectPending(t, "FuzzServiceShapeIdentity", key)
		ExpectPending(t, "FuzzServiceShapeIdentity", specCorpusKey(t))
	})
}
