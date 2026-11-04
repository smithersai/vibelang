package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

func TestSchemaOptionalMutabilityQuoted(t *testing.T) {
	chapterSays(t, "006-data.md", "Mappings preserve TypeScript mutability: properties are writable unless `readonly`; arrays and tuples are mutable unless `readonly`.")
}

// Runtime checks reuse the VIP differential generator, worker, stability
// checks and failures(). Declaration checks compare against the stock 5.9.3
// twin under the identical option. No second Exit comparator is introduced.
func FuzzSchemaExactOptional(f *testing.F) {
	startShortBudget(f)
	api := declarationIdentityAPI(f)
	tsc := filepath.Join(api, "bin/tsc")
	env := newVIPEnv(f)
	for _, mode := range []uint8{0, 8, 31} {
		f.Add("optional-fields", mode, false)
		f.Add("optional-fields", mode, true)
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8, exact bool) {
		t.Parallel() // Independent projects; keep the short seed wall time bounded.
		TestSchemaExactOptionalQuoted(t)
		TestSchemaOptionalMutabilityQuoted(t)
		key = "optional-fields"
		p := vipgen.SchemaOptionalProgram(mode, exact)
		run := env.run(t, p)
		for failure, message := range run.failures() {
			Gap(t, "FuzzSchemaExactOptional", key+":"+failure, "%s", message)
		}
		vibe, twin := vipgen.SchemaOptionalSources(mode, exact)
		config := vipgen.SchemaOptionalConfig(exact)
		got, err := env.w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": vibe}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer got.Remove()
		if HasError(got.Diagnostics) {
			Gap(t, "FuzzSchemaExactOptional", key+":compile", "%v\n%s", got.Diagnostics, vibe)
			return
		}
		want := stockDeclaration(t, env.w, tsc, Project{Files: map[string]string{"main.ts": twin}, Config: strings.ReplaceAll(config, "main.vibe", "main.ts")}, "out/main.d.ts")
		before, after := filepath.Join(t.TempDir(), "typescript"), filepath.Join(t.TempDir(), "vibelang")
		for dir, text := range map[string]string{before: want, after: got.Outputs["out/main.d.ts"]} {
			if err := os.MkdirAll(dir, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "main.d.ts"), []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
		}
		diff, err := compareIdentityDeclarations(t.Context(), api, before, after)
		if err != nil {
			t.Fatal(err)
		}
		if diff != "" {
			Gap(t, "FuzzSchemaExactOptional", key+":declarations", "exact=%t mode=%d\n%s\nVibe:\n%s\nTypeScript:\n%s\n%s", exact, mode, diff, vibe, twin, got.Outputs["out/main.d.ts"])
		}
	})
}
