package vibelangfuzz

import (
	"encoding/json"
	"slices"
	"testing"
)

const catchNullableOperandQuote = "\x60e catch h\x60 where \x60e\x60 is not an Effect"
const catchNullableOptionsQuote = "These are ordinary TypeScript assignability tests, with the project's compiler options; \x60any\x60 and \x60never\x60 pass."
const catchNullableNativeQuote = "including independent errors in embedded expressions and types."

func TestCatchNullableDiagnosticsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", catchNullableOperandQuote)
	chapterSays(t, "002-running.md", catchNullableOptionsQuote)
	chapterSays(t, "007-tooling.md", catchNullableNativeQuote)
}

type catchNullableDiagnosticShape struct {
	key, decl, left, handler string
	nullable                 bool
	native                   string
}

func FuzzCatchNullableDiagnostics(f *testing.F) {
	startShortBudget(f)
	shapes := []catchNullableDiagnosticShape{
		{"undefined", "declare const p: Effect.Effect<number>|undefined;", "p", "()=>0", true, ""},
		{"null", "declare const p: Effect.Effect<number>|null;", "p", "()=>0", true, ""},
		{"both", "declare const p: Effect.Effect<number>|null|undefined;", "p", "()=>0", true, ""},
		{"property", "declare const box: {p?:Effect.Effect<number>};", "box.p", "()=>0", true, ""},
		{"element", "declare const box: Record<string,Effect.Effect<number>|undefined>;", "box[\"p\"]", "()=>0", true, ""},
		{"call", "declare function p():Effect.Effect<number>|undefined;", "p()", "()=>0", true, ""},
		{"optional-call", "declare const p:(()=>Effect.Effect<number>)|undefined;", "p?.()", "()=>0", true, ""},
		{"assertion", "declare const p:unknown;", "(p as Effect.Effect<number>|undefined)", "()=>0", true, ""},
		{"satisfies", "declare const p:Effect.Effect<number>|undefined;", "p satisfies Effect.Effect<number>|undefined", "()=>0", true, ""},
		{"handler", "declare const p:Effect.Effect<number>|undefined;", "p", "()=>{const n:number=\"bad\";return n}", true, "TS2322"},
		{"argument-property", "declare function p(x:{value:number}):Effect.Effect<number>|undefined;", "p({value:\"bad\"})", "()=>0", true, "TS2322"},
		{"argument", "declare function p(x:number):Effect.Effect<number>|undefined;", "p(\"bad\")", "()=>0", true, "TS2345"},
		{"satisfaction-error", "declare const p:Effect.Effect<number>|undefined;", "p satisfies string", "()=>0", true, "TS1360"},
		{"nonnull", "declare const p:Effect.Effect<number>|undefined;", "p!", "()=>0", false, ""},
		{"undefined-success", "declare const p:Effect.Effect<undefined>;", "p", "()=>0", false, ""},
		{"unchecked", "declare const p:any;", "p", "()=>0", false, ""},
		{"never", "declare const p:never;", "p", "()=>0", false, ""},
	}
	for _, shape := range shapes {
		for flags := uint8(0); flags < 8; flags++ {
			f.Add(shape.key, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestCatchNullableDiagnosticsQuoted(t)
		index := slices.IndexFunc(shapes, func(s catchNullableDiagnosticShape) bool { return s.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(shapes)
		}
		shape := shapes[index]
		strict := flags&1 == 0
		left := shape.left
		if flags&2 != 0 {
			left = "(" + left + ")"
		}
		body := "return " + left + " catch " + shape.handler
		if flags&4 != 0 {
			body = "return try effect { " + body + " }"
		}
		source := shape.decl + "\nexport effect function main(){ " + body + " }"
		var config map[string]any
		if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
			t.Fatal(err)
		}
		config["compilerOptions"].(map[string]any)["strictNullChecks"] = strict
		config["files"] = []string{"main.vibe"}
		raw, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		project := Single(source)
		project.Config = string(raw)
		result, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := r3Errors(result.Diagnostics)
		var want []string
		if strict && shape.nullable {
			want = append(want, "EK0506")
		}
		if shape.native != "" {
			want = append(want, shape.native)
		}
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzCatchNullableDiagnostics", "operand:"+shape.key, "chapter 2 says %q and %q; chapter 7 says %q; strict=%v: want %v got %v\n%s", catchNullableOperandQuote, catchNullableOptionsQuote, catchNullableNativeQuote, strict, want, got, source)
		}
	})
}
