package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

func TestTryOperationOperandDiagnosticsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "The four concurrent array operations require assignability")
	chapterSays(t, "007-tooling.md", "including independent errors in embedded expressions and types.")
}

func FuzzTryOperationOperandDiagnostics(f *testing.F) {
	startShortBudget(f)
	shapes := []struct {
		key, decl, operand, native string
		valid                      bool
	}{
		{"argument", "declare function take(n:number):ReadonlyArray<Effect.Effect<number>>|undefined;", "take(\"bad\")", "TS2345", false},
		{"nested", "declare function inner(n:number):number;declare function take(n:number):ReadonlyArray<Effect.Effect<number>>|undefined;", "take(inner(\"bad\"))", "TS2345", false},
		{"property", "declare function take(n:{value:number}):ReadonlyArray<Effect.Effect<number>>|undefined;", "take({value:\"bad\"})", "TS2322", false},
		{"constraint", "declare function take<T extends number>(n:T):ReadonlyArray<Effect.Effect<number>>|undefined;", "take<string>(\"bad\")", "TS2344", false},
		{"satisfaction", "declare function take(n:number):ReadonlyArray<Effect.Effect<number>>|undefined;", "(take(1) satisfies string)", "TS1360", false},
		{"literal", "", "[1]", "", false},
		{"literal-argument", "declare function take(n:number):number;", "[take(\"bad\")]", "TS2345", false},
		{"literal-body", "", "[(()=>{const n:number=\"bad\";return n})()]", "TS2322", false},
		{"assignment", "let target:number;", "(target=\"bad\")", "TS2322", false},
		{"valid", "declare function take(n:number):ReadonlyArray<Effect.Effect<number>>;", "take(\"bad\")", "TS2345", true},
		{"reject", "declare const input:ReadonlyArray<Effect.Effect<number>>|undefined;", "input", "", false},
	}
	for _, op := range []string{"all", "race", "any", "allSettled"} {
		for _, shape := range shapes {
			for flags := uint8(0); flags < 3; flags++ {
				f.Add(op+":"+shape.key, flags)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestTryOperationOperandDiagnosticsQuoted(t)
		op, shapeKey, _ := strings.Cut(key, ":")
		operations := []string{"all", "race", "any", "allSettled"}
		if !slices.Contains(operations, op) {
			if key == "" {
				return
			}
			op = operations[int(key[0])%len(operations)]
		}
		index := 0
		for i, shape := range shapes {
			if shape.key == shapeKey {
				index = i
				break
			}
		}
		shape := shapes[index]
		operand := shape.operand
		switch flags % 3 {
		case 1:
			operand = "(" + operand + ")"
		case 2:
			operand = "(" + operand + " satisfies unknown)"
		}
		source := shape.decl + "\nexport effect function main(){return try." + op + " " + operand + "}"
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := r3Errors(result.Diagnostics)
		var want []string
		if !shape.valid {
			want = append(want, "EK1801")
		}
		if shape.native != "" {
			want = append(want, shape.native)
		}
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzTryOperationOperandDiagnostics", op+":"+shape.key, "chapter 2 owns EK1801; chapter 7 retains independent native errors: want %v got %v\n%s", want, got, source)
		}
	})
}
