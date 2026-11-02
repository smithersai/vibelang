package vibelangfuzz

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Each quote is read from chapter 5 (Services, "Static rules") at test time. A
// valid control must compile before a forbidden form can prove that the
// compiler rejects it with the code its table row assigns. The neighbourhood
// of the service-member reports: a service is a key whose members are
// signatures, as in an interface.
var servicesRules = []struct{ key, quote, good, bad string }{
	{"outer-property", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; value: number }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; value: T }; return 1 }"},
	{"outer-alias", "a written member contract depending on an outer type parameter", "export function f<T>(): number { type Box = { value: number }; service S { static readonly key = \"outer/S\"; value: Box }; return 1 }", "export function f<T>(): number { type Box = { value: T }; service S { static readonly key = \"outer/S\"; value: Box }; return 1 }"},
	{"outer-local-interface-throws", "a written member contract depending on an outer type parameter", "export function f<T>(): number { interface Box {\n/** @throws {string} */\nload(): number\n}; service S { static readonly key = \"outer/Local\"; value: Box }; return 1 }", "export function f<T>(): number { interface Box {\n/** @throws {T} */\nload(): number\n}; service S { static readonly key = \"outer/Local\"; value: Box }; return 1 }"},
	{"outer-class-constructor", "a written member contract depending on an outer type parameter", "export class Host<T> { constructor() { service S { static readonly key = \"outer/Constructor\"; value: number } } }", "export class Host<T> { constructor() { service S { static readonly key = \"outer/Constructor\"; value: T } } }"},
	{"outer-class-getter", "a written member contract depending on an outer type parameter", "export class Host<T> { get value(): number { service S { static readonly key = \"outer/Getter\"; value: number }; return 1 } }", "export class Host<T> { get value(): number { service S { static readonly key = \"outer/Getter\"; value: T }; return 1 } }"},
	{"outer-concrete-array", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/Array\"; all: ReadonlyArray<{ n: number }> }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/Array\"; all: ReadonlyArray<{ n: T }> }; return 1 }"},
	{"outer-member-generic-effect", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/Effect\"; load<U>(value: U): U!! }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/Effect\"; load<U>(value: U): T!! }; return 1 }"},
	{"outer-array", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; value: ReadonlyArray<number> }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; value: ReadonlyArray<T> }; return 1 }"},
	{"outer-deep", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; value: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: number } } } } } } } } } } } } } } } } } } }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; value: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: T } } } } } } } } } } } } } } } } } } }; return 1 }"},
	{"outer-constraint", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; pick<U extends string>(u: U): U }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; pick<U extends T>(u: U): U }; return 1 }"},
	{"outer-default", "a written member contract depending on an outer type parameter", "export function f<T>(): number { type Box<U = number> = { value: U }; service S { static readonly key = \"outer/S\"; value: Box }; return 1 }", "export function f<T>(): number { type Box<U = T> = { value: U }; service S { static readonly key = \"outer/S\"; value: Box }; return 1 }"},
	{"outer-indexed", "a written member contract depending on an outer type parameter", "export function f<T extends { value: unknown }>(): number { service S { static readonly key = \"outer/S\"; value: number }; return 1 }", "export function f<T extends { value: unknown }>(): number { service S { static readonly key = \"outer/S\"; value: T[\"value\"] }; return 1 }"},
	{"outer-conditional-true", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take<U>(): U extends string ? U : number }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take<U>(): U extends string ? T : number }; return 1 }"},
	{"outer-conditional-false", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take<U>(): U extends string ? number : U }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take<U>(): U extends string ? number : T }; return 1 }"},
	{"outer-callable-conditional", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take: <U>() => U extends string ? U : number }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take: <U>() => U extends string ? T : number }; return 1 }"},
	{"outer-conditional-alias", "a written member contract depending on an outer type parameter", "type Branch<A,B> = B extends string ? A : number; export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take<U>(): Branch<string,U> }; return 1 }", "type Branch<A,B> = B extends string ? A : number; export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take<U>(): Branch<T,U> }; return 1 }"},
	{"outer-conditional-nested", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take<U,V>(): U extends string ? number : V extends number ? V : boolean }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take<U,V>(): U extends string ? number : V extends number ? T : boolean }; return 1 }"},
	{"outer-recursive-conditional", "a written member contract depending on an outer type parameter", "type Flatten<A> = A extends ReadonlyArray<infer B> ? Flatten<B> : A; export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take<U>(): Flatten<U> }; return 1 }", "type Flatten<A> = A extends ReadonlyArray<infer B> ? Flatten<B> : A; export function f<T>(): number { service S { static readonly key = \"outer/Conditional\"; take<U>(): Flatten<T> }; return 1 }"},
	{"outer-conditional", "a written member contract depending on an outer type parameter", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; value: boolean }; return 1 }", "export function f<T>(): number { service S { static readonly key = \"outer/S\"; value: T extends string ? number : boolean }; return 1 }"},
	{"outer-mapped", "a written member contract depending on an outer type parameter", "export function f<T extends object>(): number { service S { static readonly key = \"outer/S\"; value: { [K in 'fixed']: number } }; return 1 }", "export function f<T extends object>(): number { service S { static readonly key = \"outer/S\"; value: { [K in keyof T]: T[K] } }; return 1 }"},
	{"outer-mapped-keys", "a written member contract depending on an outer type parameter", "export function f<T extends object>(): number { service S { static readonly key = \"outer/S\"; value: { [K in 'fixed']?: number } }; return 1 }", "export function f<T extends object>(): number { service S { static readonly key = \"outer/S\"; value: { [K in keyof T]?: number } }; return 1 }"},
	{"outer-remapped", "a written member contract depending on an outer type parameter", "export function f<T extends string>(): number { service S { static readonly key = \"outer/S\"; value: { [K in 'fixed']: number } }; return 1 }", "export function f<T extends string>(): number { service S { static readonly key = \"outer/S\"; value: { [K in 'fixed' as T]: number } }; return 1 }"},
	{"outer-template", "a written member contract depending on an outer type parameter", "export function f<T extends string>(): number { service S { static readonly key = \"outer/S\"; value: `prefix-${number}` }; return 1 }", "export function f<T extends string>(): number { service S { static readonly key = \"outer/S\"; value: `prefix-${T}` }; return 1 }"},
	{"outer-string-mapping", "a written member contract depending on an outer type parameter", "export function f<T extends string>(): number { service S { static readonly key = \"outer/S\"; value: Uppercase<string> }; return 1 }", "export function f<T extends string>(): number { service S { static readonly key = \"outer/S\"; value: Uppercase<T> }; return 1 }"},
	{"outer-foreign-throws", "a written member contract depending on an outer type parameter", "import type { ForeignCallback } from \"./foreign-contracts.js\"; export function f<T>(): number { service S { static readonly key = \"outer/Foreign\"; load: ForeignCallback<string> }; return 1 }", "import type { ForeignCallback } from \"./foreign-contracts.js\"; export function f<T>(): number { service S { static readonly key = \"outer/Foreign\"; load: ForeignCallback<T> }; return 1 }"},
	{"outer-phantom-alias", "a written member contract depending on an outer type parameter", "type Ignore<U> = number; interface Box<U> { value: Ignore<U> }; export function f<T>(): number { service S { static readonly key = \"outer/Phantom\"; value: Box<T> }; return 1 }", "type Ignore<U> = U; interface Box<U> { value: Ignore<U> }; export function f<T>(): number { service S { static readonly key = \"outer/Phantom\"; value: Box<T> }; return 1 }"},
	{"outer-phantom-recursive", "a written member contract depending on an outer type parameter", "interface Box<U> { next: Box<U[]>; value: number }; export function f<T>(): number { service S { static readonly key = \"outer/Phantom\"; value: Box<T> }; return 1 }", "interface Box<U> { next: Box<U[]>; value: U }; export function f<T>(): number { service S { static readonly key = \"outer/Phantom\"; value: Box<T> }; return 1 }"},
	{"outer-method-throws", "a written member contract depending on an outer type parameter", "interface Box<U> {\n/** @throws {U} */\nload(): number\n}; export function f<T>(): number { service S { static readonly key = \"outer/Throws\"; value: Box<string> }; return 1 }", "interface Box<U> {\n/** @throws {U} */\nload(): number\n}; export function f<T>(): number { service S { static readonly key = \"outer/Throws\"; value: Box<T> }; return 1 }"},
	{"outer-generic-throws-constraint", "a written member contract depending on an outer type parameter", "interface Box<U> {\n/** @throws {R} */\n<R extends U>(): number\n}; export function f<T>(): number { service S { static readonly key = \"outer/Throws\"; value: Box<string> }; return 1 }", "interface Box<U> {\n/** @throws {R} */\n<R extends U>(): number\n}; export function f<T>(): number { service S { static readonly key = \"outer/Throws\"; value: Box<T> }; return 1 }"},
	{"outer-multiple-method-throws", "a written member contract depending on an outer type parameter", "interface Box<U> { nested: {\n/** @throws {U} */\nload(): number\n} }; export function f<T>(): number { service S { static readonly key = \"outer/Throws\"; value: { fixed: Box<string>; captured: Box<string> } }; return 1 }", "interface Box<U> { nested: {\n/** @throws {U} */\nload(): number\n} }; export function f<T>(): number { service S { static readonly key = \"outer/Throws\"; value: { fixed: Box<string>; captured: Box<T> } }; return 1 }"},
	{"outer-nested-method-throws", "a written member contract depending on an outer type parameter", "interface Box<U> { nested: {\n/** @throws {U} */\nload(): number\n} }; export function f<T>(): number { service S { static readonly key = \"outer/Throws\"; value: Box<string> }; return 1 }", "interface Box<U> { nested: {\n/** @throws {U} */\nload(): number\n} }; export function f<T>(): number { service S { static readonly key = \"outer/Throws\"; value: Box<T> }; return 1 }"},
	{"outer-phantom-interface", "a written member contract depending on an outer type parameter", "interface Box<U> { value: number }; export function f<T>(): number { service S { static readonly key = \"outer/Phantom\"; value: Box<T> }; return 1 }", "interface Box<U> { value: U }; export function f<T>(): number { service S { static readonly key = \"outer/Phantom\"; value: Box<T> }; return 1 }"},
	{"outer-shadowed-interface", "a written member contract depending on an outer type parameter", "interface Box<U> { identity<U>(value: U): U }; export function f<T>(): number { service S { static readonly key = \"outer/Phantom\"; value: Box<T> }; return 1 }", "interface Box<U> { identity<V>(value: U): V }; export function f<T>(): number { service S { static readonly key = \"outer/Phantom\"; value: Box<T> }; return 1 }"},
	{"outer-phantom-class", "a written member contract depending on an outer type parameter", "class Box<U> { value: number = 1 }; export function f<T>(): number { service S { static readonly key = \"outer/Phantom\"; value: Box<T> }; return 1 }", "class Box<U> { declare value: U }; export function f<T>(): number { service S { static readonly key = \"outer/Phantom\"; value: Box<T> }; return 1 }"},
	{"outer-interface-throws", "a written member contract depending on an outer type parameter", "interface Callback<U> {\n/** @throws {U} */\n(): number\n}; export function f<T>(): number { service S { static readonly key = \"outer/Throws\"; load: Callback<string> }; return 1 }", "interface Callback<U> {\n/** @throws {U} */\n(): number\n}; export function f<T>(): number { service S { static readonly key = \"outer/Throws\"; load: Callback<T> }; return 1 }"},
	{"outer-callable-alias", "a written member contract depending on an outer type parameter", "export function f<T>(): number { type Identity = <U>(value: U) => U; service S { static readonly key = \"outer/S\"; identity: Identity }; return 1 }", "export function f<T>(): number { type Identity = (value: T) => T; service S { static readonly key = \"outer/S\"; identity: Identity }; return 1 }"},
	{"missing-body", "a recognized service declaration missing its required body", "export service Users { n: number }", "export service Users"},
	{"ambient-explicit", "a custom `service` declaration in an ambient source context, explicit or inherited", "export service Users { n: number }", "declare service Users { n: number }"},
	{"ambient-inherited", "a custom `service` declaration in an ambient source context, explicit or inherited", "namespace Tools { export const n = 1 }", "declare namespace Tools { namespace Nested { export service Users { static readonly key = \"ambient/Users\"; n: number } } }"},
	{"ambient-missing-body-priority", "a custom `service` declaration in an ambient source context, explicit or inherited", "export service Users { n: number }", "declare service Users"},
	{"comma-methods", "two members on one line with no separator", "export service Users { a(): number, b(): string, }", "export service Users { a(): number b(): string }"},
	{"comma-properties", "two members on one line with no separator", "export service Users { readonly a: number, b?: string, }", "export service Users { a: number b: string }"},
	{"new-service", "`new Users()`", "export service Users { n: number }\nexport function f(): number { return 1 }", "export service Users { n: number }\nexport const u = new Users()"},
	{"extends-service", "`class X extends Users {}`", "export service Users { n: number }\nexport class X {}", "export service Users { n: number }\nexport class X extends Users {}"},
	{"instanceof-service", "`impl instanceof Users`", "export service Users { n: number }\nexport function f(impl: unknown): boolean { return typeof impl === \"object\" }", "export service Users { n: number }\nexport function f(impl: unknown): boolean { return impl instanceof Users }"},
	{"generic-service", "`service Repo<T> { … }`", "export service Repo { n: number }", "export service Repo<T> { n: T }"},
	{"class-pattern-service", "a class pattern `when Users:` or `when Users(…):`", "export service Users { n: number }\nexport function f(impl: unknown): number { return match (impl) { when { n: let n } and if (typeof n === \"number\"): n; default: 0; } }", "export service Users { n: number }\nexport function f(impl: unknown): number { return match (impl) { when Users: 1; default: 0; } }"},
	{"extractor-pattern-service", "a class pattern `when Users:` or `when Users(…):`", "export service Users { n: number }\nexport function f(impl: unknown): number { return match (impl) { when { let n }: 1; default: 0; } }", "export service Users { n: number }\nexport function f(impl: unknown): number { return match (impl) { when Users(let u): 1; default: 0; } }"},
	{"key-without-readonly", "`static key = \"a\"` without `readonly`", "export service Users {\n  static readonly key = \"a\"\n  n: number\n}", "export service Users {\n  static key = \"a\"\n  n: number\n}"},
	{"key-not-literal", "a `key` whose initializer is not a string literal", "export service Users {\n  static readonly key: string = \"S\"\n  n: number\n}", "const prefix = \"x\"\nexport service Users {\n  static readonly key = prefix + \"S\"\n  n: number\n}"},
	{"duplicate-key", "two services with the same key anywhere in the program", "export service A {\n  static readonly key = \"k1\"\n  n: number\n}\nexport service B {\n  static readonly key = \"k2\"\n  n: number\n}", "export service A {\n  static readonly key = \"k\"\n  n: number\n}\nexport service B {\n  static readonly key = \"k\"\n  n: number\n}"},
	{"member-body", "any member that is not a `PropertySignature`, a `MethodSignature`", "export service Users { find(id: string): string!! }", "export service Users { find(id: string): string!! { return id } }"},
	{"member-initializer", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { region: string }", "export service Users { region = \"eu\" }"},
	{"member-private", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { private n: number }"},
	{"member-protected", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { protected n: number }"},
	{"member-declare", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { declare n: number }"},
	{"member-accessor", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { accessor n: number }"},
	{"member-override", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { override n: number }"},
	{"member-private-name", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { #n: number }"},
	{"member-getter", "a `get` or `set` accessor", "export service Users { n: number }", "export service Users { get n(): number { return 1 } }"},
	{"member-constructor", "a `constructor`", "export service Users { n: number }", "export service Users {\n  constructor() {}\n  n: number\n}"},
	{"member-index-signature", "an index signature", "export service Users { n: number }", "export service Users { [k: string]: number }"},
	{"member-static-other", "or another `static`", "export service Users { n: number }", "export service Users {\n  static readonly label = \"users\"\n  n: number\n}"},
	{"member-effect-modifier", "A bodyless `effect find(id: string): User!NotFound`", "export service Users { find(id: string): string!! }", "export service Users { effect find(id: string): string!! }"},
	{"extends-clause", "`service S extends Base { }`", "export service Base { n: number }\nexport service S { m: number }", "export service Base { n: number }\nexport service S extends Base { }"},
	{"implements-clause", "`service S implements I { }`", "interface I { n: number }\nexport service S { n: number }", "interface I { n: number }\nexport service S implements I { }"},
	{"export-default", "`export default service S { }`", "service S { n: number }\nexport { S as default }", "export default service S { n: number }"},
	{"export-default-comment", "`export default service S { }`", "service S { n: number }\nexport { S as default }", "export default /* gap */ service S { n: number }"},
	{"export-default-newline", "`export default service S { }`", "service S { n: number }\nexport { S as default }", "export default\nservice S { n: number }"},
	{"export-default-contextual", "`export default service S { }`", "service S { n: number }\nexport { S as default }", "export default service async { n: number }"},
	{"export-default-empty", "`export default service S { }`", "service S { n: number }\nexport { S as default }", "export default service S {}"},
	{"member-static-shaped-object", "or another `static`", "export service Users: { n: number } { static readonly key = \"static/Object\" }", "export service Users: { n: number } { static readonly key = \"static/Object\"; static readonly extra = 1 }"},
	{"member-static-shaped-scalar", "or another `static`", "export service Users: number { static readonly key = \"static/Scalar\" }", "export service Users: number { static readonly key = \"static/Scalar\"; static extra() { return 1 } }"},
	{"member-static-shaped-shadow", "or another `static`", "export service Users: { read(): number } { static readonly key = \"static/Shadow\" }", "export service Users: { read(): number } { static readonly key = \"static/Shadow\"; static read() { return 1 } }"},
	{"member-static-legacy-no-value-body", "or another `static`", "export service S { static readonly key = \"legacy/Body\"; static readonly default: S.Shape = { n: 1 }; n: number }", "export service S { static readonly key = \"legacy/Body\"; static readonly default: S.Shape; n: number }"},
	{"member-static-legacy-no-value-object", "or another `static`", "export service S: { n: number } { static readonly key = \"legacy/Object\"; static readonly default: S.Shape = { n: 1 } }", "export service S: { n: number } { static readonly key = \"legacy/Object\"; static readonly default: S.Shape }"},
	{"member-static-legacy-no-value-scalar", "or another `static`", "export service S: number { static readonly key = \"legacy/Scalar\"; static readonly default: number = 1 }", "export service S: number { static readonly key = \"legacy/Scalar\"; static readonly default: number }"},
	{"member-static-legacy-no-value-function", "or another `static`", "export service S: (n: number) => number { static readonly key = \"legacy/Function\"; static readonly default: S.Shape = (n: number) => n }", "export service S: (n: number) => number { static readonly key = \"legacy/Function\"; static readonly default: S.Shape }"},
}

func servicesRulesChapter(f testing.TB) string {
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(string(chapter), "A member gets one diagnostic: the first row below that names it.") {
		f.Fatal("chapter 5 no longer states the one-diagnostic-per-member rule")
	}
	for _, rule := range servicesRules {
		if !strings.Contains(string(chapter), rule.quote) {
			f.Fatalf("%s: chapter 5 no longer says %q", rule.key, rule.quote)
		}
		if servicesRuleDiagnostic(string(chapter), rule.quote) == 0 {
			f.Fatalf("%s: no static-rules row of chapter 5 assigns a code to %q", rule.key, rule.quote)
		}
	}
	return string(chapter)

}

func TestServicesRulesQuoted(t *testing.T) { servicesRulesChapter(t) }

// A named package.json gives each service a derived key (chapter 5), so a
// control needs no written key.
const servicesPackage = "{\"type\":\"module\",\"name\":\"@fuzz/services\"}"

func FuzzServicesRules(f *testing.F) {
	startShortBudget(f)
	chapter := servicesRulesChapter(f)
	for _, rule := range servicesRules {
		f.Add([]byte(rule.key))
		f.Add([]byte(rule.key + "\x00\x03"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		choice := 0
		if len(data) != 0 {
			choice = int(data[0]) % len(servicesRules)
		}
		for i, rule := range servicesRules {
			if parts[0] == rule.key {
				choice = i
				break
			}
		}
		rule := servicesRules[choice]
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant := parts[1][0]
			if variant&1 != 0 {
				rule.good = "// retained trivia\n" + strings.ReplaceAll(rule.good, "Users", "UsersCafé")
				rule.bad = "// retained trivia\n" + strings.ReplaceAll(rule.bad, "Users", "UsersCafé")
			}
			if variant&2 != 0 {
				rule.good = strings.ReplaceAll(rule.good, "\"", "'")
				rule.bad = strings.ReplaceAll(rule.bad, "\"", "'")
			}
		}
		var compileErrors []string
		var errorCodes map[int32]bool
		compile := func(source string) bool {
			compileErrors = nil
			errorCodes = map[int32]bool{}
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source + "\n", "package.json": servicesPackage, "foreign-contracts.ts": "export type ForeignCallback<E> = {\n/** @throws {E} */\n(): number\n}\n"}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					compileErrors = append(compileErrors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
					if IsEK(d) {
						errorCodes[d.Code()] = true
					}
				}
			}
			return len(compileErrors) == 0
		}
		if !compile(rule.good) {
			Gap(t, "FuzzServicesRules", "control:"+rule.key, "chapter 5: %s; valid control does not compile:\n%s\n%s", rule.quote, rule.good, strings.Join(compileErrors, "\n"))
			return
		}
		if compile(rule.bad) {
			Gap(t, "FuzzServicesRules", "reject:"+rule.key, "chapter 5: %s; forbidden form compiled:\n%s", rule.quote, rule.bad)
			return
		}
		if expected := servicesRuleDiagnostic(chapter, rule.quote); !errorCodes[expected] {
			Gap(t, "FuzzServicesRules", "diagnostic:"+rule.key, "chapter 5 requires EK%04d for %s; got:\n%s", expected, rule.key, strings.Join(compileErrors, "\n"))
			return
		}
		ExpectPending(t, "FuzzServicesRules", "control:"+rule.key)
		ExpectPending(t, "FuzzServicesRules", "reject:"+rule.key)
		ExpectPending(t, "FuzzServicesRules", "diagnostic:"+rule.key)
		ExpectPending(t, "FuzzServicesRules", specCorpusKey(t))
	})
}

// servicesRuleDiagnostic reads the assigned code from the static-rules table
// row of chapter 5 that contains quote: the first EK code on that row is the
// Code column (a Why column may cite another code after it).
func servicesRuleDiagnostic(chapter, quote string) int32 {
	pattern := regexp.MustCompile("EK([0-9]{4})")
	for _, line := range strings.Split(chapter, "\n") {
		if !strings.HasPrefix(line, "|") || !strings.Contains(line, quote) {
			continue
		}
		if match := pattern.FindStringSubmatch(line); match != nil {
			code, _ := strconv.Atoi(match[1])
			return int32(code)
		}
	}
	return 0
}
