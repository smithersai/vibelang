package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// fixGateRule is the sentence of D291 that FuzzFixGate checks the gate of
// vibelang --fix against.
const fixGateRule = "A round's fixes are kept only when the edited program reports no error that the original did not, compared by file, code, and message: when the round as a whole would add one, each file's fixes are tried together, then one at a time, and each fix that adds an error is refused, named with its line and the first error it adds, and not tried again."

// TestFixGateQuoted checks that the decision log still says what
// FuzzFixGate quotes.
func TestFixGateQuoted(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(Root(), "docs/design/history/DECISIONS.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), fixGateRule) {
		t.Fatalf("docs/design/history/DECISIONS.md no longer says, in D291: %q", fixGateRule)
	}
}

// FuzzFixGate compares the gate of vibelang --fix, which checks a round of
// fixes together and finds the ones that add errors from where the errors
// are (fix_gate.go), with a check of each fix on its own: fixGateRule read
// one fix at a time, each tried on top of the fixes kept before it
// (vibelang.FixOptions.CheckEachFix). The gate must keep the same fixes and
// report the same refusals. This compares the compiler with itself, as
// RULES.md allows.
//
// The input names the project's files by key, comma-separated
// (fixGateFiles); an unknown key picks one by its first byte, so a saved
// input keeps its meaning when keys are added.
func FuzzFixGate(f *testing.F) {
	startShortBudget(f)
	for _, seed := range []string{
		"match,good,cross",
		"good,match,match,good,match",
		"cross,cross,good",
		"twice,syntax,good",
		"moved,match,cross",
		"cross,match,cross,cross,good",
		"hidden,match,hidden,good",
		"hidden,cross,twice,hidden",
	} {
		f.Add(seed)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input string) {
		files := fixGateProject(input)
		if files == nil {
			return
		}
		toolsGuard(t, "FuzzFixGate", func() {
			r := toolsCompile(t, w, "FuzzFixGate", files)
			defer r.Remove()
			config := toolsConfig(w, r.Dir)
			if r.Program == nil || config == nil || len(config.Errors) > 0 {
				return
			}
			var gate, each *vibelang.FixResult
			toolsRun(t, "FuzzFixGate", "fix", input, nil, func() {
				gate = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			toolsRun(t, "FuzzFixGate", "fix-each", input, nil, func() {
				each = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{CheckEachFix: true})
			})
			if diff := fixGateDiff(gate, each); diff != "" {
				Gap(t, "FuzzFixGate", "fix:gate-oracle", "the fix gate and a check of each fix disagree on %q: %s\n%s", input, diff, Archive(files))
			}
		})
	})
}

// fixGateFiles are the files FuzzFixGate builds projects of, by key. Each
// takes the index of its place in the input, so names do not collide.
var fixGateFiles = []struct {
	key   string
	files func(i int) map[string]string
}{
	// A fix that adds no error.
	{"good", func(i int) map[string]string {
		return map[string]string{fmt.Sprintf("good%d.vibe", i): fmt.Sprintf("export type T%d = Effect.Effect<number>\n", i)}
	}},
	// A fix whose text holds the error it adds: the Match chain's fix
	// compares "oauth" | "token" with "none" (TS2367).
	{"match", func(i int) map[string]string {
		return map[string]string{fmt.Sprintf("match%d.vibe", i): fmt.Sprintf("export type T%d = Effect.Effect<number>\n", i) + fixGateMatch("kind")}
	}},
	// Two such fixes in one file, which add the same error twice.
	{"twice", func(i int) map[string]string {
		return map[string]string{fmt.Sprintf("twice%d.vibe", i): fixGateMatch("kind") + strings.ReplaceAll(fixGateMatch("other"), "type Config", "type Config2")}
	}},
	// A fix that adds an error to another file, which reads a declaration
	// the fix rewrote: Effect.succeed("fast") is a string once it runs,
	// which push("slow") fits, and "fast" alone, which it does not.
	{"cross", func(i int) map[string]string {
		return map[string]string{
			fmt.Sprintf("modes%d.vibe", i): "export function modes() {\n  const mode = Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n",
			fmt.Sprintf("uses%d.vibe", i):  fmt.Sprintf("import { modes } from \"./modes%d.vibe\"\nexport function more() {\n  const all = modes()\n  all.push(\"slow\")\n  return all\n}\n", i),
		}
	}},
	// The same fix, read through a string in an import type: nothing the
	// error's statement names reaches the fix, so the gate halves.
	{"hidden", func(i int) map[string]string {
		return map[string]string{
			fmt.Sprintf("modes%d.vibe", i): "export function modes() {\n  const mode = Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n",
			fmt.Sprintf("uses%d.vibe", i):  fmt.Sprintf("export function more() {\n  const all: ReturnType<(typeof import(\"./modes%d.vibe\"))[\"modes\"]> = []\n  all.push(\"slow\")\n  return all\n}\n", i),
		}
	}},
	// A refused fix behind a syntax error, which hides no type error.
	{"syntax", func(i int) map[string]string {
		return map[string]string{fmt.Sprintf("syntax%d.vibe", i): fixGateMatch("kind") + "const broken = ;\n"}
	}},
	// An error the original reports, in text a fix rewrites and keeps: it
	// is not added, so it refuses nothing.
	{"moved", func(i int) map[string]string {
		return map[string]string{fmt.Sprintf("moved%d.vibe", i): fmt.Sprintf("export type U%d = Effect.Effect<number, Missing%d>\n", i, i)}
	}},
}

