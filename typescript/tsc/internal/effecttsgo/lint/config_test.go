package lint

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
)

func TestKebabCaseMatchesEffectsOxlintNames(t *testing.T) {
	for name, want := range map[string]string{
		"floatingEffect":              "floating-effect",
		"cryptoRandomUUIDInEffect":    "crypto-random-uuid-in-effect",
		"effectSleepZeroToYieldNow":   "effect-sleep-zero-to-yield-now",
		"missingStarInYieldEffectGen": "missing-star-in-yield-effect-gen",
	} {
		if got := kebabCase(name); got != want {
			t.Errorf("kebabCase(%q) = %q, want %q", name, got, want)
		}
	}
	if ruleByOxlintName["effecttsgo/floating-effect"] != "floatingEffect" {
		t.Fatal("effecttsgo/floating-effect does not name floatingEffect")
	}
}

// The shape of foldkit's .oxlintrc.effect.json: a preset through extends,
// categories, overrides by file, and ignorePatterns.
func TestLoadConfigReadsExtendsOverridesAndIgnorePatterns(t *testing.T) {
	dir := t.TempDir()
	write := func(name, text string) {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("presets/correctness.json", `{ "rules": { "effecttsgo/floating-effect": "warn", "effecttsgo/class-self-mismatch": "warn" } }`)
	write(".oxlintrc.effect.json", `{
  // comments and trailing commas are allowed
  "extends": ["./presets/correctness.json"],
  "categories": { "correctness": "off" },
  "rules": {
    "effecttsgo/effect-in-failure": ["error", {}],
    "effecttsgo/class-self-mismatch": "off",
    "no-console": "error",
  },
  "overrides": [
    { "files": ["packages/a/src/runtime.vibe"], "rules": { "effecttsgo/floating-effect": "off" } },
    { "files": ["**/*.test.vibe"], "rules": { "effecttsgo/effect-in-failure": 1 } }
  ],
  "ignorePatterns": ["packages/website/src/snippet/"]
}`)
	config, err := LoadConfig(filepath.Join(dir, ".oxlintrc.effect.json"))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]etscore.Severity{
		"floatingEffect":    etscore.SeverityWarning,
		"classSelfMismatch": etscore.SeverityOff,
		"effectInFailure":   etscore.SeverityError,
	}
	for name, severity := range want {
		if config.Rules[name] != severity {
			t.Errorf("%s: %v, want %v", name, config.Rules[name], severity)
		}
	}
	if len(config.Rules) != len(want) {
		t.Errorf("rules %v, want only the effecttsgo ones", config.Rules)
	}
	if got := config.SeverityFor(filepath.Join(dir, "packages/a/src/runtime.vibe"))["floatingEffect"]; got != etscore.SeverityOff {
		t.Errorf("override by path: %v", got)
	}
	if got := config.SeverityFor(filepath.Join(dir, "packages/a/src/x.test.vibe"))["effectInFailure"]; got != etscore.SeverityWarning {
		t.Errorf("override by glob: %v", got)
	}
	if !config.Ignored(filepath.Join(dir, "packages/website/src/snippet/a.vibe")) || config.Ignored(filepath.Join(dir, "packages/website/src/a.vibe")) {
		t.Error("ignorePatterns: a directory pattern must match its contents only")
	}
}
