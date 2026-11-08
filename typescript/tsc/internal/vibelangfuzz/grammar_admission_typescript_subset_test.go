package vibelangfuzz

import "testing"

// Appendix A inherits TypeScript wherever it names nothing of its own, and the
// lab's TypeScript subset must derive the ordinary TypeScript the compiler
// cases write: update and compound assignment operators, generic calls and
// heritage, conditional, constructor, query and import types, type
// predicates, `this` parameters, index signatures, catch patterns, do-while,
// ambient and abstract declarations, namespaces and enums, `using` as an
// identifier, an empty type parameter list on a type alias or interface,
// numbers that start with a dot, and shift operators.
func TestGrammarAdmissionTypeScriptSubset(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	valid := []string{
		"let n = 1; n--; --n;",
		"let n = 1; n ^= 2; n &&= 3; n ||= 4; n *= 2; n /= 2; n %= 2; n **= 2; n &= 1; n |= 1;",
		"function f<A = string, B extends object = {}>(a: A, b: B) { return [a, b]; }",
		"class E extends Base(\"E\")<{ id: string }> {}",
		"class C extends A implements I, J {} class D implements I {}",
		"const v = make<void>(); const w = f.g<number, string>(1);",
		"type Q = typeof a.b.c; type R = typeof import(\"x\"); type S = typeof import(\"x\").Y<number>;",
		"function isS(s: unknown): s is string { return typeof s === \"string\"; }",
		"function assertS(s: unknown): asserts s is string {} function assertT(s: unknown): asserts s {}",
		"type FT = (x: unknown) => x is string;",
		"function f(this: Window, x: number) { return x; }",
		"interface M { [key: string]: number; readonly [i: number]: string } class K { [key: string]: number; }",
		"const o = a?.[0]?.b?.(1)?.[\"c\"];",
		"try {} catch ({ code }) {} try {} catch (e: unknown) {}",
		"do { n++; } while (n < 3); do x(); while (y)",
		"declare const g: number; declare function h(): void; declare class Z {} abstract class W { abstract m(): void; } export declare const q: string; export abstract class V {}",
		"namespace N { export const a = 1; } declare namespace M { const b: number; } export namespace O.P { }",
		"enum E { A, B = 2, \"C\" = 3, } const enum F { X }",
		"type U<T> = T extends string ? 1 : T extends (infer _)[] ? 2 : 3;",
		"type V = unique symbol; const s: unique symbol = Symbol();",
		"const m = new Map<string, string>([[\"a\", \"b\"]]);",
		"type N = -1; type T = [number, -1];",
		"type RO<T> = { readonly [K in keyof T]?: T[K] }; type RW<T> = { -readonly [K in keyof T]-?: T[K] }; type KM<T> = { [K in keyof T as string]: T[K] };",
		"type RT = ReturnType<typeof f<string>>;",
		"for (using x of xs) {} for await (using y of ys) {} for (await using z of zs) {}",
		// `using` is a contextual keyword: a statement that starts with it is an
		// expression unless a BindingIdentifier follows on the same line.
		"using; using(x); using.x = 1; using = 1; using[0];",
		"using",
		"using\nx = 1;",
		"using x = f(), y = g();",
		"type T<> = 1; interface I<> {} export type U<> = string; export interface J<> extends I {}",
		".00",
		"const a = .5, b = .00, c = .5e3, d = [.1, .2];",
		"declare const x: boolean; const v = x?.5:1;",
		"0>>0",
		"const a = 1 << 2, b = 8 >> 1, c = -8 >>> 1; let d = 1; d <<= 1; d >>= 1; d >>>= 1;",
		"declare const p: number, q: number, r: number; const e = p < q << r, f = p >> q > r;",
		"class K { constructor(public readonly n: number, private m?: string) {} }",
		"const g = (): (() => string) => () => \"a\"; const h = async (): (() => string) => () => \"b\";",
		"type W = new (x: number) => Date; type X = abstract new () => object;",
		"class Y { me(): this { return this; } }",
		"const ü = 1; const café = ü;",
		"const \\u0069d = 1; const x = \\u{69}d; type T = { readonly __pro\\u0074o__: number };",
		"const f = (release: (r: number) => string) => release(1);",
	}
	invalid := []string{
		"let n = 1; --;",
		"let n = 1; n ^= ;",
		"function f<A = >() {}",
		"class E extends <T> {}",
		"class C implements {}",
		"type R = typeof import();",
		"type N = - ;",
		"type RO<T> = { readonly [K in] : T };",
		"function isS(s: unknown): is string {}",
		"interface M { [: string]: number }",
		"const o = a?.;",
		"try {} catch () {}",
		"do { } while;",
		"enum { A }",
		"namespace { }",
		"type U<T> = T extends ? 1 : 2;",
		"type W = new => Date;",
		"using = ;",
		"function f<>() {}",
		"class C<> {}",
		"type T<,> = 1;",
		"declare const x: { 0: number }; const v = x.0;",
		"const a = 1 <<;",
		"const a = << 1;",
	}
	vl := grammarParseMode{prose: true, names: true}
	derives := func(source string) (bool, bool) {
		return lab.read(lab.ts, grammarLexSource(source), grammarParseMode{}).count != 0,
			lab.read(lab.g, grammarLexSource(source), vl).count != 0
	}
	for _, source := range valid {
		if ts, vibe := derives(source); !ts || !vibe {
			t.Errorf("TypeScript subset derivation TypeScript=%v VibeLang=%v, want both: %q", ts, vibe, source)
		}
	}
	for _, source := range invalid {
		if ts, vibe := derives(source); ts || vibe {
			t.Errorf("invalid TypeScript derives TypeScript=%v VibeLang=%v: %q", ts, vibe, source)
		}
	}
	w := NewWorkspace(t)
	for _, source := range append(valid, invalid...) {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
