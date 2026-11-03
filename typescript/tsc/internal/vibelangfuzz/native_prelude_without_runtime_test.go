package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const nativePreludeQuote = "Every root export of the core `effect` package is in scope in a `.vibe` file without an import."

var nativePreludeKeys = []string{"Effect", "Layer", "Schema", "Scope", "contract", "explicit", "shadow", "disabled"}

func TestNativePreludeWithoutRuntimeQuoted(t *testing.T) { nativePreludeQuoted(t) }
func nativePreludeQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), nativePreludeQuote) {
		t.Fatalf("chapter 5 no longer says %q", nativePreludeQuote)
	}
}

// Reading a native namespace or a type-only contract requires Effect, whose
// direct-import counterpart has no dependency on vibelang-runtime. The emitted
// JavaScript must not acquire that dependency. Shadowing and effectModules=false
// keep their existing meanings with either package installation.
func FuzzNativePreludeWithoutRuntime(f *testing.F) {
	// Spec rule: docs/design/src/005-services.md#e655fc6db8fc208f
	// Chapter 005: modules-off removes implicit namespaces; explicit imports and local shadow retain native meaning (FuzzNativePreludeWithoutRuntime).

	startShortBudget(f)
	nativePreludeQuoted(f)
	for _, key := range nativePreludeKeys {
		f.Add([]byte(key))
		f.Add([]byte(key + "\x00\x03"))
	}
	absent, present := NewWorkspace(f), NewWorkspace(f)
	runtime := filepath.Join(absent.Dir, "node_modules", "vibelang-runtime")
	if err := os.Rename(runtime, filepath.Join(absent.Dir, "disabled-runtime")); err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		variant := byte(0)
		if !slices.Contains(nativePreludeKeys, key) {
			key = "Effect"
		}
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		source := "export const value = " + key + "\n"
		if variant&1 != 0 {
			source = "export type API = typeof " + key + "\nexport declare const value: API\n"
		}
		switch key {
		case "contract":
			source = "export declare const load: (id: string) => number!!\n"
		case "explicit":
			source = "import { Effect as Fx } from 'effect'\nexport const value = Fx.runSync(Fx.succeed(7))\n"
		case "shadow":
			source = "const Effect = { local: 7 as const }\nexport const value: 7 = Effect.local\n"
		case "disabled":
			source = "export const value = Effect\n"
		}
		if variant&2 != 0 {
			source = "/* retained */\n" + strings.ReplaceAll(source, "value", "valueCafé")
		}
		config := strings.TrimSuffix(DefaultConfig, "\n}") + ",\n\"files\":[\"main.vibe\"]\n}"
		if key == "disabled" {
			config = strings.TrimSuffix(config, "\n}") + ",\n\"vibe\": { \"effectModules\": false }\n}"
		}
		for _, control := range []struct {
			name string
			w    *Workspace
		}{{"absent", absent}, {"installed", present}} {
			r, err := control.w.Compile(t.Context(), Project{Config: config, Files: map[string]string{"main.vibe": source, "package.json": `{"name":"native-prelude-runtime-independent","type":"module"}`}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var codes []int32
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Code())
				}
			}
			want := []int32(nil)
			if key == "disabled" {
				want = []int32{2304}
			}
			if !slices.Equal(codes, want) {
				Gap(t, "FuzzNativePreludeWithoutRuntime", key+":"+control.name, "VIP-14 native Effect namespaces: want %v, got %v; diagnostics=%v; source=%s", want, codes, r.Diagnostics, source)
				return
			}
			if key != "disabled" {
				found := false
				for name, text := range r.Outputs {
					if strings.HasSuffix(name, "main.js") {
						found = true
						if strings.Contains(text, "vibelang-runtime") {
							Gap(t, "FuzzNativePreludeWithoutRuntime", key+":"+control.name, "native namespace code imported an unrelated runtime:\n%s", text)
							return
						}
					}
				}
				if !found {
					t.Fatal("missing JavaScript output")
				}
			}
			ExpectPending(t, "FuzzNativePreludeWithoutRuntime", fmt.Sprintf("%s:%s", key, control.name))
		}
		ExpectPending(t, "FuzzNativePreludeWithoutRuntime", specCorpusKey(t))
	})
}
