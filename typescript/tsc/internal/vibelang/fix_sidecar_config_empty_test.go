package vibelang

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// sidecarMigration runs vibelang --fix's config migration on config, written
// as dir/tsconfig.json, and returns the migrated text, or "" when it changes
// nothing.
func sidecarMigration(t *testing.T, dir, config string) string {
	t.Helper()
	path := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	if err := os.WriteFile(path.AsString(), []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.vibe"), []byte("export const value = 1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := osvfs.FS()
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(path, &core.CompilerOptions{}, nil, fs, nil)
	if parsed != nil {
		errors = slices.Concat(errors, parsed.GetConfigFileParsingDiagnostics())
	}
	_, changes := sidecarConfigFixes(fs, errors)
	return changes[path]
}

// Smithers run 3: six packages' tsconfig.json held only
// "vibelang": { "declarationSidecars": true } from an earlier setup, and the
// migration left "vibelang": {  }, which the repository's formatter then
// rewrote. A settings object that held only the retired setting goes with it;
// one with a comment keeps the comment.
func TestSidecarConfigEmptiedObject(t *testing.T) {
	for _, test := range []struct{ name, config, want string }{
		{"smithers", "{\n  \"compilerOptions\": { \"strict\": true },\n  \"vibelang\": { \"declarationSidecars\": true }\n}\n", "{\n  \"compilerOptions\": { \"strict\": true }\n}\n"},
		{"first", "{\"vibe\":{\"declarationSidecars\":true},\"files\":[\"main.vibe\"]}", "{\"files\":[\"main.vibe\"]}"},
		{"middle", "{\n  \"files\": [\"main.vibe\"],\n  \"vibe\": {\n    \"declarationSidecars\": false\n  },\n  \"include\": []\n}\n", "{\n  \"files\": [\"main.vibe\"],\n  \"include\": []\n}\n"},
		{"commented", "{\"vibe\":{/* old */\"declarationSidecars\":true},\"files\":[\"main.vibe\"]}", "{\"vibe\":{/* old */},\"files\":[\"main.vibe\"]}"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := sidecarMigration(t, t.TempDir(), test.config); got != test.want {
				t.Fatalf("migration wrote\n%q\nwant\n%q", got, test.want)
			}
		})
	}
}

// A tsconfig.json with the retired setting among other properties, in a
// vibe or vibelang object alone or with another setting, inline or on lines
// of its own: the migrated file is JSON with every other property as it was,
// no declarationSidecars, and no empty settings object.
func TestSidecarConfigMigrationProperty(t *testing.T) {
	r := rand.New(rand.NewPCG(31107, 1))
	others := [][2]string{{"files", `["main.vibe"]`}, {"include", `["src/**/*.vibe"]`}, {"compilerOptions", `{"strict":true}`}, {"exclude", `[]`}}
	for i := range 120 {
		key := []string{"vibe", "vibelang"}[r.IntN(2)]
		inner := [][2]string{{"declarationSidecars", []string{"true", "false"}[r.IntN(2)]}}
		if r.IntN(3) == 0 {
			inner = append(inner, [2]string{"effectGlobals", "false"})
			if r.IntN(2) == 0 {
				inner[0], inner[1] = inner[1], inner[0]
			}
		}
		props := slices.Clone(others[:1+r.IntN(len(others))])
		at := r.IntN(len(props) + 1)
		multiline := r.IntN(2) == 0
		object := func(entries [][2]string, indent string) string {
			var parts []string
			for _, entry := range entries {
				parts = append(parts, fmt.Sprintf("%q: %s", entry[0], entry[1]))
			}
			if !multiline {
				return "{ " + strings.Join(parts, ", ") + " }"
			}
			return "{\n" + indent + "  " + strings.Join(parts, ",\n"+indent+"  ") + "\n" + indent + "}"
		}
		all := slices.Insert(slices.Clone(props), at, [2]string{key, object(inner, "  ")})
		config := object(all, "") + "\n"
		got := sidecarMigration(t, t.TempDir(), config)
		var parsed map[string]any
		if err := json.Unmarshal([]byte(got), &parsed); err != nil {
			t.Fatalf("case %d: migration of\n%s\nwrote invalid JSON\n%s", i, config, got)
		}
		var want map[string]any
		_ = json.Unmarshal([]byte(config), &want)
		settings := want[key].(map[string]any)
		delete(settings, "declarationSidecars")
		if len(settings) == 0 {
			delete(want, key)
		}
		if !reflect.DeepEqual(parsed, want) {
			t.Fatalf("case %d: migration of\n%s\nwrote\n%s", i, config, got)
		}
		if strings.Contains(got, "{  }") || strings.Contains(got, "{}") || strings.Contains(got, ",\n\n") {
			t.Fatalf("case %d: migration left an empty object or line:\n%s", i, got)
		}
		if again := sidecarMigration(t, t.TempDir(), got); again != "" {
			t.Fatalf("case %d: a second migration changed\n%s\nto\n%s", i, got, again)
		}
	}
}
