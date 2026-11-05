package vibelangfuzz

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestForTryNullableDiagnosticsQuoted(t *testing.T) {
	forTryOperandsChapter(t)
	chapterSays(t, "007-tooling.md", "including independent errors in embedded expressions and types.")
}

func FuzzForTryNullableDiagnostics(f *testing.F) {
	startShortBudget(f)
	shapes := []struct {
		key, decl, operand, body, native, strictNative string
		nullable                                       bool
	}{
		{"undefined", "declare const p:Stream.Stream<number>|undefined;", "p", "void value", "", "", true},
		{"null", "declare const p:Stream.Stream<number>|null;", "p", "void value", "", "", true},
		{"both", "declare const p:Stream.Stream<number>|null|undefined;", "p", "void value", "", "", true},
		{"satisfies", "declare const p:Stream.Stream<number>|undefined;", "(p satisfies Stream.Stream<number>|undefined)", "void value", "", "", true},
		{"optional-call", "declare const p:(()=>Stream.Stream<number>)|undefined;", "p?.()", "void value", "", "", true},
		{"body", "declare const p:Stream.Stream<number>|undefined;", "p", "const n:number=\"bad\";void n", "TS2322", "", true},
		{"argument", "declare function p(n:number):Stream.Stream<number>|undefined;", "p(\"bad\")", "void value", "TS2345", "", true},
		{"property-argument", "declare function p(n:{value:number}):Stream.Stream<number>|undefined;", "p({value:\"bad\"})", "void value", "TS2322", "", true},
		{"receiver-and-stream", "declare const obj:{stream?:Stream.Stream<number>}|undefined;", "obj.stream", "void value", "", "TS18048", true},
		{"receiver-only", "declare const obj:{stream:Stream.Stream<number>}|undefined;", "obj.stream", "void value", "", "TS18048", false},
		{"nonnull", "declare const p:Stream.Stream<number>|undefined;", "p!", "void value", "", "", false},
	}
	for _, shape := range shapes {
		for flags := uint8(0); flags < 8; flags++ {
			f.Add(shape.key, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestForTryNullableDiagnosticsQuoted(t)
		index := 0
		for i, shape := range shapes {
			if shape.key == key {
				index = i
				break
			}
		}
		shape := shapes[index]
		operand := shape.operand
		if flags&1 != 0 {
			operand = "(" + operand + ")"
		}
		strict := flags&2 == 0
		body := "for try(const value of " + operand + "){" + shape.body + "};return 0"
		if flags&4 != 0 {
			body = "uninterruptible{" + body + "}"
		}
		source := shape.decl + "\nexport effect function main(){" + body + "}"
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
			want = append(want, "EK2004")
		}
		if shape.native != "" {
			want = append(want, shape.native)
		}
		if strict && shape.strictNative != "" {
			want = append(want, shape.strictNative)
		}
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzForTryNullableDiagnostics", shape.key, "chapter 2 owns the Stream operand rejection; chapter 7 preserves independent native diagnostics; strict=%v: want %v got %v\n%s", strict, want, got, source)
		}
	})
}
