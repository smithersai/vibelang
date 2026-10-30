package tsoptions_test

import "testing"

// A tsconfig.json that parses with a computed property name, as a broken
// string leaves one ("target"s2022", ...), is read without asking that name
// for its text: looking up compilerOptions, vibelang and diagnostics
// compares only names that have text (a compiler panic before).
func TestConfigLookupSkipsComputedPropertyNames(t *testing.T) {
	for _, text := range []string{
		`{"compilerOptions": {["x"]: 1}, "files": ["main.vibe"]}`,
		`{["x"]: 1, "files": ["main.vibe"]}`,
		`{"compilerOptions": {"vibelang": {["x"]: 1}}, "files": ["main.vibe"]}`,
	} {
		t.Run(text, func(t *testing.T) {
			vibeConfig(t, text, "{}").GetConfigFileParsingDiagnostics()
		})
	}
}
