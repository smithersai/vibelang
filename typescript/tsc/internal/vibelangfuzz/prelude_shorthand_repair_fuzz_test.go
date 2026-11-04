package vibelangfuzz

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Chapter 007, "Legacy prelude shorthand".
var preludeShorthandQuotes = []string{
	"The transitional compiler accepts these shorthands without a migration diagnostic. All three `--fix` scopes select their resolved legacy bindings",
	"| Bare prelude `Scope` type | `Scope.Scope` |",
	"| Same-named module export, such as `Option<A>` or `FileSystem.of(impl)` | `Option.Option<A>` or `FileSystem.FileSystem.of(impl)` |",
}

func preludeShorthandQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("007-tooling.md")
	for _, quote := range preludeShorthandQuotes {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 007 no longer says %q", quote)
		}
	}
}
func TestPreludeShorthandRepairQuoted(t *testing.T) { preludeShorthandQuoted(t) }

// preludeShorthandRows pair a written shorthand with the export --fix writes;
// a row whose repaired text equals its source is a spelling --fix keeps.
var preludeShorthandRows = []struct{ key, source, repaired string }{
	{"shadow-local-scope", "type Scope = { value: number }; export type LocalScopeType = Scope\n", "type Scope = { value: number }; export type LocalScopeType = Scope\n"},
	{"shadow-local-option", "type Option<A> = { value: A }; export type LocalOptionType = Option<number>\n", "type Option<A> = { value: A }; export type LocalOptionType = Option<number>\n"},
	{"shadow-type-parameter", "export function identity<Scope>(value: Scope): Scope { return value }\n", "export function identity<Scope>(value: Scope): Scope { return value }\n"},
	{"type-option", "export type Maybe = Option<number>\n", "export type Maybe = Option.Option<number>\n"},
	{"type-option-nested-argument", "export type Rows = Option<Array<number>>\n", "export type Rows = Option.Option<Array<number>>\n"},
	{"type-scope", "export function scoped(s: Scope): number { return 1 }\n", "export function scoped(s: Scope.Scope): number { return 1 }\n"},
	{"type-nested-shorthand", "export const running = (process: Experimental.Process, pid: number) => process.isRunning(pid)\n", "export const running = (process: Experimental.Process.Process, pid: number) => process.isRunning(pid)\n"},
	{"type-nested-written", "export const written = (process: Experimental.Process.Process, pid: number) => process.isRunning(pid)\n", "export const written = (process: Experimental.Process.Process, pid: number) => process.isRunning(pid)\n"},
	{"member-of", "export const noop = FileSystem.of\n", "export const noop = FileSystem.FileSystem.of\n"},
	{"member-module-export", "export const stub = FileSystem.layerNoop\n", "export const stub = FileSystem.layerNoop\n"},
	{"key-written", "export const key = FileSystem.FileSystem\n", "export const key = FileSystem.FileSystem\n"},
	{"type-written", "export type Written = Option.Option<number>\n", "export type Written = Option.Option<number>\n"},
}

// FuzzPreludeShorthandRepair checks each shorthand row in a context the
// fuzz bytes pick: the row alone, after another row, inside a comment-bearing
// file, or with CRLF line ends. The shorthand compiles without an EK
// diagnostic; every --fix scope writes the export and a second run writes
// nothing; the repaired program still compiles.
func FuzzPreludeShorthandRepair(f *testing.F) {
	startShortBudget(f)
	preludeShorthandQuoted(f)
	for _, row := range preludeShorthandRows {
		for _, variant := range []byte{0, 1, 2, 3} {
			f.Add([]byte(row.key + "\x00" + string(variant)))
		}
	}
	w := NewWorkspace(f)
	const config = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`
	f.Fuzz(func(t *testing.T, data []byte) {
		preludeShorthandQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		i := slices.IndexFunc(preludeShorthandRows, func(row struct{ key, source, repaired string }) bool { return row.key == parts[0] })
		if i < 0 {
			i = len(data) % len(preludeShorthandRows)
		}
		row := preludeShorthandRows[i]
		variant := byte(0)
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0] & 3
		}
		source, repaired := row.source, row.repaired
		switch variant {
		case 1: // after another row, so the rewrite keeps its place
			other := preludeShorthandRows[(i+1)%len(preludeShorthandRows)]
			source, repaired = other.source+source, other.repaired+repaired
		case 2: // comments around the shorthand survive
			source = "// shorthand kept by the transitional compiler\n" + source + "// end\n"
			repaired = "// shorthand kept by the transitional compiler\n" + repaired + "// end\n"
		case 3: // CRLF line ends are preserved
			source = strings.ReplaceAll(source, "\n", "\r\n")
			repaired = strings.ReplaceAll(repaired, "\n", "\r\n")
		}
		key := row.key + ":" + string(rune('0'+variant))
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		for _, d := range r.Diagnostics {
			if IsEK(d) || d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzPreludeShorthandRepair", key, "%s; got %s", preludeShorthandQuotes[0], d.String())
				return
			}
		}
		for _, options := range []vibelang.FixOptions{{}, {MigrationOnly: true}, {VIPOnly: true}} {
			parsed := toolsConfig(w, r.Dir)
			if parsed == nil {
				t.Fatal("no configuration")
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), parsed, options)
			got := source
			for name, file := range result.Files {
				if filepath.Base(name.AsString()) == "main.vibe" {
					got = file.Text
				}
			}
			if result.Err != nil || len(result.Refused) != 0 || got != repaired {
				Gap(t, "FuzzPreludeShorthandRepair", key, "%s; %+v wrote:\n%s\nwant:\n%s\nrefused %+v", preludeShorthandQuotes[2], options, got, repaired, result.Refused)
				return
			}
		}
		fixed, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": repaired}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer fixed.Remove()
		for _, d := range fixed.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzPreludeShorthandRepair", key, "the repaired program does not compile: %s", d.String())
				return
			}
		}
		for _, options := range []vibelang.FixOptions{{}, {MigrationOnly: true}, {VIPOnly: true}} {
			parsed := toolsConfig(w, fixed.Dir)
			if parsed == nil {
				t.Fatal("no repaired configuration")
			}
			again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), parsed, options)
			if again.Err != nil || len(again.Order) != 0 {
				Gap(t, "FuzzPreludeShorthandRepair", key, "a second run with %+v changed %v", options, again.Order)
				return
			}
		}
		ExpectPending(t, "FuzzPreludeShorthandRepair", key)
		ExpectPending(t, "FuzzPreludeShorthandRepair", specCorpusKey(t))
	})
}
