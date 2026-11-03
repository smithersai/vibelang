package vibelang

import (
	"strings"
	"testing"
)

func TestEffectIntoPlainGeneric(t *testing.T) {
	for _, test := range []struct {
		name, declaration, argument, typeArgs string
		want                                  int
	}{
		{"fork-keyword", "", "", "", 0},
		{"identity", "function take<T>(x: T): T { return x }", "job", "", 1},
		{"direct", "function take<T>(x: T, message?: string): number { return 1 }", "job", "", 1},
		{"second", "function take<T>(n: number, x: T): number { return n }", "1, job", "", 1},
		{"array", "function take<T>(x: T[]): number { return 1 }", "[job]", "", 1},
		{"promise", "function take<T>(x: Promise<T>): number { return 1 }", "pending", "", 1},
		{"constraint", "function take<T extends unknown>(x: T): number { return 1 }", "job", "", 1},
		{"overload", "function take<T>(x: T): number; function take(x: unknown): number { return 1 }", "job", "", 1},
		{"method", "const box = { take<T>(x: T): number { return 1 } }; const take = box.take", "job", "", 1},
		{"callback-result", "function take<T>(x: () => T): number { return 1 }", "() => job", "", 1},
		{"generic-alias", "function generic<T>(x: T): number { return 1 }; const take = generic", "job", "", 1},
		{"explicit-instantiation", "function generic<T>(x: T): number { return 1 }; const take = generic<Effect.Effect<number>>", "job", "", 0},
		{"explicit", "function take<T>(x: T): number { return 1 }", "job", "<Effect.Effect<number>>", 0},
		{"explicit-array", "function take<T>(x: T[]): number { return 1 }", "[job]", "<Effect.Effect<number>>", 0},
		{"run-nested-effect", "function take<T>(x: T): number { return 1 }", "try job", "", 0},
		{"run", "function take<T>(x: T): number { return 1 }", "try job", "", 0},
		{"plain-owner", "function take<T>(x: T): number { return 1 }", "job", "", 0},
		{"declared-program", "function take<T>(x: Effect.Effect<T>): number { return 1 }", "job", "", 0},
		{"effect-factory", "function take<T>(x: T): Effect.Effect<T> { return Effect.succeed(x) }", "job", "", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			mark := "effect "
			if test.name == "plain-owner" {
				mark = ""
			}
			source := test.declaration + "\nexport " + mark + "function probe(job: Effect.Effect<number>, pending: Promise<Effect.Effect<number>>) { const value = take" + test.typeArgs + "(" + test.argument + "); return 0 }"
			if test.name == "fork-keyword" {
				source = "export effect function probe(job: number!!) { const child = fork job; return join child }"
			}
			if test.name == "run-nested-effect" {
				source = strings.Replace(source, "job: Effect.Effect<number>", "job: Effect.Effect<Effect.Effect<number>>", 1)
			}
			program, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4802.Code {
					count++
				}
			}
			if count != test.want {
				t.Fatalf("got %d inferred-Effect diagnostics, want %d\n%s", count, test.want, source)
			}
		})
	}
}

func TestFixEffectIntoPlainGeneric(t *testing.T) {
	const before = "function expect<T>(actual: T, message?: string): boolean { return true }\neffect function awaited() { return 42 }\nexport effect function probe() { return expect(awaited()) }\n"
	const after = "function expect<T>(actual: T, message?: string): boolean { return true }\neffect function awaited() { return 42 }\nexport effect function probe() { return expect(try awaited()) }\n"
	for _, options := range []FixOptions{{}, {VIPOnly: true}} {
		result, name := fixSourceOptions(t, before, options)
		fixed := result.Files[name]
		if fixed == nil || fixed.Text != after {
			t.Fatalf("options %+v: got %+v, refused %+v; want %s", options, fixed, result.Refused, after)
		}
		again, _ := fixSourceOptions(t, after, options)
		if len(again.Files) != 0 {
			t.Fatal("second fix changed the source")
		}
	}
	// Batch --fix must leave explicit intent to the author, rather than opting
	// out of the warning on a container it cannot run directly.
	source := "function take<T>(x: Promise<T>): number { return 1 }\nexport effect function probe(p: Promise<number!!>) { return take(p) }\n"
	result, _ := fixSourceOptions(t, source, FixOptions{})
	if len(result.Files) != 0 {
		t.Fatalf("silenced ambiguous container with %+v", result.Files)
	}
}
