package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// FuzzFixChangedChecks compares the gate of vibelang --fix when it checks
// only a trial's changed files and the files that read them
// (fix_incremental.go) with the gate when it checks the whole program for
// each trial (vibelang.FixChecksWhole). fixGateRule keeps a round's fixes
// when "the edited program reports no error that the original did not", so
// the two must keep the same fixes and report the same refusals; and under
// vibelang.FixChecksVerify each check of changed files must find the errors
// a check of the whole program finds. This compares the compiler with
// itself, as RULES.md allows.
//
// The input names the project's files by key, comma-separated
// (fixChangedFiles); an unknown key picks one by its first byte, so a saved
// input keeps its meaning when keys are added.
func FuzzFixChangedChecks(f *testing.F) {
	startShortBudget(f)
	for _, seed := range []string{
		"chain",
		"global",
		"held,good",
		"chain,cross,good",
		"reader,rounds,good",
		"global,chain,match",
		"hidden,reader,held",
		"rounds,chain,rounds",
	} {
		f.Add(seed)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input string) {
		files := fixChangedProject(input)
		if files == nil {
			return
		}
		toolsGuard(t, "FuzzFixChangedChecks", func() {
			r := toolsCompile(t, w, "FuzzFixChangedChecks", files)
			defer r.Remove()
			config := toolsConfig(w, r.Dir)
			if r.Program == nil || config == nil || len(config.Errors) > 0 {
				return
			}
			var changed, whole, verified *vibelang.FixResult
			var progress strings.Builder
			toolsRun(t, "FuzzFixChangedChecks", "fix", input, nil, func() {
				changed = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			toolsRun(t, "FuzzFixChangedChecks", "fix-whole", input, nil, func() {
				whole = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{Checks: vibelang.FixChecksWhole})
			})
			toolsRun(t, "FuzzFixChangedChecks", "fix-verify", input, nil, func() {
				verified = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{Checks: vibelang.FixChecksVerify, Progress: &progress, ProgressEvery: time.Hour})
			})
			if diff := fixGateDiff(changed, whole); diff != "" {
				Gap(t, "FuzzFixChangedChecks", "fix:changed-checks-oracle", "checks of changed files and of the whole program keep different fixes for %q: %s\n%s", input, diff, Archive(files))
			}
			if differs := progress.String(); strings.Contains(differs, "found other errors") || fixGateDiff(verified, whole) != "" {
				Gap(t, "FuzzFixChangedChecks", "fix:changed-checks-verify", "a check of changed files and of the whole program find different errors for %q:\n%s\n%s", input, differs, Archive(files))
			}
		})
	})
}

// fixChangedFiles are the files FuzzFixChangedChecks builds projects of, by
// key: FuzzFixGate's, and files that read a fix's module through another
// module or a global declaration, which a check of changed files must reach.
var fixChangedFiles = append(slices.Clone(fixGateFiles), []struct {
	key   string
	files func(i int) map[string]string
}{
	// The cross-file refusal read through a re-export: the error is in a
	// file that imports neither the fix's module nor its text.
	{"chain", func(i int) map[string]string {
		return map[string]string{
			fmt.Sprintf("leaf%d.vibe", i): "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n",
			fmt.Sprintf("mid%d.vibe", i):  fmt.Sprintf("export { modes } from \"./leaf%d.vibe\"\n", i),
			fmt.Sprintf("top%d.vibe", i):  fmt.Sprintf("import { modes } from \"./mid%d.vibe\"\nexport effect function more() {\n  const all = try modes()\n  all.push(\"slow\")\n  return all\n}\n", i),
		}
	}},
	// The same refusal read through a global type that imports the fix's
	// module: every file reads globals.
	{"global", func(i int) map[string]string {
		return map[string]string{
			fmt.Sprintf("gmodes%d.vibe", i): "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n",
			fmt.Sprintf("globals%d.ts", i):  fmt.Sprintf("import type { Effect } from \"effect\"\ndeclare global {\n  type Modes%d = ReturnType<(typeof import(\"./gmodes%d.vibe\"))[\"modes\"]> extends Effect.Effect<infer A, any, any> ? A : never\n}\nexport {}\n", i, i),
			fmt.Sprintf("guse%d.ts", i):     fmt.Sprintf("export const slow%d: Modes%d[number] = \"slow\"\n", i, i),
		}
	}},
	// A TypeScript module that reads a fixed module's type, and one that
	// reads nothing a fix writes but reports an error from the start.
	{"reader", func(i int) map[string]string {
		return map[string]string{
			fmt.Sprintf("rtype%d.vibe", i): fmt.Sprintf("export type Read%d = Effect.Effect<Array<Effect.Effect<number>>>\n", i),
			fmt.Sprintf("rread%d.ts", i):   fmt.Sprintf("import type { Read%d } from \"./rtype%d.vibe\"\nexport type Held%d = Read%d\n", i, i, i, i),
			fmt.Sprintf("rerr%d.ts", i):    fmt.Sprintf("export const wrong%d: number = \"text\"\n", i),
		}
	}},
	// A refused fix whose module another file imports for a type only.
	{"held", func(i int) map[string]string {
		return map[string]string{
			fmt.Sprintf("hmatch%d.vibe", i): fmt.Sprintf("export type H%d = Effect.Effect<number>\n", i) + fixGateMatch("kind"),
			fmt.Sprintf("huse%d.ts", i):     fmt.Sprintf("import type { H%d } from \"./hmatch%d.vibe\"\nexport type U%d = H%d\n", i, i, i, i),
		}
	}},
}...)

// fixChangedProject builds the project input names, as fixGateProject
// does, from fixChangedFiles.
func fixChangedProject(input string) map[string]string {
	files := map[string]string{"main.vibe": "export const main = 1\n"}
	for i, key := range strings.Split(input, ",") {
		if i == 6 {
			break
		}
		if key == "" {
			continue
		}
		at := slices.IndexFunc(fixChangedFiles, func(f struct {
			key   string
			files func(i int) map[string]string
		}) bool {
			return f.key == key
		})
		if at < 0 {
			at = int(key[0]) % len(fixChangedFiles)
		}
		maps.Copy(files, fixChangedFiles[at].files(i))
	}
	if len(files) == 1 {
		return nil
	}
	return files
}
