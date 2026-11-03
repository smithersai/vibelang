package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const declarationThrowsContractQuote = "functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias carry `@throws {never}`."
const declarationThrowsExceptionsQuote = "An effectful function carries no `@throws`. A bare function type stays a function type, and getters and setters carry none."

type declarationThrowsShape struct {
	key, source string
	count       int
}

var declarationThrowsShapes = []declarationThrowsShape{
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
	{"bare", "export type Box = (x: VALUE) => VALUE; export interface Other { callback: (x: VALUE) => VALUE }", 0},
	{"effect-constructor", "export declare const Base: { new (): Effect.Effect<VALUE> }; export class Box extends Base { constructor() { super() } }", 0},
	{"effect-function", "export function read(): Effect.Effect<VALUE> { return undefined as unknown as Effect.Effect<VALUE> }", 0},
	{"effect-arrow", "export const read = (): Effect.Effect<VALUE> => undefined as unknown as Effect.Effect<VALUE>", 0},
	{"effect-interface", "export interface Box { read(): Effect.Effect<VALUE>; (): Stream.Stream<VALUE>; new (): Layer.Layer<never> }", 0},
	{"mixed-return", "export interface Box { read(): Effect.Effect<VALUE> | VALUE }", 1},
	{"generic-effect", "export interface Box { read<T extends Effect.Effect<VALUE>>(): T }", 0},
}

func TestDeclarationThrowsContractQuoted(t *testing.T) {
	for _, quote := range []string{declarationThrowsContractQuote, declarationThrowsExceptionsQuote} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			t.Fatalf("Chapter 1 no longer contains %q", quote)
		}
	}
}

// Chapter 1 requires the constant boundary on every local non-effectful
// signature. Mutate value types, documentation, source suffix and nesting;
// count exact signature-local tags, including the explicit exceptions.
func FuzzDeclarationThrowsContract(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, shape := range declarationThrowsShapes {
		f.Add([]byte(shape.key + "|"))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		t.Parallel()
		key, tail, found := strings.Cut(string(data), "|")
		if !found {
			key = declarationThrowsShapes[contractDeclarationByte(data, 0)%byte(len(declarationThrowsShapes))].key
			tail = string(data)
		}
		var shape *declarationThrowsShape
		for i := range declarationThrowsShapes {
			if declarationThrowsShapes[i].key == key {
				shape = &declarationThrowsShapes[i]
				break
			}
		}
		if shape == nil {
			return
		}
		mutation := []byte(tail)
		types := []string{"number", "string", "{ readonly value: number }"}
		source := strings.ReplaceAll(shape.source, "VALUE", types[contractDeclarationByte(mutation, 0)%3])
		if contractDeclarationByte(mutation, 1)%2 != 0 {
			source = "export namespace Nested { " + source + " }"
		}
		source = "/** Keep this documentation. */\n" + source
		source = "import { Effect, Stream, Layer } from \"effect\"\n" + source
		filename := "main.vibe"
		if contractDeclarationByte(mutation, 2)%2 != 0 {
			filename = "main.vibex"
		}
		files := map[string]string{filename: source, "package.json": `{"type":"module"}`}
		if key == "cross-vibe" || key == "foreign-values" {
			helper, specifier := "helper.vibe", "./helper.vibe"
			prefix := ""
			if key == "foreign-values" {
				helper, specifier = "helper.ts", "./helper.js"
				prefix = "/** @throws {never} */\n"
			}
			files[filename] = fmt.Sprintf("import { sharedFn, sharedObj, makeClass } from %q\n", specifier) + source
			files[helper] = strings.ReplaceAll("export const sharedFn = (x: VALUE): VALUE => x;\nexport const sharedObj = { read(x: VALUE): VALUE { return x } };\n"+prefix+"export function makeClass() { return class {} }", "VALUE", types[contractDeclarationByte(mutation, 0)%3])
		}
		result, err := w.Compile(t.Context(), Project{Files: files, Config: fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"types":[],"skipLibCheck":true,"jsx":"preserve","declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":[%q]}`, filename)})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("%s: %v\n%s", key, d, source)
			}
		}
		output := ""
		for path, text := range result.Outputs {
			if strings.HasSuffix(path, "/main.d.ts") {
				output = text
				break
			}
		}
		if output == "" {
			t.Fatal("missing declaration")
		}
		if got := strings.Count(output, "@throws {never}"); got != shape.count {
			Gap(t, "FuzzDeclarationThrowsContract", "shape:"+key, "Chapter 1: %s; %s\nwant %d signature tags, got %d\n%s", declarationThrowsContractQuote, declarationThrowsExceptionsQuote, shape.count, got, output)
		}
		ExpectPending(t, "FuzzDeclarationThrowsContract", "shape:"+key)
		if !strings.Contains(output, "Keep this documentation.") {
			t.Fatalf("lost source documentation:\n%s", output)
		}
	})
}
