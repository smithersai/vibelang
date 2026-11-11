package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Decided detail 183: a service whose resolved member contracts depend on a
// type parameter of an enclosing scope is EK3005; member-local generics and
// concrete services inside generic functions are allowed.
func TestServiceOuterTypeParameters(t *testing.T) {
	const key = "static readonly key = \"outer/S\"; "
	for _, test := range []struct {
		name, source, captured string
	}{
		{"property", "export function f<T>(): number { service S { " + key + "value: T }; return 1 }", "T"},
		{"alias", "export function f<T>(): number { type Box = { value: T }; service S { " + key + "box: Box }; return 1 }", "T"},
		{"parameter", "export function f<T>(): number { service S { " + key + "take(value: T): number }; return 1 }", "T"},
		{"constraint", "export function f<T>(): number { service S { " + key + "pick<U extends T>(u: U): U }; return 1 }", "T"},
		{"effect contract", "export function f<T>(): number { service S { " + key + "load(): T!! }; return 1 }", "T"},
		{"array of outer", "export function f<T>(): number { service S { " + key + "all: ReadonlyArray<T> }; return 1 }", "T"},
		{"union", "export function f<T>(): number { service S { " + key + "maybe: T | undefined }; return 1 }", "T"},
		{"conditional true branch", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; take<U>(): U extends string ? T : number }; return 1 }", "T"},
		{"conditional false branch", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; take<U>(): U extends string ? number : T }; return 1 }", "T"},
		{"callable conditional branch", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; take: <U>() => U extends string ? T : number }; return 1 }", "T"},
		{"aliased conditional branch", "type Branch<A,B> = B extends string ? A : number; export function f<T>(): number { service S { static readonly key = \"outer/S\"; take<U>(): Branch<T,U> }; return 1 }", "T"},
		{"nested conditional branch", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; take<U,V>(): U extends string ? number : V extends number ? T : boolean }; return 1 }", "T"},
		{"member-only conditional", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; take<U>(): U extends string ? U : number }; return 1 }", ""},
		{"unused outer conditional argument", "type Branch<A,B> = B extends string ? B : number; export function f<T>(): number { service S { static readonly key = \"outer/S\"; take<U>(): Branch<T,U> }; return 1 }", ""},
		{"erased conditional branch", "type Ignore<A> = number; export function f<T>(): number { service S { static readonly key = \"outer/S\"; take<U>(): U extends string ? Ignore<T> : number }; return 1 }", ""},
		{"recursive conditional member", "type Flatten<A> = A extends ReadonlyArray<infer B> ? Flatten<B> : A; export function f<T>(): number { service S { static readonly key = \"outer/S\"; take<U>(): Flatten<U> }; return 1 }", ""},
		{"recursive conditional object", "type Flatten<A> = A extends ReadonlyArray<infer B> ? { next: Flatten<B> } : { value: A }; export function f<T>(): number { service S { static readonly key = \"outer/S\"; take<U>(): Flatten<U> }; return 1 }", ""},
		{"method generic parameter", "export function f<T>(): number { service S { " + key + "map<U>(u: U): U }; return 1 }", ""},
		{"concrete in generic function", "export function f<T>(value: T): number { service S { " + key + "n: number; name(): string!! }; return 1 }", ""},
		{"generic callable alias", "type Identity = <U>(value: U) => U; export function f<T>(): number { service S { " + key + "identity: Identity }; return 1 }", ""},
		{"nested generic callable", "export function f<T>(): number { service S { " + key + "identity: <U>(value: U) => U }; return 1 }", ""},
		{"defaulted generic capture", "export function f<T>(): number { type Box<U = T> = { value: U }; service S { " + key + "box: Box }; return 1 }", "T"},
		{"member default capture", "export function f<T>(): number { service S { " + key + "pick<U = T>(u: U): U }; return 1 }", "T"},
		{"deep nested capture", "export function f<T>(): number { service S { " + key + "value: " + strings.Repeat("{ next: ", 16) + "T" + strings.Repeat(" }", 16) + " }; return 1 }", "T"},
		{"written thrown contract", "export function f<T>(): number { service S { " + key + "\n/** @throws {T} */\nload(): number }; return 1 }", "T"},
		{"aliased thrown contract", "export function f<T>(): number { type Callback = {\n/** @throws {T} */\n(): number\n}; service S { " + key + "load: Callback }; return 1 }", "T"},
		{"mapped keys and values", "export function f<T extends object>(): number { service S { static readonly key = \"outer/S\"; value: { [K in keyof T]: T[K] } }; return 1 }", "T"},
		{"mapped keys only", "export function f<T extends object>(): number { service S { static readonly key = \"outer/S\"; value: { [K in keyof T]?: number } }; return 1 }", "T"},
		{"mapped remap", "export function f<T extends string>(): number { service S { static readonly key = \"outer/S\"; value: { [K in 'fixed' as T]: number } }; return 1 }", "T"},
		{"template interpolation", "export function f<T extends string>(): number { service S { static readonly key = \"outer/S\"; value: `prefix-${T}` }; return 1 }", "T"},
		{"string mapping", "export function f<T extends string>(): number { service S { static readonly key = \"outer/S\"; value: Uppercase<T> }; return 1 }", "T"},
		{"concrete mapped control", "export function f<T extends object>(): number { service S { static readonly key = \"outer/S\"; value: { [K in 'fixed']?: number } }; return 1 }", ""},
		{"concrete template control", "export function f<T extends string>(): number { service S { static readonly key = \"outer/S\"; value: `prefix-${number}` }; return 1 }", ""},
		{"resolved unused alias argument", "type Ignore<U> = number; interface Phantom<U> { n: Ignore<U> }; export function f<T>(): number { service S { " + key + "value: Phantom<T> }; return 1 }", ""},
		{"recursive phantom interface", "interface Phantom<U> { next: Phantom<U[]>; n: number }; export function f<T>(): number { service S { " + key + "value: Phantom<T> }; return 1 }", ""},
		{"interface method thrown argument", "interface Box<U> {\n/** @throws {U} */\nload(): number\n}; export function f<T>(): number { service S { " + key + "value: Box<T> }; return 1 }", "T"},
		{"generic interface thrown constraint", "interface Box<U> {\n/** @throws {R} */\n<R extends U>(): number\n}; export function f<T>(): number { service S { " + key + "value: Box<T> }; return 1 }", "T"},
		{"nested anonymous thrown argument", "interface Box<U> { nested: {\n/** @throws {U} */\nload(): number\n} }; export function f<T>(): number { service S { " + key + "value: Box<T> }; return 1 }", "T"},
		{"two nested metadata instantiations", "interface Box<U> { nested: {\n/** @throws {U} */\nload(): number\n} }; export function f<T>(): number { service S { " + key + "value: { fixed: Box<string>; captured: Box<T> } }; return 1 }", "T"},
		{"two metadata instantiations", "interface Box<U> {\n/** @throws {U} */\nload(): number\n}; export function f<T>(): number { service S { " + key + "value: { fixed: Box<string>; captured: Box<T> } }; return 1 }", "T"},
		{"nested interface thrown argument", "type Callback<U> = {\n/** @throws {U} */\n(): number\n}; interface Box<U> { load: Callback<U> }; export function f<T>(): number { service S { " + key + "value: Box<T> }; return 1 }", "T"},
		{"phantom interface control", "interface Phantom<U> { (): number }; export function f<T>(): number { service S { " + key + "load: Phantom<T> }; return 1 }", ""},
		{"phantom inferred class method", "class Phantom<U> { n() { return 1 } }; export function f<T>(): number { service S { " + key + "value: Phantom<T> }; return 1 }", ""},
		{"local phantom concrete control", "export function f<T>(x: T): number { interface Phantom<U> { value: number }; service S { " + key + "value: Phantom<string> }; return 1 }", ""},
		{"shadowed interface parameter", "interface Phantom<U> { identity<U>(value: U): U }; export function f<T>(): number { service S { " + key + "value: Phantom<T> }; return 1 }", ""},
		{"phantom class control", "class Phantom<U> { n: number = 1 }; export function f<T>(): number { service S { " + key + "value: Phantom<T> }; return 1 }", ""},
		{"used interface argument", "interface Box<U> { value: U }; export function f<T>(): number { service S { " + key + "value: Box<T> }; return 1 }", "T"},
		{"interface thrown argument", "interface Callback<U> {\n/** @throws {U} */\n(): number\n}; export function f<T>(): number { service S { " + key + "load: Callback<T> }; return 1 }", "T"},
		{"module level concrete library contracts", "export service S { " + key + "all: ReadonlyArray<{ n: number }>; load(): { n: number }!! }", ""},
		{"generic concrete array contract", "export function f<T>(): number { service S { " + key + "all: ReadonlyArray<{ n: number }> }; return 1 }", ""},
		{"member generic Effect contract", "export function f<T>(): number { service S { " + key + "load<U>(value: U): U!! }; return 1 }", ""},
		{"local interface written metadata", "export function f<T>(): number { interface Box {\n/** @throws {T} */\nload(): number\n}; service S { " + key + "value: Box }; return 1 }", "T"},
		{"constructor concrete control", "export class Host { constructor() { service S { " + key + "n: number } } }", ""},
		{"generic constructor capture", "export class Host<T> { constructor() { service S { " + key + "value: T } } }", "T"},
		{"generic getter capture", "export class Host<T> { get value(): number { service S { " + key + "value: T }; return 1 } }", "T"},
		// An alias of an object type that names itself with a growing argument
		// has no largest instantiation: the walk must not follow it forever.
		{"branching recursive array then capture", "type Tree<U> = Tree<U[]>[] | Tree<[U]>[]; type Value<U> = { tree: Tree<number>; value: U }; export function f<T>(): number { service S { " + key + "value: Value<T> }; return 1 }", "T"},
		{"branching recursive array alias", "type Tree<U> = Tree<U[]>[] | Tree<[U]>[]; export function f<T>(): number { service S { " + key + "value: Tree<number> }; return 1 }", ""},
		{"recursive array alias", "type Nested<U> = Nested<U[]>[]; export function f<T>(): number { service S { " + key + "value: Nested<number> }; return 1 }", ""},
		{"recursive array phantom", "type Nested<U> = Nested<U[]>[]; export function f<T>(): number { service S { " + key + "value: Nested<T> }; return 1 }", ""},
		{"recursive array capture", "type Nested<U> = U | Nested<U[]>[]; export function f<T>(): number { service S { " + key + "value: Nested<T> }; return 1 }", "T"},
		{"deep array capture", "export function f<T>(): number { service S { " + key + "value: " + strings.Repeat("Array<", 300) + "T" + strings.Repeat(">", 300) + " }; return 1 }", "T"},
		{"recursive alias builder", "type Builder<A extends unknown[]> = { add<U>(u: U): Builder<[...A, U]>; done(): A }; export function f<T>(x: T): number { service S { " + key + "make(): Builder<[]> }; return 1 }", ""},
		{"recursive alias growing argument", "type Next<U> = { next: Next<U[]> }; export function f<T>(): number { service S { " + key + "value: Next<number> }; return 1 }", ""},
		{"recursive alias phantom argument", "type Next<U> = { next: Next<U[]>; n: number }; export function f<T>(): number { service S { " + key + "value: Next<T> }; return 1 }", ""},
		{"recursive alias used argument", "type Next<U> = { next: Next<U[]>; value: U }; export function f<T>(): number { service S { " + key + "value: Next<T> }; return 1 }", "T"},
		{"recursive alias builder capture", "type Builder<A extends unknown[]> = { add<U>(u: U): Builder<[...A, U]>; done(): A }; export function f<T>(x: T): number { service S { " + key + "make(): Builder<[T]> }; return 1 }", "T"},
		{"local recursive alias control", "export function f<T>(): number { type Next<U> = { next: Next<U[]>; value: U }; service S { " + key + "value: Next<number> }; return 1 }", ""},
		{"local recursive alias later capture", "export function f<T>(): number { type Grow<U> = { next: Grow<[U, T]>; value: U }; service S { " + key + "value: Grow<[]> }; return 1 }", "T"},
		{"recursive function alias", "type Chain<A> = (value: A) => Chain<A[]>; export function f<T>(): number { service S { " + key + "run: Chain<number> }; return 1 }", ""},
		{"recursive function alias capture", "type Chain<A> = (value: A) => Chain<A[]>; export function f<T>(): number { service S { " + key + "run: Chain<T> }; return 1 }", "T"},
		{"recursive mapped alias", "type Deep<A> = { [K in 'next']: Deep<A[]> }; export function f<T>(): number { service S { " + key + "value: Deep<number> }; return 1 }", ""},
		{"recursive conditional growth", "type Grow<A> = A extends string ? number : { next: Grow<A[]> }; export function f<T>(): number { service S { " + key + "value: Grow<number>; take<U>(): Grow<U> }; return 1 }", ""},
		{"recursive conditional growth capture", "type Grow<A> = A extends string ? number : { next: Grow<A[]>; value: A }; export function f<T>(): number { service S { " + key + "value: Grow<T[]> }; return 1 }", "T"},
		{"nested alias instantiation capture", "type Box<U> = { value: U }; export function f<T>(): number { service S { " + key + "value: Box<Box<Box<T>>> }; return 1 }", "T"},
		{"nested alias instantiation control", "type Box<U> = { value: U }; export function f<T>(): number { service S { " + key + "value: Box<Box<Box<number>>> }; return 1 }", ""},
		{"nested alias phantom then used", "type Pair<A, B> = { value: A }; export function f<T>(): number { service S { " + key + "value: Pair<Pair<number, T>, number>; other: Pair<Pair<T, number>, T> }; return 1 }", "T"},
		{"module level", "export service S { " + key + "map<U>(u: U): ReadonlyArray<U> }", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			var codes []int32
			var text string
			// a4185773d9f1 made every @throws tag in a .vibe file EK0406
			// (VIP-4: VibeLang functions never throw). Each tag here is a
			// written contract the service check still reads, so count one
			// EK0406 per tag and check the rest.
			tags := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == EK0406.Code {
					tags++
					continue
				}
				codes = append(codes, d.Code())
				if d.Code() == EK3005.Code {
					text = d.MessageText()
				}
			}
			if want := strings.Count(test.source, "@throws"); tags != want {
				t.Fatalf("want %d EK0406 for the @throws tags, got %d", want, tags)
			}
			if test.captured == "" {
				if len(codes) != 0 {
					t.Fatalf("want no errors, got %v: %v", codes, program.GetSemanticDiagnostics(t.Context(), file))
				}
				return
			}
			if len(codes) != 1 || codes[0] != EK3005.Code {
				t.Fatalf("want one EK3005, got %v: %v", codes, program.GetSemanticDiagnostics(t.Context(), file))
			}
			if !strings.Contains(text, test.captured) {
				t.Fatalf("EK3005 text %q does not name %s", text, test.captured)
			}
		})
	}
}
