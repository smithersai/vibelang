package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// VIP-21 admits native generators; VIP-34 keeps ordinary --fix teaching
// rewrites and excludes them from --fix-migration-only.
func nativeGeneratorTeachingChapter(t testing.TB) {
	nativeGeneratorsChapter(t)
	text, err := os.ReadFile(SpecPath("../vips/0034-compiler-and-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	quote := "excluding TypeScript-form teaching rewrites"
	if !strings.Contains(string(text), quote) {
		t.Fatalf("VIP-34 no longer says %q", quote)
	}
}

func FuzzNativeGeneratorTeaching(f *testing.F) {
	startShortBudget(f)
	nativeGeneratorTeachingChapter(f)
	keys := []string{"value", "arrow", "declaration", "fn", "named-fn", "alias"}
	for _, key := range keys {
		f.Add([]byte(key))
		f.Add([]byte(key + ":comment"))
	}
	f.Add([]byte("refusal:string"))
	f.Add([]byte("refusal:number"))
	f.Add([]byte("refusal:boolean"))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input []byte) {
		key, trivia, _ := strings.Cut(string(input), ":")
		if key == "refusal" {
			checkNativeGeneratorTeachingRefusal(t, w, trivia)
			return
		}
		index := 0
		if len(input) > 0 {
			index = int(input[0]) % len(keys)
		}
		for i, k := range keys {
			if k == key {
				index = i
				break
			}
		}
		body := "const value = yield* Effect.succeed(7); return value"
		if trivia == "comment" {
			body = "/* keep teaching comment */ " + body
		}
		generator := "function* () { " + body + " }"
		programs := []string{
			"export const result = Effect.gen(" + generator + ")",
			"export const result = () => Effect.gen(" + generator + ")",
			"export function result() { return Effect.gen(" + generator + ") }",
			"export const result = Effect.fn(" + generator + ")",
			"export const result = Effect.fn(\"result\")(" + generator + ")",
			"export const result = Effect.gen(" + generator + ")",
		}
		source := "import { Effect } from \"effect\";\n" + programs[index]
		if index == 5 {
			source = strings.ReplaceAll(source, "Effect", "Fx")
			source = strings.Replace(source, "{ Fx }", "{ Effect as Fx }", 1)
		}
		before, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if HasError(before.Diagnostics) {
			Gap(t, "FuzzNativeGeneratorTeaching", keys[index], "VIP-21 native generator must compile before teaching: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
		}
		config := toolsConfig(w, before.Dir)
		var fixed *vibelang.FixResult
		within(t, "native generator teaching", func() {
			fixed = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		})
		if fixed.Err != nil || len(fixed.Refused) > 0 {
			t.Fatalf("safe teaching failed: %v, refused %v", fixed.Err, fixed.Refused)
		}
		text := source
		for name, file := range fixed.Files {
			if filepath.Base(name.AsString()) != "main.vibe" {
				t.Fatalf("teaching changed another file: %s", name)
			}
			text = file.Text
		}
		if strings.Contains(text, "function*") {
			Gap(t, "FuzzNativeGeneratorTeaching", keys[index], "VIP-34 ordinary --fix lost the existing safe native generator teaching rewrite:\n%s", text)
		}
		if trivia == "comment" && !strings.Contains(text, "keep teaching comment") {
			t.Fatal("teaching dropped its comment")
		}
		after, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": text}})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if HasError(after.Diagnostics) {
			t.Fatalf("teaching adds errors: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) > 0 {
			t.Fatalf("teaching did not reach its fixed point: %v, %v", again.Err, again.Order)
		}
		migration := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{MigrationOnly: true})
		if migration.Err != nil || len(migration.Files) > 0 {
			t.Fatalf("--fix-migration-only applied a teaching rewrite: %v, %v", migration.Err, migration.Order)
		}
	})
}

func checkNativeGeneratorTeachingRefusal(t *testing.T, w *Workspace, shape string) {
	TestFixGateQuoted(t)
	typ, literal := "string", "1"
	switch shape {
	case "number":
		typ, literal = "number", "\"bad\""
	case "boolean":
		typ, literal = "boolean", "1"
	}
	source := "import { Effect } from \"effect\";\n" +
		"export const good = () => Effect.gen(effect function* () { return yield* Effect.succeed(1) });\n" +
		"export const bad = () => Effect.gen(effect function* () { const value = yield* Effect.succeed(" + literal + "); const result: " + typ + " = value; return result });\n"
	before, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
	if err != nil {
		t.Fatal(err)
	}
	defer before.Remove()
	found := false
	for _, d := range before.Diagnostics {
		if d.Code() == 1002 {
			found = true
		}
	}
	if !found {
		t.Fatalf("invalid producer control did not reach EK1002: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
	}
	fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
	if fixed.Err != nil {
		t.Fatal(fixed.Err)
	}
	if len(fixed.Refused) != 1 || fixed.Refused[0].Code != 1002 {
		Gap(t, "FuzzNativeGeneratorTeaching", "refusal:"+shape, "VIP-34 safe-fix refuses the one unsafe generator once across diagnostic and teaching proposals: %v", fixed.Refused)
	}
	if len(fixed.Files) != 1 {
		t.Fatalf("safe sibling was not retained: %v", fixed.Order)
	}
}
