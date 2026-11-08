package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const nullableTryQuote = "A statically non-Effect or possibly `undefined` operand is `EK0502`"
const nullableOptionsQuote = "These are ordinary TypeScript assignability tests, with the project's compiler options; `any` and `never` pass."
const nullableAnyCallQuote = "Calls through `any` or `Function` throw `unknown`"

func TestTryNullableOperandsQuoted(t *testing.T) {
	chapter := SpecText("002-running.md")
	for _, quote := range []string{nullableTryQuote, nullableOptionsQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 2 no longer says %q", quote)
		}
	}
	if !strings.Contains(SpecText("003-failures.md"), nullableAnyCallQuote) {
		t.Fatalf("Chapter 3 no longer says %q", nullableAnyCallQuote)
	}
}

type nullableTryShape struct {
	key, declarations, body       string
	nullable, badArgument, throws bool
}

func nullableTryShapes() []nullableTryShape {
	return []nullableTryShape{
		{"value", "declare const input: Effect.Effect<number> | undefined;", "return try input", true, false, false},
		{"optional-call", "declare const make: (() => Effect.Effect<number>) | undefined;", "return try make?.()", true, false, false},
		{"grouped-call", "declare const make: (() => Effect.Effect<number>) | undefined;", "return try (make?.())", true, false, false},
		{"optional-method", "declare const obj: { make?(): Effect.Effect<number> };", "return try obj.make?.()", true, false, false},
		{"optional-receiver", "declare const obj: { make(): Effect.Effect<number> } | undefined;", "return try obj?.make()", true, false, false},
		{"nullable-return", "declare function make(): Effect.Effect<number> | undefined;", "return try make()", true, false, false},
		{"undefined-success", "declare function make(): Effect.Effect<undefined>;", "return try make?.()", false, false, false},
		{"narrowed", "declare const make: (() => Effect.Effect<number>) | undefined;", "if (make) return try make?.(); return 0", false, false, false},
		{"asserted", "declare const make: (() => Effect.Effect<number>) | undefined;", "return try (make?.()!)", false, false, false},
		{"known-receiver", "declare const obj: { make(): Effect.Effect<number> };", "return try obj?.make()", false, false, false},
		{"known-method", "declare const obj: { make(): Effect.Effect<number> };", "return try obj.make?.()", false, false, false},
		{"narrowed-receiver", "declare const obj: { make(): Effect.Effect<number> } | undefined;", "if (obj) return try obj?.make(); return 0", false, false, false},
		{"asserted-callable", "declare const make: (() => Effect.Effect<number>) | undefined;", "return try make!?.()", false, false, false},
		{"unchecked", "declare const make: (() => any) | undefined;", "return try make?.()", false, false, false},
		{"unchecked-callee", "declare const make: any;", "return try make?.()", false, false, true},
		{"bad-argument", "declare const make: ((value: string) => Effect.Effect<number>) | undefined;", "return try make?.(0)", true, true, false},
	}
}

// The same nullable operand rejects only under strictNullChecks. Optional
// syntax on a proven-present callable and undefined success values are data
// controls; an argument error must survive the new operand diagnostic.
func FuzzTryNullableOperands(f *testing.F) {
	startShortBudget(f)
	shapes := nullableTryShapes()
	for _, shape := range shapes {
		for _, variant := range []uint8{0, 1, 2, 3} {
			f.Add(shape.key, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestTryNullableOperandsQuoted(t)
		index := slices.IndexFunc(shapes, func(shape nullableTryShape) bool { return key == shape.key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(shapes)
		}
		shape := shapes[index]
		strict := variant&1 == 0
		body := shape.body
		if variant&2 != 0 {
			body = "return try effect { " + body + " }"
		}
		source := shape.declarations + "\nexport effect function probe() { " + body + " }\n"
		var config map[string]any
		if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
			t.Fatal(err)
		}
		config["compilerOptions"].(map[string]any)["strictNullChecks"] = strict
		config["files"] = []string{"main.vibe"}
		encoded, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		var result *Result
		within(t, "compile", func() {
			result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: string(encoded)})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var codes []string
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				code := diagnosticCodeName(d.Source(), d.Code())
				if d.Source() == "" {
					code = "TS" + code // Go API native diagnostics have an empty source.
				}
				codes = append(codes, code)
			}
		}
		want := []string{}
		if shape.nullable && strict {
			want = append(want, "EK0502")
		}
		if shape.badArgument {
			want = append(want, "TS2345")
		}
		if shape.throws {
			want = append(want, "EK0403")
		}
		slices.Sort(codes)
		slices.Sort(want)
		if !slices.Equal(codes, want) {
			Gap(t, "FuzzTryNullableOperands", fmt.Sprintf("operand:%s:%d", shape.key, variant%4), "Chapter 2: %q; options: %q; chapter 3: %q; strictNullChecks=%t; want %v, got %v\n%s", nullableTryQuote, nullableOptionsQuote, nullableAnyCallQuote, strict, want, codes, source)
		}
	})
}
