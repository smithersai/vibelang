package vibelangmapper

import (
	"strings"
	"testing"
)

// D282 keeps EK9203 for actual Effect calls under a plain return contract.
func TestPlainContractEffectGreet(t *testing.T) {
	source := "import { Console } from \"effect\"; export function greet(name: string): number { Console.log(`hello, ${name}`); return name.length }"
	assertPlainContractDiagnostic(t, source, true)
}

// D282: a plain contract never fails, so a throw that can escape it is
// EK9203, in a statement, a throw expression, or a match arm, and also under a
// contextual plain type. A throw its own try catches stays inside it.
func TestPlainContractThrowHalf(t *testing.T) {
	for _, source := range []string{
		`export const half = (n: number): number => { if (n < 0) throw "negative"; return n / 2 }`,
		`export function orThrow(v: string | undefined): string { return v ?? throw "missing" }`,
		"export function pick(tag: string): number { return match (tag) { when \"a\": 1; default: throw tag; } }",
		`export const valid: () => number = () => { throw "negative" }`,
		`export function rethrows(n: number): number { try { if (n < 0) throw "negative"; return n } catch (e) { throw e } }`,
	} {
		assertPlainContractDiagnostic(t, source, true)
	}
	for _, source := range []string{
		`export function clamp(n: number): number { try { if (n > 10) throw "big"; return n } catch (e) { return 10 } }`,
		`export function inner(): number { function later(): number!string! { throw "later" }; return 1 }`,
	} {
		assertPlainContractDiagnostic(t, source, false)
	}
}

func TestPlainContractEffectArrow(t *testing.T) {
	assertPlainContractDiagnostic(t, `export const invalid = (): number => { Effect.succeed(1); return 1 }`, true)
}

func TestPlainContractEffectInferred(t *testing.T) {
	for _, source := range []string{
		`export const invalid: () => number = () => { Effect.succeed(1); return 1 }`,
		`export const invalid: { value(): number } = { value() { Effect.succeed(1); return 1 } }`,
	} {
		assertPlainContractDiagnostic(t, source, true)
	}
}

func TestPlainContractEffectOperations(t *testing.T) {
	for _, source := range []string{
		`export function invalid(): number { log("hello"); return 1 }`,
		`service Names { lookup(): Effect<string, never, never> }; export function invalid(): number { Names.lookup(); return 1 }`,
		`export function invalid(): number { if (true) throw "negative"; Effect.succeed(1); return 1 }`,
		`export class Example { invalid(): number { Effect.succeed(1); return 1 } }`,
	} {
		assertPlainContractDiagnostic(t, source, true)
	}
}

// Uncalled nested functions and synchronous calls do not run an Effect here.
func TestPlainContractEffectBoundaries(t *testing.T) {
	for _, source := range []string{
		`export function valid(): number { function later() { Effect.log("later"); return 1 }; return 1 }`,
		`export function valid(n: number): number { return Math.max(n, 1) }`,
		`export function valid(): boolean { return Effect.isEffect(1) }`,
		`export function valid(): number { const log = (s: string): number => s.length; return log("hello") }`,
	} {
		assertPlainContractDiagnostic(t, source, false)
	}
}

// D265's contextual fields store programs even inside a plain factory.
// Only the initializer call is cold; calls in its operands still run.
func TestPlainContractContextualProgramFields(t *testing.T) {
	for _, source := range []string{
		`interface Shape { read: Effect.Effect<number, never, never> }; const make = (): Shape => ({ read: Effect.sync(() => 1) })`,
		`interface Shape { read: Effect.Effect<number, never, never> }; function make(): Shape { return { read: (Effect.succeed(1)) } }`,
		`interface Shape { read: Effect.Effect<number, never, never> }; function make(): Shape { const stored: Shape = { read: Effect.succeed(1) }; return stored }`,
	} {
		assertPlainContractDiagnostic(t, source, false)
	}
	for _, source := range []string{
		`interface Shape { read: Effect.Effect<number, never, never> }; function make(): Shape { return { read: Effect.succeed(Effect.succeed(1)) } }`,
		`interface Shape { read: number }; function make(): Shape { return { read: Effect.succeed(1) } }`,
	} {
		assertPlainContractDiagnostic(t, source, true)
	}
}

func assertPlainContractDiagnostic(t *testing.T, source string, want bool) {
	t.Helper()
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		count := 0
		for _, diagnostic := range projection.Diagnostics {
			if diagnostic.Code != 2003 {
				t.Fatalf("unexpected diagnostic: %+v\n%s", diagnostic, source)
			}
			count++
			if !strings.Contains(diagnostic.Message, "plain") {
				t.Fatal(diagnostic)
			}
			if diagnostic.Start < 0 || diagnostic.Length <= 0 || diagnostic.Start+diagnostic.Length > len(source) {
				t.Fatal(diagnostic)
			}
		}
		if (count > 0) != want || count > 1 {
			t.Fatalf("diagnostics=%v, want EK9203=%v\n%s", projection.Diagnostics, want, source)
		}
	}
}

// D147 applies to plain callees too: their program arguments run later.
func TestPlainContractByNameEffects(t *testing.T) {
	for _, source := range []string{
		`import { Effect, Stream } from "effect"; export function valid(): Stream.Stream<number> { return Stream.fromEffect(Effect.succeed(1)) }`,
		`import { Effect, Stream } from "effect"; export const valid = (): Stream.Stream<number> => Stream.fromEffect(Effect.succeed(1))`,
		`import { Effect, Stream } from "effect"; type Factory = () => Stream.Stream<number>; export const valid: Factory = () => Stream.fromEffect(Effect.succeed(1))`,
		`import { Effect, Layer } from "effect"; declare const Tag: any; export const valid = (): Layer.Layer<any> => Layer.effect(Tag, Effect.flatMap(Effect.succeed(1), (n) => Effect.succeed(n)))`,
	} {
		assertPlainContractDiagnostic(t, source, false)
	}
	assertPlainContractDiagnostic(t, `import { Effect, Stream } from "effect"; export function invalid(): Stream.Stream<number> { const stream = Stream.fromEffect(Effect.succeed(1)); Effect.succeed(2); return stream }`, true)
}

// D296: a generator with a JavaScript iterator annotation never fails, so a
// throw that can escape it is EK9203 in both renderings; one its own catch
// handles, and one in a nested function, are not.
func TestPlainGeneratorThrows(t *testing.T) {
	for _, test := range []struct {
		source string
		want   bool
	}{
		{"export function* steps(v: string): Generator<string> { if (v === \"\") throw v; yield v }", true},
		{"export async function* later(v: string): AsyncGenerator<string> { yield v; throw v }", true},
		{"export function* kept(): Iterator<string> { try { throw \"x\" } catch (e) { yield \"caught\" } }", false},
		{"export function* nested(): Iterable<number> { const f = (): number!string! => { throw \"x\" }; yield 1 }", false},
		{"export function* producer(v: string) { if (v === \"\") throw v; yield v }", false},
	} {
		for _, projection := range []Projection{Project(test.source, testContext), Executable(test.source, testContext)} {
			count := 0
			for _, d := range projection.Diagnostics {
				if d.Code == 2003 && strings.Contains(d.Message, "A JavaScript generator can't throw") {
					count++
				}
			}
			if (count == 1) != test.want || count > 1 {
				t.Fatalf("D296 diagnostics=%v, want %v\n%s", projection.Diagnostics, test.want, test.source)
			}
		}
	}
}
