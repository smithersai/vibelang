package tsoptions_test

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func TestLegacyMigrationWrapperComment(t *testing.T) {
	text := `{"compilerOptions":{"target":"ES2022","module":"NodeNext"},"files":["main.vibe"],"vibelang": { /* KEEP_WRAPPER */ "diagnostics": { "EK4830": "off" } },"vibe": { "effectModules": false, "severities": { "EK4831": "off" } }}`
	fixed, changed := tsoptions.MigrateLegacySeverities("/project/tsconfig.json", text)
	if !changed || !strings.Contains(fixed, "/* KEEP_WRAPPER */") {
		t.Fatalf("lost wrapper comment (changed=%v): %s", changed, fixed)
	}
}

// Chapter 7 requires preserving JSONC comments, unrelated settings and modern
// entries. Exercise each formerly deleted range both locally and in a base.
func TestLegacyMigrationAllCommentShapes(t *testing.T) {
	shapes := []struct{ name, legacy string }{
		{"wrapper", `{/* KEEP_WRAPPER */ "diagnostics":{"EK4830":"off"}}`},
		{"map-tail", `{"diagnostics":{"EK4830":"off" /* KEEP_TAIL */}}`},
		{"map-trailing-comma", `{"diagnostics":{"EK4830":"off", // KEEP_TRAILING
}}`},
		{"empty", `{"diagnostics":{/* KEEP_EMPTY */}}`},
		{"superseded", `{"diagnostics":{/* KEEP_SUPERSEDED */ "EK4831":"error"}}`},
		{"entry-internal", `{"diagnostics":{"EK4830" /* KEEP_KEY */ : /* KEEP_VALUE */ "off"}}`},
		{"wrapper-tail", `{"diagnostics":{"EK4830":"off"} // KEEP_WRAPPER_TAIL
}`},
		{"retained-wrapper", `{"trustedPackages":["keep"], /* KEEP_BEFORE_MAP */ "diagnostics": /* KEEP_BEFORE_BRACE */ {"EK4830":"off" /* KEEP_TAIL */}}`},
		{"strings", `{"diagnostics":{"EK4830":"off"},"trustedPackages":["https://example.invalid/*not-comment*/"] /* KEEP_STRING_NEIGHBOR */}`},
	}
	for _, shape := range shapes {
		for _, nested := range []bool{false, true} {
			for _, inherited := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/nested=%v/inherited=%v", shape.name, nested, inherited), func(t *testing.T) {
					legacy := `"vibelang":` + shape.legacy
					if nested {
						legacy = `"compilerOptions":{` + legacy + `}`
					}
					text := `{` + legacy + `,"vibe":{"effectModules":false,"severities":{"EK4831":"off"}},"files":["main.vibe"]}`
					fixed, changed := tsoptions.MigrateLegacySeverities("/project/base.json", text)
					if !changed {
						t.Fatalf("not migrated: %s", fixed)
					}
					for _, marker := range regexp.MustCompile(`/\* KEEP_[A-Z_]+ \*/|// KEEP_[A-Z_]+`).FindAllString(text, -1) {
						if strings.Count(fixed, marker) != strings.Count(text, marker) {
							t.Errorf("comment %q lost or duplicated: %s", marker, fixed)
						}
					}
					if strings.Contains(fixed, `"diagnostics"`) {
						t.Fatalf("legacy map remains: %s", fixed)
					}
					if again, changed := tsoptions.MigrateLegacySeverities("/project/base.json", fixed); changed || again != fixed {
						t.Fatalf("second run differs: %s", again)
					}
					root, base := fixed, "{}"
					if inherited {
						root, base = `{"extends":"./base.json","files":["main.vibe"]}`, fixed
					}
					parsed := vibeConfig(t, root, base)
					if len(parsed.Errors) != 0 {
						t.Fatalf("invalid config: %v\n%s", parsed.Errors, fixed)
					}
					want := map[string]string{"EK4831": "off"}
					if shape.name != "empty" && shape.name != "superseded" {
						want["EK4830"] = "off"
					}
					if got := parsed.CompilerOptions().VibeLang; got == nil || !reflect.DeepEqual(got.Severities, want) || got.EffectModules != core.TSFalse {
						t.Fatalf("changed options: %+v, want %v", got, want)
					}
					if kept := parsed.CompilerOptions().VibeLang.TrustedPackages; shape.name == "retained-wrapper" && (len(kept) != 1 || kept[0] != "keep") {
						t.Fatal("lost trustedPackages")
					}
					if shape.name == "strings" && !strings.Contains(fixed, "https://example.invalid/*not-comment*/") {
						t.Fatal("changed a string")
					}
				})
			}
		}
	}
}
