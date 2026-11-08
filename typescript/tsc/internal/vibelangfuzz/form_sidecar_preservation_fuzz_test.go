package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const sidecarFormTarget = "FuzzFormSidecarPreservation"

func sidecarFormQuotes(tb testing.TB) {
	tb.Helper()
	for _, quote := range []string{
		"Every \x60.vibe\x60 module has a declaration, its sidecar, so \x60noEmit\x60 and \x60declaration: false\x60 change nothing here.",
		"A rewrite that can't preserve types, behavior and declaration output refuses at that site",
	} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			tb.Fatalf("sidecar preservation authority changed: %q", quote)
		}
	}
}

func TestFormSidecarPreservationQuoted(t *testing.T) { sidecarFormQuotes(t) }

// The checking project's emit options cannot authorize a change to the
// module's public sidecar. Compare declaration output before and after the
// fixer, including a paired codec that should still convert.
func FuzzFormSidecarPreservation(f *testing.F) {
	startShortBudget(f)
	sidecarFormQuotes(f)
	keys := []string{"value-only", "private-type-query", "own-helper-type", "empty-error", "aliased-schema-error", "effect-never", "paired-codec"}
	for _, key := range keys {
		for mode := uint8(0); mode < 8; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		found := false
		for _, candidate := range keys {
			found = found || key == candidate
		}
		if !found {
			key = keys[len(key)%len(keys)]
		}
		name, codec, typ := "Value", "Schema.String", "string"
		if mode&2 != 0 {
			name, codec, typ = "Count", "Schema.Number", "number"
		}
		var source string
		switch key {
		case "value-only", "own-helper-type", "paired-codec":
			source = fmt.Sprintf("export const %s = Schema.Struct({ value: %s })\n", name, codec)
			if key == "own-helper-type" {
				source += fmt.Sprintf("export type %s = Schema.Schema.Type<typeof %s>\n", name, name)
			}
			if key == "paired-codec" {
				source += fmt.Sprintf("export type %s = typeof %s.Type\n", name, name)
			}
		case "private-type-query":
			source = fmt.Sprintf("const %s = Schema.Struct({ value: %s })\nexport type PublicValue = typeof %s.Type\n", name, codec, name)
		case "empty-error":
			source = "export class Missing extends Data.TaggedError(\"Missing\")<{}> {}\n"
		case "aliased-schema-error":
			source = "import { Schema as S } from \"effect\"\nexport class Failed extends S.TaggedError<Failed>()(\"Failed\", { value: S.String }) {}\n"
		case "effect-never":
			value := "\"ok\""
			if typ == "number" {
				value = "1"
			}
			source = fmt.Sprintf("export const one = (): Effect.Effect<%s, never, never> => Effect.succeed(%s)\n", typ, value)
		}
		if mode&4 != 0 && key != "aliased-schema-error" {
			source = "export namespace Public {\n" + source + "}\n"
		}
		option := "\"noEmit\":true"
		if mode&1 != 0 {
			option = "\"declaration\":false"
		}
		config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true," + option + "},\"files\":[\"main.vibe\"]}"
		before, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if HasError(before.Diagnostics) {
			t.Fatalf("invalid generated source: %v\n%s", before.Diagnostics, source)
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		after := source
		for _, file := range fixed.Files {
			after = file.Text
		}
		oracleKey := fmt.Sprintf("%s:mode-%d", key, mode&7)
		// All programs are also emitted under declaration:true to inspect the
		// sidecar's public declaration, independently of the checking config.
		declaration := func(text string) string {
			result, err := w.Compile(t.Context(), Single(text))
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				Gap(t, sidecarFormTarget, oracleKey, "fixed declaration fails: %v\n%s", result.Diagnostics, text)
				return ""
			}
			return result.Outputs["out/main.d.ts"]
		}
		want, got := declaration(source), declaration(after)
		if want == "" || got == "" {
			t.Fatal("missing declaration output")
		}
		if want != got {
			Gap(t, sidecarFormTarget, oracleKey, "Chapter 7 preserves declaration output regardless of emit options\nwant:\n%s\ngot:\n%s\nfixed:\n%s", want, got, after)
		}
		if key == "paired-codec" && !strings.Contains(after, "schema "+name) {
			Gap(t, sidecarFormTarget, oracleKey+":positive", "the matching value/type pair should still convert: %s", after)
		}
		ExpectPending(t, sidecarFormTarget, oracleKey)
	})
}
