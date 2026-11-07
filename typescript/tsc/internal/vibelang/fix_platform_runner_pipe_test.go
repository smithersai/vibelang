package vibelang

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-23 and VIP-34: a preserving pipe repair recognizes the pinned platform
// runner by its declaration, including an imported alias and an options stage.
func TestPlatformRunnerPipeFix(t *testing.T) {
	packages := map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime", "@effect": "docs/tools/node_modules/@effect"}
	for _, test := range []struct{ name, prefix, stage string }{
		{"namespace", "import * as NodeRuntime from \"@effect/platform-node/NodeRuntime\"\n", "NodeRuntime.runMain"},
		{"root", "import { NodeRuntime } from \"@effect/platform-node\"\n", "NodeRuntime.runMain"},
		{"alias", "import { runMain as launch } from \"@effect/platform-node/NodeRuntime\"\n", "launch"},
		{"BunRuntime", "import * as Runtime from \"@effect/platform-bun/BunRuntime\"\n", "Runtime.runMain"},
		{"BrowserRuntime", "import * as Runtime from \"@effect/platform-browser/BrowserRuntime\"\n", "Runtime.runMain"},
		{"options", "import * as NodeRuntime from \"@effect/platform-node/NodeRuntime\"\n", "NodeRuntime.runMain({ disableErrorReporting: true })"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := test.prefix + "const program = effect { return 1 }\nprogram.pipe(" + test.stage + ")\n"
			_, file, _, _ := editorProgramWith(t, source, packages)
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || strings.Contains(fixed.Text, ".pipe(") || !strings.Contains(fixed.Text, "|>") {
				t.Fatalf("platform runner pipe was not repaired: files=%v refused=%v", result.Files, result.Refused)
			}
			program, checked, _, _ := editorProgramWith(t, fixed.Text, packages)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), checked), program.GetSemanticDiagnostics(t.Context(), checked)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed source reports %s\n%s", d.String(), fixed.Text)
				}
			}
			again := fixCase(t, filepath.Dir(checked.FileName().AsString()))
			if again.Err != nil || len(again.Files) != 0 {
				t.Fatalf("second repair changes source: %+v", again)
			}
		})
	}
}

func TestPlatformRunnerPipeKeepsOpaqueReceivers(t *testing.T) {
	packages := map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime", "@effect": "docs/tools/node_modules/@effect"}
	for _, source := range []string{
		"declare const runMain: (this: unknown, program: number!!) => void\nconst program = effect { return 1 }\nprogram.pipe(runMain)\n",
		"import * as NodeRuntime from '@effect/platform-node/NodeRuntime'\ndeclare const holder: { runMain: typeof NodeRuntime.runMain }\nconst program = effect { return 1 }\nprogram.pipe(holder.runMain)\n",
		"import * as NodeRuntime from '@effect/platform-node/NodeRuntime'\ndeclare const runMain: typeof NodeRuntime.runMain\nconst program = effect { return 1 }\nprogram.pipe(runMain)\n",
	} {
		_, file, _, _ := editorProgramWith(t, source, packages)
		result := fixCase(t, filepath.Dir(file.FileName().AsString()))
		fixed := source
		if changed := result.Files[file.FileName()]; changed != nil {
			fixed = changed.Text
		}
		if !strings.Contains(fixed, ".pipe(") {
			t.Fatalf("opaque receiver was rewritten: %s", fixed)
		}
		found := false
		for _, refused := range result.Refused {
			if strings.Contains(refused.Error, "receiver") {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing receiver-safety refusal: %+v", result.Refused)
		}
	}
}

// A runner in the middle may start the program before a later stage factory.
// Its export is immutable, but that does not allow delaying the later factory.
func TestPlatformRunnerPipeCapturesFollowingStage(t *testing.T) {
	packages := map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime", "@effect": "docs/tools/node_modules/@effect"}
	source := "import * as NodeRuntime from '@effect/platform-node/NodeRuntime'\nconst build = () => (_value: void) => 1\nexport const result = Effect.succeed(1).pipe(NodeRuntime.runMain, build())\n"
	_, file, _, _ := editorProgramWith(t, source, packages)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	fixed := result.Files[file.FileName()]
	if result.Err != nil || fixed == nil || strings.Contains(fixed.Text, ".pipe(") || !strings.Contains(fixed.Text, "const pipe$stage") {
		t.Fatalf("a runner before a later factory must retain captures: fixed=%v refused=%v error=%v", fixed, result.Refused, result.Err)
	}
	program, checked, _, _ := editorProgramWith(t, fixed.Text, packages)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), checked) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("captured runner reports %s\n%s", d.String(), fixed.Text)
		}
	}
}

func TestPlatformRunnerPipeCapturesOptionsConstruction(t *testing.T) {
	packages := map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime", "@effect": "docs/tools/node_modules/@effect"}
	source := "import * as NodeRuntime from '@effect/platform-node/NodeRuntime'\nexport const result = Effect.succeed(1).pipe(Effect.asVoid, NodeRuntime.runMain({ disableErrorReporting: true }))\n"
	_, file, _, _ := editorProgramWith(t, source, packages)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	fixed := result.Files[file.FileName()]
	if result.Err != nil || fixed == nil || strings.Contains(fixed.Text, ".pipe(") || !strings.Contains(fixed.Text, "const pipe$stage") {
		t.Fatalf("runner options must be constructed before stages apply: fixed=%v refused=%v error=%v", fixed, result.Refused, result.Err)
	}
	program, checked, _, _ := editorProgramWith(t, fixed.Text, packages)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), checked) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("captured options report %s\n%s", d.String(), fixed.Text)
		}
	}
}
