package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
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

// fixGateFiles are the files FuzzFixGate builds projects of, by key. Each
// takes the index of its place in the input, so names do not collide.
var fixGateFiles = []struct {
	key   string
	files func(i int) map[string]string
}{
	// Nested contracts expose one repair per round. Mix them with refusals
	// so releasing an old checker cannot change a later round's decisions.
	// Smithers' flows exhausted memory while retaining earlier programs.
	{"rounds", func(i int) map[string]string {
		depth := 2 + i%3
		return map[string]string{fmt.Sprintf("rounds%d.vibe", i): fmt.Sprintf("export type Nested%d = ", i) + strings.Repeat("Effect.Effect<Array<", depth) + "number" + strings.Repeat(">>", depth) + "\n"}
	}},

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
			fmt.Sprintf("modes%d.vibe", i): "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n",
			fmt.Sprintf("uses%d.vibe", i):  fmt.Sprintf("import { modes } from \"./modes%d.vibe\"\nexport effect function more() {\n  const all = try modes()\n  all.push(\"slow\")\n  return all\n}\n", i),
		}
	}},
	// The same fix, read through a string in an import type: nothing the
	// error's statement names reaches the fix, so the gate halves.
	{"hidden", func(i int) map[string]string {
		return map[string]string{
			fmt.Sprintf("modes%d.vibe", i): "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n",
			fmt.Sprintf("uses%d.vibe", i):  fmt.Sprintf("export const more: ReturnType<(typeof import(\"./modes%d.vibe\"))[\"modes\"]> extends (\"fast\"[]!!) ? false : true = true\n", i),
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
