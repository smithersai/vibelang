package vibelangfuzz

import (
	"strings"
	"testing"
)

const declarationThrowsContractQuote = "functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias carry `@throws {never}`."
const declarationThrowsExceptionsQuote = "An effectful function carries no `@throws`. A bare function type stays a function type, and getters and setters carry none."

const declarationThrowsDocsQuote = "Preserve its source documentation; only the generated contract described above is an allowed addition in the emitted declaration."

type declarationThrowsShape struct {
	key, source string
	count       int
}

var declarationThrowsShapes = []declarationThrowsShape{
	{"foldkit-section-docs", "// SELECTORS\n\n/** Selects a value. @deprecated old */\nexport const select = (value: VALUE): VALUE => value", 1},
	{"smithers-callable-docs", "export interface Runner {\n/** Runs a task. */\ncallback: (value: VALUE) => VALUE }", 1},
	{"cross-vibe", "export const fnAlias = sharedFn; export const objAlias = sharedObj; export const CtorAlias = makeClass()", 2},
	{"foreign-values", "export const fnAlias = sharedFn; export const objAlias = sharedObj; export const CtorAlias = makeClass()", 0},
	{"function", "export function identity(x: VALUE): VALUE { return x }", 1},
	{"arrow", "export const identity = (x: VALUE): VALUE => x", 1},
	{"expression", "export const identity = function(x: VALUE): VALUE { return x }", 1},
	{"async", "export async function identity(x: VALUE): Promise<VALUE> { return x }", 1},
	{"async-arrow", "export const identity = async (x: VALUE): Promise<VALUE> => x", 1},
	{"generator", "export function* read(x: VALUE): Generator<VALUE, void, unknown> { yield x }", 1},
	{"async-generator", "export async function* read(x: VALUE) { yield x }", 1},
	{"object-method", "export const box = { read(x: VALUE): VALUE { return x } }", 1},
	{"returned-method", "export function box(x: VALUE) { return { read(): VALUE { return x } } }", 2},
	{"default-class", "export const Box = class {}", 1},
	{"default-class-method", "export const Box = class { read(x: VALUE): VALUE { return x } }", 2},
	{"default-class-return", "export function make() { return class { readonly value = undefined as unknown as VALUE } }", 2},
	{"class-expression", "export const Box = class { constructor(readonly x: VALUE) {} read(): VALUE { return this.x } }", 2},
	{"typed-arrow", "export const identity: (x: VALUE) => VALUE = x => x", 1},
	{"method", "export class Box { read(x: VALUE): VALUE { return x } }", 1},
	{"constructor", "export class Box { constructor(readonly x: VALUE) {} }", 1},
	{"interface-method", "export interface Box { read(x: VALUE): VALUE }", 1},
	{"interface-call", "export interface Box { (x: VALUE): VALUE }", 1},
	{"interface-construct", "export interface Box { new (x: VALUE): { x: VALUE } }", 1},
	{"literal-method", "export type Box = { read(x: VALUE): VALUE }", 1},
	{"literal-call", "export type Box = { (x: VALUE): VALUE }", 1},
	{"literal-construct", "export type Box = { new (x: VALUE): { x: VALUE } }", 1},
	{"nested", "export interface Box { child: { read(x: VALUE): VALUE } }", 1},
	{"overload", "export function read(x: VALUE): VALUE; export function read(x: VALUE, y: VALUE): VALUE; export function read(x: VALUE, y?: VALUE) { return x }", 2},
	{"accessors", "export class Box { get value(): VALUE { return undefined as unknown as VALUE } set value(x: VALUE) {} }", 0},
	{"bare", "export type Box = (x: VALUE) => VALUE; export interface Other { callback: (x: VALUE) => VALUE }", 2},
	{"effect-constructor", "export declare const Base: { new (): Effect.Effect<VALUE> }; export class Box extends Base { constructor() { super() } }", 0},
	{"effect-function", "export function read(): Effect.Effect<VALUE> { return undefined as unknown as Effect.Effect<VALUE> }", 0},
	{"effect-arrow", "export const read = (): Effect.Effect<VALUE> => undefined as unknown as Effect.Effect<VALUE>", 0},
	{"effect-interface", "export interface Box { read(): Effect.Effect<VALUE>; (): Stream.Stream<VALUE>; new (): Layer.Layer<never> }", 0},
	{"mixed-return", "export interface Box { read(): Effect.Effect<VALUE> | VALUE }", 1},
	{"generic-effect", "export interface Box { read<T extends Effect.Effect<VALUE>>(): T }", 0},
}

func TestDeclarationThrowsContractQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", "A rewrite that can't preserve types, behavior and declaration output refuses at that site")
	for _, quote := range []string{declarationThrowsContractQuote, declarationThrowsExceptionsQuote, declarationThrowsDocsQuote} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			t.Fatalf("Chapter 1 no longer contains %q", quote)
		}
	}
}
