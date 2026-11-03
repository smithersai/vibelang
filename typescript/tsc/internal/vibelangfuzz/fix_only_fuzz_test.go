package vibelangfuzz

import (
	"context"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// The sentences of chapter 7 that FuzzFixOnly checks.
var fixOnlyRules = []string{
	"The repairs write no other file, a config included, even when they are interrupted",
	"Only an error in a listed module refuses a fix: a fix that breaks an unlisted module is kept, and the compilation after `--fix` reports the error.",
}

// TestFixOnlyRulesQuoted checks that chapter 7 still says what FuzzFixOnly quotes.
func TestFixOnlyRulesQuoted(t *testing.T) {
	text := SpecText("007-tooling.md")
	for _, q := range fixOnlyRules {
		if !strings.Contains(text, q) {
			t.Fatalf("007-tooling.md no longer says %q", q)
		}
	}
}

// fixOnlyProject builds a project from input, one module per comma-separated
// key: the key picks what the module holds, and a leading + lists it. An
// unknown key picks by its first byte, so a saved input keeps its meaning.
func fixOnlyProject(input string) (files map[string]string, listed []string) {
	bodies := []struct{ key, text string }{
		{"plain", "export type T%[1]d = number\n"},
		{"good", "export type T%[1]d = Effect.Effect<number>\n"},
		{"deep", "export type T%[1]d = Effect.Effect<Effect.Effect<string>>\n"},
		{"narrow", "export type T%[1]d = Effect.Effect<number>\nexport effect function modes%[1]d() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n"},
		{"broken", "export type T%[1]d = Effect.Effect<number>\nexport const broken%[1]d: string = 1\n"},
	}
	keys := strings.Split(input, ",")
	if len(keys) < 2 || len(keys) > 6 {
		return nil, nil
	}
	files = map[string]string{}
	for i, key := range keys {
		key, list := strings.CutPrefix(key, "+")
		if key == "" {
			return nil, nil
		}
		at := slices.IndexFunc(bodies, func(b struct{ key, text string }) bool { return b.key == key })
		if at < 0 {
			at = int(key[0]) % len(bodies)
		}
		name := fmt.Sprintf("m%d.vibe", i)
		text := fmt.Sprintf(bodies[at].text, i)
		if i > 0 {
			text = fmt.Sprintf("import type { T%d } from \"./m%d.vibe\"\nexport type V%d = T%d\n", i-1, i-1, i, i-1) + text
		}
		files[name] = text
		if list {
			listed = append(listed, name)
		}
	}
	return files, listed
}

// FuzzFixOnly checks fixOnlyRules on generated projects. Comparing a project
// with itself plus errors in unlisted modules is the compiler against itself,
// as RULES.md allows; the rules say the two must agree. Nothing a run verifies
// names an unlisted file, in a run that ends or one stopped after its first
// verified set.
func FuzzFixOnly(f *testing.F) {
	startShortBudget(f)
	for _, seed := range []string{
		"+good,good",
		"good,+good",
		"+narrow,good,broken",
		"+good,+deep,narrow,broken",
		"broken,+good",
		"+broken,+good,good",
	} {
		f.Add(seed)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input string) {
		files, listed := fixOnlyProject(input)
		if files == nil || len(listed) == 0 {
			return
		}
		run := func(files map[string]string, stopAfterFirst bool) (map[string]string, []string) {
			r := toolsCompile(t, w, "FuzzFixOnly", files)
			defer r.Remove()
			config := toolsConfig(w, r.Dir)
			if config == nil || len(config.Errors) > 0 {
				t.Skip("the project has no config")
			}
			only := []tspath.RootedFilePath{}
			for _, name := range listed {
				only = append(only, tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(r.Dir, name))))
			}
			ctx, stop := context.WithCancel(t.Context())
			defer stop()
			var verified []string
			var result *vibelang.FixResult
			toolsRun(t, "FuzzFixOnly", "fix", input, nil, func() {
				result = vibelang.FixProjectWithOptions(ctx, w.fs, bundled.LibPath(), config, vibelang.FixOptions{Only: only, Verified: func(texts map[tspath.RootedFilePath]string) {
					for name, text := range texts {
						base := filepath.Base(name.AsString())
						if files[base] != text {
							verified = append(verified, base)
						}
					}
					if stopAfterFirst {
						stop()
					}
				}})
			})
			if result.Err != nil {
				Gap(t, "FuzzFixOnly", "fix-only:error", "the run failed on %q: %v\n%s", input, result.Err, Archive(files))
			}
			fixed := map[string]string{}
			for name, file := range result.Files {
				fixed[filepath.Base(name.AsString())] = file.Text
			}
			return fixed, verified
		}
		toolsGuard(t, "FuzzFixOnly", func() {
			fixed, verified := run(files, false)
			_, stopped := run(files, true)
			for _, name := range slices.Concat(verified, stopped, slices.Collect(maps.Keys(fixed))) {
				if !slices.Contains(listed, name) {
					Gap(t, "FuzzFixOnly", "fix-only:unlisted-write", "007-tooling: %s; %q verified or wrote %s:\n%s", fixOnlyRules[0], input, name, Archive(files))
				}
			}
			noisy := maps.Clone(files)
			for name := range noisy {
				if !slices.Contains(listed, name) {
					noisy[name] += "export const unlistedError: string = 1\n"
				}
			}
			beside, _ := run(noisy, false)
			if !maps.Equal(fixed, beside) {
				Gap(t, "FuzzFixOnly", "fix-only:unlisted-error-decides", "007-tooling: %s; %q fixed %v alone and %v beside unlisted errors:\n%s", fixOnlyRules[1], input, fixed, beside, Archive(files))
			}
		})
	})
}

