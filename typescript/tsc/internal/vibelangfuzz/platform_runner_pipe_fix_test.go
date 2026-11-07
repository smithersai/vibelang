package vibelangfuzz

import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const platformRunnerPipeTarget = "FuzzPlatformRunnerPipeFix"
const platformRunnerPipeQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestPlatformRunnerPipeFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), platformRunnerPipeQuote) {
		t.Fatal("preserving quick-fix rule moved")
	}
}

// Static preservation oracle: a known pinned platform runner is repaired,
// compiles with the native twin's declaration and reaches a fixed point.
// Unknown custom stages retain the receiver-safety refusal.
func FuzzPlatformRunnerPipeFix(f *testing.F) {
	startShortBudget(f)
	keys := []string{"opencode", "namespace", "alias", "options", "reexport", "opaque", "runner-first"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	f.Add("namespace", uint8(3))
	f.Add("options", uint8(1))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestPlatformRunnerPipeFixQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		source := "import * as Effect from 'effect/Effect'\n"
		extra := map[string]string{}
		stage := "NodeRuntime.runMain"
		switch key {
		case "opencode":
			corpus, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/corpus/opencode-platform-runner-pipe.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			source += string(corpus)
		case "alias":
			source += "import { runMain as launch } from '@effect/platform-node/NodeRuntime'\n"
			stage = "launch"
		case "options":
			source += "import * as NodeRuntime from '@effect/platform-node/NodeRuntime'\n"
			stage += "({ disableErrorReporting: true })"
		case "reexport":
			source += "import { launch } from './runner.js'\n"
			stage = "launch"
			extra["runner.ts"] = "export { runMain as launch } from '@effect/platform-node/NodeRuntime'\n"
		case "runner-first":
			source += "import * as NodeRuntime from '@effect/platform-node/NodeRuntime'\nconst build = () => (_value: void) => 1\n"
			stage = "NodeRuntime.runMain, build()"
		case "opaque":
			source += "declare const launch: (this: unknown, self: Effect.Effect<number>) => void\n"
			stage = "launch"
		default:
			source += "import * as NodeRuntime from '@effect/platform-node/NodeRuntime'\n"
		}
		if key != "opencode" {
			stages := []string{}
			if key != "opaque" && mode&1 != 0 {
				stages = append(stages, "Effect.map((n) => n + 1)")
			}
			stages = append(stages, stage)
			source += "const program = Effect.succeed(1)\nexport const result = program.pipe(" + strings.Join(stages, ", ") + ")\n"
		}
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := maps.Clone(extra)
		files["main.vibe"] = source
		native := maps.Clone(extra)
		native["main.ts"] = strings.ReplaceAll(source, "effect { return 1 }", "Effect.gen(function* () { return 1 })")
		stock := toolsCompile(t, w, platformRunnerPipeTarget, native)
		defer stock.Remove()
		if !toolsErrorFree(stock) {
			t.Fatalf("invalid native twin: %v", stock.Diagnostics)
		}
		before := toolsCompile(t, w, platformRunnerPipeTarget, files)
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if result.Err != nil {
			Gap(t, platformRunnerPipeTarget, key+":fix", "%s: %v", platformRunnerPipeQuote, result.Err)
			return
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		repaired := !strings.Contains(fixed["main.vibe"], ".pipe(")
		if key == "opaque" {
			if repaired || !slices.ContainsFunc(result.Refused, func(refused vibelang.FixRefusal) bool { return strings.Contains(refused.Error, "receiver") }) {
				t.Fatalf("opaque receiver was not retained: source=%s refused=%v", fixed["main.vibe"], result.Refused)
			}
			return
		}
		if key == "runner-first" && !strings.Contains(fixed["main.vibe"], "const pipe$stage") {
			Gap(t, platformRunnerPipeTarget, key+":construction-order", "a runner before a later factory must retain captures")
			return
		}
		if !repaired {
			Gap(t, platformRunnerPipeTarget, key+":repair", "known platform runner not repaired: %s refused=%v", fixed["main.vibe"], result.Refused)
			return
		}
		after := toolsCompile(t, w, platformRunnerPipeTarget, fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, platformRunnerPipeTarget, key+":check", "fixed diagnostics: %v", after.Diagnostics)
			return
		}
		for name, text := range stock.Outputs {
			if strings.HasSuffix(name, ".d.ts") && after.Outputs[name] != text {
				Gap(t, platformRunnerPipeTarget, key+":declaration", "%s differs: native=%s fixed=%s", name, text, after.Outputs[name])
			}
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 {
			Gap(t, platformRunnerPipeTarget, key+":fixed-point", "second fix changes source: %v", again)
		}
	})
}
