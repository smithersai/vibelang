package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/execute"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// TestWarningsOnlyBuildExitStatus runs the vibelang command on projects whose
// only diagnostics are warnings, and checks the exit status that chapter 7's
// "Reporting and exit status" table and VIP-38's amendment give:
//
//   - VibeLang's own warning prints and exits 0.
//   - An imported Effect warning, EK38130 unstableApiUsage as in opencode's
//     http-recorder, exits 2 by default: imported diagnostics keep the pinned
//     Effect compiler's policy, ignoreEffectWarningsInTscExitCode false.
//   - With ignoreEffectWarningsInTscExitCode true it still prints and exits 0.
//   - ignoreEffectErrorsInTscExitCode alone does not cover a warning.
//
// Each run prints no error line, so a status of 2 here comes only from the
// exit policy. The filter-level tests cover every category; this one runs
// the command.
func TestWarningsOnlyBuildExitStatus(t *testing.T) {
	w := NewWorkspace(t)
	const own = "import { Effect } from \"effect\"\nexport const stamp: Effect.Effect<number, never, never> = Effect.succeed(42)\n"
	const imported = "import { FileSystem } from \"effect\"\nexport const api = FileSystem.FileSystem\n"
	for i, test := range []struct {
		name, file, source string
		plugin             map[string]any // nil: no @effect/language-service entry
		code               string
		status             int
	}{
		{"own warning", "main.vibe", own, nil, "EK4833", 0},
		{"imported warning, default policy", "main.ts", imported, map[string]any{}, "EK38130", 2},
		{"imported warning, warnings ignored", "main.ts", imported, map[string]any{"ignoreEffectWarningsInTscExitCode": true}, "EK38130", 0},
		{"imported warning, only errors ignored", "main.ts", imported, map[string]any{"ignoreEffectErrorsInTscExitCode": true}, "EK38130", 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := filepath.Join(w.Dir, fmt.Sprintf("warnings-only-%d", i))
			options := map[string]any{"strict": true, "skipLibCheck": true, "noEmit": true, "types": []string{}, "target": "ES2022", "module": "NodeNext"}
			if test.plugin != nil {
				test.plugin["name"] = "@effect/language-service"
				options["plugins"] = []any{test.plugin}
			}
			config, err := json.Marshal(map[string]any{"compilerOptions": options, "files": []string{test.file}})
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			for name, text := range map[string]string{"package.json": `{"type":"module"}`, "tsconfig.json": string(config), test.file: test.source} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			sys := &sidecarParitySystem{fs: w.fs, cwd: tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(dir))}
			run := execute.CommandLine(t.Context(), sys, []string{"-p", ".", "--pretty", "false"}, nil)
			output := sys.output.String()
			var warnings []string
			for _, match := range regexp.MustCompile(`(?m)^\S+\(\d+,\d+\): (error|warning) ((?:TS|EK)\d+):`).FindAllStringSubmatch(output, -1) {
				if match[1] == "error" {
					t.Fatalf("a warnings-only fixture printed an error:\n%s", output)
				}
				warnings = append(warnings, match[2])
			}
			if !slices.Contains(warnings, test.code) {
				t.Fatalf("want warning %s printed, got %v:\n%s", test.code, warnings, output)
			}
			if int(run.Status) != test.status {
				t.Fatalf("exit status %d, want %d:\n%s", run.Status, test.status, output)
			}
		})
	}
}
