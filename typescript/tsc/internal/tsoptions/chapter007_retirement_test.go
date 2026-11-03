package tsoptions_test

import (
	"os"
	"strings"
	"testing"
)

// Chapter 007 / retired trust configuration: docs/design/src/007-tooling.md#5e55d80b76d5ca85
func TestChapter007RetiredTrustedPackages(t *testing.T) {
	if os.Getenv("VIBELANG_COVERAGE_RUN_PENDING") != "1" {
		t.Skip("docs/design/src/007-tooling.md#5e55d80b76d5ca85: trustedPackages remains accepted; witness root and compilerOptions.vibelang maps")
	}
	for _, text := range []string{
		`{"vibelang":{"trustedPackages":["fixture"]},"files":["main.vibe"]}`,
		`{"compilerOptions":{"vibelang":{"trustedPackages":["fixture"]}},"files":["main.vibe"]}`,
	} {
		config := vibeConfig(t, text, "{}")
		found := false
		for _, d := range config.Errors {
			if strings.Contains(d.String(), "trustedPackages") {
				found = true
			}
		}
		if !found {
			t.Errorf("retired trustedPackages was silently accepted: %s", text)
		}
	}
}

// Chapter 007 / native declaration spelling replaces styles: docs/design/src/007-tooling.md#dabe89ca51aa0485
// Chapter 007 / no vibex style choice: docs/design/src/007-tooling.md#e5a04275f85b48c9
func TestChapter007RetiredDeclarationStyles(t *testing.T) {
	if os.Getenv("VIBELANG_COVERAGE_RUN_PENDING") != "1" {
		t.Skip("docs/design/src/007-tooling.md#dabe89ca51aa0485 and #e5a04275f85b48c9: legacy style still validates values instead of warning and ignoring them")
	}
	for _, value := range []string{`".js"`, `"extensionless"`, `".ts"`, `"invalid"`, `42`, `true`, `null`, `[]`, `{}`} {
		for _, nested := range []bool{false, true} {
			section := `"vibelang":{"declarationImportStyle":` + value + "}"
			if nested {
				section = `"compilerOptions":{` + section + "}"
			}
			config := vibeConfig(t, "{"+section+`,"files":["main.vibe"]}`, "{}")
			warned := false
			for _, d := range config.Errors {
				if d.Category().Name() == "error" {
					t.Errorf("retired style %s remains an error: %s", value, d.String())
				}
				if d.Category().Name() == "warning" && strings.Contains(d.String(), "declarationImportStyle") {
					warned = true
				}
			}
			if !warned {
				t.Errorf("retired style %s has no deprecation warning (nested=%t)", value, nested)
			}
		}
	}
}