// fixGateMatch is a Match chain named name whose quick fix adds TS2367.
func fixGateMatch(name string) string {
	return "type Config = { readonly method: \"token\" | \"oauth\" }\n" +
		"export function " + name + "(config: Config): string {\n" +
		"  return Match.value(config).pipe(\n" +
		"    Match.whenOr({ method: \"oauth\" }, { method: \"none\" }, (c) => c.method),\n" +
		"    Match.orElse(() => \"other\"),\n" +
		"  )\n" +
		"}\n"
}

// fixGateProject builds the project input names, of up to six files, with
// a main.vibe that imports none of them; nil when input names none.
func fixGateProject(input string) map[string]string {
	files := map[string]string{"main.vibe": "export const main = 1\n"}
	for i, key := range strings.Split(input, ",") {
		if i == 6 {
			break
		}
		if key == "" {
			continue
		}
		at := slices.IndexFunc(fixGateFiles, func(f struct {
			key   string
			files func(i int) map[string]string
		}) bool {
			return f.key == key
		})
		if at < 0 {
			at = int(key[0]) % len(fixGateFiles)
		}
		maps.Copy(files, fixGateFiles[at].files(i))
	}
	if len(files) == 1 {
		return nil
	}
	return files
}

// fixGateDiff describes how two --fix results differ in the files they
// write, the fixes they count, and the refusals they report, in any order.
func fixGateDiff(a, b *vibelang.FixResult) string {
	if (a.Err == nil) != (b.Err == nil) {
		return fmt.Sprintf("errors %v and %v", a.Err, b.Err)
	}
	for name, fa := range a.Files {
		fb := b.Files[name]
		if fb == nil {
			return fmt.Sprintf("only the gate changes %s", name)
		}
		if fa.Text != fb.Text || !maps.Equal(fa.Counts, fb.Counts) || !maps.Equal(fa.Rewrites, fb.Rewrites) {
			return fmt.Sprintf("%s differs:\n%s\nchecked one at a time:\n%s", name, fa.Text, fb.Text)
		}
	}
	for name := range b.Files {
		if a.Files[name] == nil {
			return fmt.Sprintf("only the check of each fix changes %s", name)
		}
	}
	sorted := func(rs []vibelang.FixRefusal) []string {
		var lines []string
		for _, r := range rs {
			lines = append(lines, fmt.Sprintf("%s:%d: EK%04d: %s", r.File, r.Line, r.Code, r.Error))
		}
		slices.Sort(lines)
		return lines
	}
	if ra, rb := sorted(a.Refused), sorted(b.Refused); !slices.Equal(ra, rb) {
		return fmt.Sprintf("refusals\n%s\nchecked one at a time:\n%s", strings.Join(ra, "\n"), strings.Join(rb, "\n"))
	}
	return ""
}