// TestFixOnlyCommandLine runs the binary, for what only the whole command
// shows: the compilation after a listed run reports what the run left, a
// fix that breaks an unlisted importer, and the run says it is partial. Plain
// --fix on the same project refuses that fix, the negative control.
func TestFixOnlyCommandLine(t *testing.T) {
	const main = "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n"
	const more = "import { modes } from \"./main.vibe\"\nexport effect function more() {\n  const all = try modes()\n  all.push(\"slow\")\n  return all\n}\n"
	w := NewWorkspace(t)
	binary := cliBuild(t, t.TempDir())
	project := func(t *testing.T) string {
		r := toolsCompile(t, w, "TestFixOnlyCommandLine", map[string]string{"main.vibe": main, "more.vibe": more})
		t.Cleanup(r.Remove)
		return r.Dir
	}
	read := func(t *testing.T, dir, name string) string {
		text, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		return string(text)
	}
	run := func(dir string, args ...string) (string, int) {
		cmd := cliCommand(binary, dir, args)
		out, _ := cmd.CombinedOutput()
		return string(out), cmd.ProcessState.ExitCode()
	}
	t.Run("without --fix", func(t *testing.T) {
		dir := project(t)
		out, status := run(dir, "--only", "main.vibe", "--noEmit", "--pretty", "false")
		if status == 0 || !strings.Contains(out, "TS5023") || read(t, dir, "main.vibe") != main {
			t.Fatalf("status %d, %s; want TS5023 and no edit", status, out)
		}
	})
	t.Run("plain --fix refuses the fix", func(t *testing.T) {
		dir := project(t)
		out, status := run(dir, "--fix", "--noEmit", "--pretty", "false", "-p", "tsconfig.json")
		if status != 0 || !strings.Contains(out, "refused") || strings.Contains(out, "partial repair") {
			t.Fatalf("status %d, %s; want a clean run that refused the fix", status, out)
		}
	})
	t.Run("--only keeps it and the compilation reports it", func(t *testing.T) {
		dir := project(t)
		out, status := run(dir, "--fix", "--only", "main.vibe", "--noEmit", "--pretty", "false", "-p", "tsconfig.json")
		if status == 0 || !strings.Contains(out, "partial repair") || !strings.Contains(out, "more.vibe") || !strings.Contains(out, "TS2345") {
			t.Fatalf("status %d, %s; want the partial repair and the importer's error", status, out)
		}
		if read(t, dir, "main.vibe") == main {
			t.Fatalf("main.vibe was not fixed:\n%s", out)
		}
		if read(t, dir, "more.vibe") != more {
			t.Fatalf("more.vibe changed:\n%s", read(t, dir, "more.vibe"))
		}
	})
}
