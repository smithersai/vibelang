package lint

import (
	"context"
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"unicode"

	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestUnicodeLiteralGlobConfig(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "src", "café.vibe")
	text := `{
		"rules": {"effecttsgo/schema-sync": "error"},
		"overrides": [{"files": ["src/café.vibe"], "rules": {"effecttsgo/schema-sync": "off"}}],
		"ignorePatterns": ["src/café.vibe"]
	}`
	configFile := filepath.Join(dir, ".oxlintrc.json")
	if err := os.WriteFile(configFile, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := LoadConfig(configFile)
	if err != nil {
		t.Fatal(err)
	}
	if c.Rules["schemaSync"] != etscore.SeverityError {
		t.Fatal("the global schema-sync rule must be enabled for this regression")
	}
	if !c.Ignored(file) {
		t.Fatal("literal Unicode ignorePatterns did not match café.vibe")
	}
	if got := c.SeverityFor(file)["schemaSync"]; got != etscore.SeverityOff {
		t.Fatalf("literal Unicode override severity = %v, want off", got)
	}
	if c.Ignored(filepath.Join(dir, "src", "cafÃ©.vibe")) {
		t.Fatal("ignore pattern matched mojibake instead of the named file")
	}
}

func FuzzUnicodeGlobPaths(f *testing.F) {
	for _, seed := range []string{"café", "東京", "λ", "Ж", "𐐀", "e\u0301", "src/普通"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		// Generate literal Unicode segments, excluding glob metacharacters.
		var letters []rune
		for _, r := range input {
			if unicode.IsLetter(r) || unicode.IsMark(r) || unicode.IsDigit(r) {
				letters = append(letters, r)
				if len(letters) == 24 {
					break
				}
			}
		}
		segment := "é" + string(letters)
		first := string([]rune(segment)[0])
		literal := "src/" + segment + "/" + segment + ".vibe"
		patterns := []string{
			literal, segment + ".vibe", "./" + literal, "/" + literal,
			"src/*/" + segment + ".vibe", "src/**/" + segment + ".vibe",
			"src/" + segment + "/?" + string([]rune(segment)[1:]) + ".vibe",
			"src/" + segment + "/[" + first + "]" + string([]rune(segment)[1:]) + ".vibe",
			"src/" + segment + "/[!x]*.vibe",
			"src/" + segment + "/",
		}
		for _, pattern := range patterns {
			if !globRegexp(pattern).MatchString(literal) {
				t.Errorf("%q must match its decoded Unicode path %q", pattern, literal)
			}
		}
		// Compare the actual lint matcher with Go's independent rune-aware
		// segment glob parser for literals, wildcards, classes and separators.
		for _, pattern := range []string{literal, "src/*/" + segment + ".vibe", "src/" + segment + "/?.vibe", "src/" + segment + "/[é]*.vibe"} {
			for _, candidate := range []string{literal, "src/x/" + segment + ".vibe", literal + "x", strings.Replace(literal, "é", "x", 1)} {
				want, err := path.Match(pattern, candidate)
				if err != nil {
					t.Fatal(err)
				}
				if got := globRegexp(pattern).MatchString(candidate); got != want {
					t.Errorf("%q on %q = %v; path.Match = %v", pattern, candidate, got, want)
				}
			}
		}
		raw, err := json.Marshal(map[string]any{
			"rules":          map[string]string{"effecttsgo/schema-sync": "error"},
			"overrides":      []any{map[string]any{"files": []string{literal}, "rules": map[string]string{"effecttsgo/schema-sync": "off"}}},
			"ignorePatterns": []string{literal},
		})
		if err != nil {
			t.Fatal(err)
		}
		dir := t.TempDir()
		configFile := filepath.Join(dir, ".oxlintrc.json")
		if err := os.WriteFile(configFile, raw, 0o600); err != nil {
			t.Fatal(err)
		}
		config, err := LoadConfig(configFile)
		if err != nil {
			t.Fatal(err)
		}
		file := filepath.Join(dir, filepath.FromSlash(literal))
		if !config.Ignored(file) || config.SeverityFor(file)["schemaSync"] != etscore.SeverityOff {
			t.Fatalf("Unicode path lost its ignore or override: %s", raw)
		}
		if globRegexp("src/[!é]*/*.vibe").MatchString(literal) {
			t.Fatal("negated Unicode class matched the excluded rune")
		}
		if globRegexp("src/*/*.vibe").MatchString("src/" + segment + "/nested/x.vibe") {
			t.Fatal("* crossed a path separator")
		}
	})
}

func TestCommandUnicodeOverridesAndIgnores(t *testing.T) {
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = "../../../../../experiments/node_modules"
	}
	effect, err := filepath.Abs(filepath.Join(modules, "effect"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(effect, "package.json")); err != nil {
		t.Skipf("effect is not installed: %v; install experiments dependencies", err)
	}
	dir := t.TempDir()
	for _, name := range []string{"src", "node_modules"} {
		if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(effect, filepath.Join(dir, "node_modules", "effect")); err != nil {
		t.Fatal(err)
	}
	put := func(name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	put("package.json", `{"private":true,"type":"module"}`)
	put("tsconfig.json", `{"compilerOptions":{"target":"es2022","module":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"include":["src"]}`)
	put("src/café.vibe", "import { Schema } from \"effect\"\nexport const value = Schema.decodeUnknownSync(Schema.String)(\"x\")\n")
	for _, tc := range []struct {
		name, extra string
		status      int
	}{
		{"global error control", "", 1},
		{"literal override", `,"overrides":[{"files":["src/café.vibe"],"rules":{"effecttsgo/schema-sync":"off"}}]`, 0},
		{"wildcard override control", `,"overrides":[{"files":["src/caf?.vibe"],"rules":{"effecttsgo/schema-sync":"off"}}]`, 0},
		{"mojibake negative control", `,"overrides":[{"files":["src/cafÃ©.vibe"],"rules":{"effecttsgo/schema-sync":"off"}}]`, 1},
		{"literal ignore", `,"ignorePatterns":["src/café.vibe"]`, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			put(".oxlintrc.json", `{"rules":{"effecttsgo/schema-sync":"error"}`+tc.extra+"}")
			sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
			status := Command(context.Background(), sys, []string{"-c", ".oxlintrc.json", "src"})
			if status != tc.status || sys.err.Len() != 0 {
				t.Fatalf("status %d, want %d; stdout:\n%s\nstderr:\n%s", status, tc.status, sys.out.String(), sys.err.String())
			}
			if strings.Contains(sys.out.String(), "EK38112") != (tc.status == 1) {
				t.Fatalf("schema-sync diagnostic does not match the selected rule: %s", sys.out.String())
			}
		})
	}
}
