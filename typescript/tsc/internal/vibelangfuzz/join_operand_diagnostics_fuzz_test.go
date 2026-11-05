package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

func TestJoinOperandDiagnosticsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "a \x60join\x60 operand not assignable to \x60Fiber.Fiber<any, any>\x60")
	chapterSays(t, "007-tooling.md", "including independent errors in embedded expressions and types.")
}

func FuzzJoinOperandDiagnostics(f *testing.F) {
	startShortBudget(f)
	shapes := []struct {
		key, decl, operand, native string
		valid                      bool
	}{
		{"argument", "declare function take(n:number):Fiber.Fiber<number>|undefined;", "take(\"bad\")", "TS2345", false},
		{"nested", "declare function inner(n:number):number;declare function take(n:number):Fiber.Fiber<number>|undefined;", "take(inner(\"bad\"))", "TS2345", false},
		{"property", "declare function take(n:{value:number}):Fiber.Fiber<number>|undefined;", "take({value:\"bad\"})", "TS2322", false},
		{"constraint", "declare function take<T extends number>(n:T):Fiber.Fiber<number>|undefined;", "take<string>(\"bad\")", "TS2344", false},
		{"satisfaction", "declare function take(n:number):Fiber.Fiber<number>|undefined;", "(take(1) satisfies string)", "TS1360", false},
		{"literal", "", "[1]", "", false},
		{"literal-argument", "declare function take(n:number):number;", "[take(\"bad\")]", "TS2345", false},
		{"literal-body", "", "[(()=>{const n:number=\"bad\";return n})()]", "TS2322", false},
		{"assignment", "let target:number;", "(target=\"bad\")", "TS2322", false},
		{"valid", "declare function take(n:number):Fiber.Fiber<number>;", "take(\"bad\")", "TS2345", true},
		{"reject", "declare const input:Fiber.Fiber<number>|undefined;", "input", "", false},
	}
	for _, op := range []string{"join"} {
		for _, shape := range shapes {
			for flags := uint8(0); flags < 3; flags++ {
				f.Add(op+":"+shape.key, flags)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestJoinOperandDiagnosticsQuoted(t)
		op, shapeKey, _ := strings.Cut(key, ":")
		operations := []string{"join"}
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
		source := shape.decl + "\nexport effect function main(){return " + op + " " + operand + "}"
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := r3Errors(result.Diagnostics)
		var want []string
		if !shape.valid {
			want = append(want, "EK1704")
		}
		if shape.native != "" {
			want = append(want, shape.native)
		}
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzJoinOperandDiagnostics", op+":"+shape.key, "chapter 2 owns EK1704; chapter 7 retains independent native errors: want %v got %v\n%s", want, got, source)
		}
	})
}
