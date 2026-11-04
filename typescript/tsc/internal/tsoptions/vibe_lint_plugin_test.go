package tsoptions_test

import (
	"fmt"
	"testing"
)

// VIP-38 requires EK3012 for assigned imported severities, including off,
// without a resolved plugin. Explicit disabled plugins are still resolved.
func TestLintPluginMigrationWarning(t *testing.T) {
	for _, mode := range []string{"absent", "empty", "other", "enabled", "disabled", "null", "inherited"} {
		for _, severity := range []string{"error", "warning", "suggestion", "off"} {
			t.Run(mode+"/"+severity, func(t *testing.T) {
				plugins := ""
				base := "{}"
				switch mode {
				case "empty":
					plugins = `,"plugins":[]`
				case "other":
					plugins = `,"plugins":[{"name":"other","custom":true}]`
				case "enabled":
					plugins = `,"plugins":[{"name":"@effect/language-service"}]`
				case "disabled":
					plugins = `,"plugins":[{"name":"@effect/language-service","diagnostics":false}]`
				case "null":
					plugins = `,"plugins":[{"name":"@effect/language-service","diagnosticSeverity":null}]`
				case "inherited":
					base = `{"compilerOptions":{"plugins":[{"name":"@effect/language-service"}]}}`
				}
				source := fmt.Sprintf(`{"extends":"./base.json","compilerOptions":{"strict":true%s},"vibe":{"severities":{"EK3801":%q}},"files":["main.vibe"]}`, plugins, severity)
				config := vibeConfig(t, source, base)
				count := 0
				for _, d := range config.GetConfigFileParsingDiagnostics() {
					if d.Source() == "EK" && d.Code() == 3012 {
						count++
						if d.Category().Name() != "warning" {
							t.Fatal(d.String())
						}
					}
				}
				want := 0
				if mode == "absent" || mode == "empty" || mode == "other" {
					want = 1
				}
				if count != want {
					t.Fatalf("EK3012 count=%d want=%d", count, want)
				}
			})
		}
	}
}
