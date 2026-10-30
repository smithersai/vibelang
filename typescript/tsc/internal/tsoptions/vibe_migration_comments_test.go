package tsoptions_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"strings"
	"testing"
)

func TestVibeMigrationBraceComments(t *testing.T) {
	for _, text := range []string{
		"// config { comment\n" + `{"vibelang":{"diagnostics":{"EK4609":"off"}},"files":["main.vibe"]}`,
		`{"vibelang":{"diagnostics":{"EK4609":"off"}},"vibe": /* { comment */ {"effectGlobals":false},"files":["main.vibe"]}`,
		`{"vibelang":{"diagnostics":{"EK4609":"off"}},"vibe":{"severities": /* { comment */ {}},"files":["main.vibe"]}`,
	} {
		t.Run(text, func(t *testing.T) {
			fixed, changed := tsoptions.MigrateLegacySeverities("/project/tsconfig.json", text)
			if !changed {
				t.Fatalf("migration did not run: %s", fixed)
			}
			config := vibeConfig(t, fixed, "{}")
			options := config.CompilerOptions().VibeLang
			if options == nil || options.Severities["EK4609"] != "off" {
				t.Fatalf("lost severity inside a comment: %s", fixed)
			}
			if !strings.Contains(fixed, "{ comment") {
				t.Fatalf("lost comment: %s", fixed)
			}
		})
	}
}
