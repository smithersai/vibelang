package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// rule-evidence: docs/design/src/002-running.md#a504880b23f48fb9
// rule-evidence: docs/design/vips/0001-effect-and-async-functions.md#a504880b23f48fb9
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
		{"effect-constraint", "function take<T extends Effect.Effect<any, any, any>>(x: T): number { return 1 }", "job", "", 0},
		{"dual-constraint", "function take<T extends Effect.Effect<any, any, any> | { readonly n?: number } | undefined>(x?: T): [T] extends [Effect.Effect<infer A>] ? Effect.Effect<A> : number { return 1 as any }", "job", "", 0},
		{"effect-fork-scoped", "const take = Effect.forkScoped", "job", "", 0},
		{"effect-map", "const take = Effect.map", "job, (n) => n + 1", "", 0},
		{"effect-flat-map", "const take = Effect.flatMap", "job, (n) => Effect.succeed(n)", "", 0},
		{"effect-zip", "const take = Effect.zip", "job, job", "", 0},
		{"effect-all", "const take = Effect.all", "[job]", "", 0},
		{"effect-timeout", "const take = Effect.timeout", "job, 1000", "", 0},
		{"nested-effect", "function take<T>(x: Effect.Effect<T>): number { return 1 }", "nested", "", 0},
		{"effect-union", "function take<T>(x: T | Effect.Effect<T>): number { return 1 }", "job", "", 0},
		{"effect-intersection", "function take<T>(x: T & Effect.Effect<number>): number { return 1 }", "job", "", 0},
		{"effect-union-constraint", "function take<T extends object | Effect.Effect<number>>(x: T): number { return 1 }", "job", "", 0},
		{"effect-intersection-constraint", "function take<T extends object & Effect.Effect<number>>(x: T): number { return 1 }", "job", "", 0},
		{"stream", "function take<T>(x: Stream.Stream<T>): number { return 1 }", "stream", "", 0},
		{"nested-stream", "function take<T>(x: Stream.Stream<T>): number { return 1 }", "nestedStream", "", 0},
		{"nested-option", "function take<T>(x: Option.Option<T>): number { return 1 }", "option", "", 0},
		{"effect-alias", "type Cold<T> = Effect.Effect<T>; function take<T>(x: T | Cold<T>): number { return 1 }", "job", "", 0},
		{"user-stream-name", "namespace User { export interface Stream<T> { value: T } }; function take<T>(x: User.Stream<T>): number { return 1 }", "{ value: job }", "", 1},
		{"plain-union", "function take<T>(x: T | number): number { return 1 }", "job", "", 1},
		{"plain-intersection", "function take<T>(x: T & object): number { return 1 }", "job", "", 1},
		{"effect-fork-child", "const take = Effect.forkChild", "job", "", 0},
		{"effect-fork-detach", "const take = Effect.forkDetach", "job", "", 0},
		{"other-constraint", "function take<T extends { readonly n?: number } | object>(x: T): number { return 1 }", "job", "", 1},
		// A parameter or constraint whose alias names itself with a growing
		// argument has no largest instantiation; the walk still answers.
		{"branching-array-parameter", "type Tree<U> = Tree<U[]>[] | Tree<[U]>[]; declare const tree: Tree<number>; function take<T>(x: T, n: Tree<number>): number { return 1 }", "job, tree", "", 1},
		{"recursive-array-parameter", "type Nested<U> = Nested<U[]>[]; declare const chain: Nested<number>; function take<T>(x: T, n: Nested<number>): number { return 1 }", "job, chain", "", 1},
		{"recursive-array-constraint", "type Nested<U> = Nested<U[]>[]; declare const chain: Nested<number>; function take<A extends Nested<number>, T>(a: A, x: T): number { return 1 }", "chain, job", "", 1},
		{"recursive-alias-parameter", "type Next<U> = { next: Next<U[]> }; declare const chain: Next<number>; function take<T>(x: T, n: Next<number>): number { return 1 }", "job, chain", "", 1},
		{"recursive-alias-constraint", "type Next<U> = { next: Next<U[]> }; declare const chain: Next<number>; function take<A extends Next<number>, T>(a: A, x: T): number { return 1 }", "chain, job", "", 1},
		{"recursive-builder-parameter", "type Builder<A extends unknown[]> = { add<U>(u: U): Builder<[...A, U]>; done(): A }; declare const builder: Builder<[]>; function take<T>(x: T, b: Builder<[]>): number { return 1 }", "job, builder", "", 1},
		{"recursive-alias-payload", "type Next<U> = { next: Next<U[]>; value: U }; declare const jobs: Next<Effect.Effect<number>>; function take<T>(x: Next<T>): number { return 1 }", "jobs", "", 1},
		{"nested-alias-payload", "type Box<U> = { value: U }; declare const jobs: Box<Box<Box<Box<Effect.Effect<number>>>>>; function take<T>(x: Box<Box<Box<Box<T>>>>): number { return 1 }", "jobs", "", 1},
		{"nested-alias-declared-program", "type Box<U> = { value: U }; declare const jobs: Box<Box<Box<Box<Effect.Effect<number>>>>>; function take<T>(x: Box<Box<Box<Box<Effect.Effect<T>>>>>): number { return 1 }", "jobs", "", 0},
		{"recursive-alias-declared-program", "type Next<U> = { next: Next<U[]>; run: Effect.Effect<U> }; declare const jobs: Next<number>; function take<T>(x: T, n: Next<number>): number { return 1 }", "job, jobs", "", 1},
		{"effect-factory", "function take<T>(x: T): Effect.Effect<T> { return Effect.succeed(x) }", "job", "", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			mark := "effect "
			if test.name == "plain-owner" {
				mark = ""
			}
			source := test.declaration + "\nexport " + mark + "function probe(job: Effect.Effect<number>, pending: Promise<Effect.Effect<number>>, nested: Effect.Effect<Effect.Effect<number>>, stream: Stream.Stream<number>, nestedStream: Stream.Stream<Effect.Effect<number>>, option: Option.Option<Effect.Effect<number>>) { const value = take" + test.typeArgs + "(" + test.argument + "); return 0 }"
			if test.name == "fork-keyword" {
				source = "export effect function probe(job: number!!) { const child = fork job; return join child }"
			}
			if test.name == "run-nested-effect" {
				source = strings.Replace(source, "job: Effect.Effect<number>", "job: Effect.Effect<Effect.Effect<number>>", 1)
			}
			program, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == EK4802.Code {
					count++
				} else if test.want == 0 && d.Category() == diagnostics.CategoryError {
					// An accepted form compiles: an unresolved import or a
					// type error would make the row pass for another reason.
					t.Errorf("the accepted form does not compile: %s", d.String())
				}
			}
			if count != test.want {
				t.Fatalf("got %d inferred-Effect diagnostics, want %d\n%s", count, test.want, source)
			}
		})
	}
}
