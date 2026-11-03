package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// Chapter 001/005: focused entry points for the existing failure oracle.
// They retain the original oracle, mutations and FuzzFailuresSpec pending keys;
// unrelated Chapter 003 wording changes cannot prevent these rules from running.
type coverageCallableRule struct {
	key, chapter, quote, rule string
	names                     []string
}
type coverageCallableWitness struct {
	key  string
	c    *failCase
	rule string
}

func coverageCallableRules() []coverageCallableRule {
	return []coverageCallableRule{
		// Spec rule: docs/design/src/001-functions.md#18eaa1c18c09b10e
		// Chapter 001: callable-const.
		{key: "callable-const", rule: "docs/design/src/001-functions.md#18eaa1c18c09b10e", chapter: "001-functions.md", quote: "- **Thrown types.** A `.vibe` callable throws `never` ([Thrown types](003-failures.md#thrown-types)), so the output states the same on every call signature it emits other than an effectful one: functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias carry `@throws {never}`. A foreign reader treats a declaration without a tag as throwing `unknown`, so this constant is the boundary, not an inferred contract. An effectful function carries no `@throws`. A bare function type stays a function type, and getters and setters carry none. A re-exported foreign callable keeps its actual `@throws` and `@rethrows`.", names: []string{"coverage-const-never"}},
		// Spec rule: docs/design/src/001-functions.md#cff8ec19ada090af
		// Chapter 000: foreign-alias-tag-position.
		{key: "foreign-alias-tag-position", rule: "docs/design/src/001-functions.md#cff8ec19ada090af", chapter: "../vips/0004-throw.md", quote: "- **Amended 2026-10-29: contracts sit on call signatures.** `@throws` and `@rethrows` attach to a call signature, as TypeScript attaches JSDoc to each overload; a returned function's contract sits on its own signature. Declaration output writes the contract on every emitted call signature. Decided by the agent on 2026-10-29 under Will's rule \"when I state a principle, the agent derives the concrete rule and acts; I can override later\" (decided detail 38).", names: []string{"coverage-alias-tag-ignored", "foreign-declared-type-never"}},
		// Spec rule: docs/design/src/001-functions.md#681aa02d6dd151af
		// Chapter 000: foreign-callable-default.
		{key: "foreign-callable-default", rule: "docs/design/src/001-functions.md#681aa02d6dd151af", chapter: "../vips/0004-throw.md", quote: "- **Amended 2026-11-02: one rule for all TypeScript (Will).** Only a callable declared in a `.ts`, `.js` or `.d.ts` file, an npm package or a `module` body has a thrown type. `@throws {T}` means it throws `T`, and no `@throws` means it throws `unknown`. Package-level special cases are gone. A `.vibe` callable throws `never`: nothing is inferred from a body, and a written `@throws` or `@rethrows` in a `.vibe` file is `EK0406`.", names: []string{"foreign-const", "foreign-method", "foreign-overload"}},
		// Spec rule: docs/design/src/001-functions.md#4d435bd6aa6eb3bf
		// Chapter 000: effect-overload-bound.
		{key: "effect-overload-bound", rule: "docs/design/src/001-functions.md#4d435bd6aa6eb3bf", chapter: "../vips/0004-throw.md", quote: "- **Amended 2026-10-29: effectful callables.** A function whose return type is wholly `Effect`, `Stream` or `Layer` can't throw, and calling it is never throw-tracked: its failures are its Effect's error channel (Will: \"@throws only applies to non effectful functions[;] an effectful function literally cannot throw\"). `any`, `unknown` and a union with a non-effectful member are not effectful. Generic signatures are classified before type-argument substitution, through their constraints.", names: []string{"overload-effect-bound-throw", "overload-effect-bound-ok"}},
		// Spec rule: docs/design/src/001-functions.md#cdf236364bc3c19d
		// Chapter 000: mixed-overload-rejection.
		{key: "mixed-overload-rejection", rule: "docs/design/src/001-functions.md#cdf236364bc3c19d", chapter: "../vips/0004-throw.md", quote: "- **Amended 2026-10-29: effectful callables.** A function whose return type is wholly `Effect`, `Stream` or `Layer` can't throw, and calling it is never throw-tracked: its failures are its Effect's error channel (Will: \"@throws only applies to non effectful functions[;] an effectful function literally cannot throw\"). `any`, `unknown` and a union with a non-effectful member are not effectful. Generic signatures are classified before type-argument substitution, through their constraints.", names: []string{"overload-effect-bound-throw"}},
		// Spec rule: docs/design/src/001-functions.md#f549f1c363802e16
		// Chapter 000: plain-effectful-body.
		{key: "plain-effectful-body", rule: "docs/design/src/001-functions.md#f549f1c363802e16", chapter: "../vips/0004-throw.md", quote: "- **Amended 2026-10-29: effectful callables.** A function whose return type is wholly `Effect`, `Stream` or `Layer` can't throw, and calling it is never throw-tracked: its failures are its Effect's error channel (Will: \"@throws only applies to non effectful functions[;] an effectful function literally cannot throw\"). `any`, `unknown` and a union with a non-effectful member are not effectful. Generic signatures are classified before type-argument substitution, through their constraints.", names: []string{"effectful-body-throw"}},
		// Spec rule: docs/design/src/001-functions.md#31339b2c124b3d3c
		// Chapter 000: direct-call-rejection.
		{key: "direct-call-rejection", rule: "docs/design/src/001-functions.md#31339b2c124b3d3c", chapter: "../vips/0004-throw.md", quote: "- **Amended 2026-11-02: one rule for all TypeScript (Will).** Only a callable declared in a `.ts`, `.js` or `.d.ts` file, an npm package or a `module` body has a thrown type. `@throws {T}` means it throws `T`, and no `@throws` means it throws `unknown`. Package-level special cases are gone. A `.vibe` callable throws `never`: nothing is inferred from a body, and a written `@throws` or `@rethrows` in a `.vibe` file is `EK0406`.", names: []string{"library-tagged", "library-tagged-wrapped"}},
		// Spec rule: docs/design/src/005-services.md#4c0d571572bbc638
		// Chapter 005: service-member-admission.
		{key: "service-member-admission", rule: "docs/design/src/005-services.md#4c0d571572bbc638", chapter: "005-services.md", quote: "For throw tracking a VibeLang service member admits only `never`; a written `@throws` or `@rethrows` is `EK0406` ([Thrown types](003-failures.md#thrown-types)). A foreign implementation must satisfy that non-throwing contract.", names: []string{"coverage-service-assignment"}},
		// Spec rule: docs/design/src/005-services.md#038937fe614e642f
		// Chapter 005: effect-callback-contract.
		{key: "effect-callback-contract", rule: "docs/design/src/005-services.md#038937fe614e642f", chapter: "005-services.md", quote: "These Effect functions do not inherit the `@rethrows` contracts of `Array.prototype.map`, `Array.prototype.forEach`, `Array.prototype.filter` or `Array.prototype.reduce`; a throwing callback needs the explicit wrapper required by [Failures](003-failures.md).", names: []string{"coverage-effect-map-throws", "coverage-effect-map-wrapped"}},
	}
}
func coverageCallableAdditionalCases() []*failCase {
	return []*failCase{
		{Name: "coverage-const-never", VIP: 27, Host: "none", Decls: "export const add = (a: number, b: number) => a + b", Throws: map[string]string{"add": "{never}"}, Chapter: "001-functions.md", Quote: "- **Thrown types.** A `.vibe` callable throws `never` ([Thrown types](003-failures.md#thrown-types)), so the output states the same on every call signature it emits other than an effectful one: functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias carry `@throws {never}`. A foreign reader treats a declaration without a tag as throwing `unknown`, so this constant is the boundary, not an inferred contract. An effectful function carries no `@throws`. A bare function type stays a function type, and getters and setters carry none. A re-exported foreign callable keeps its actual `@throws` and `@rethrows`."},
		{Name: "coverage-alias-tag-ignored", VIP: 4, Lib: "/** @throws {never} */\nexport type Reader = () => string\nexport declare const read: Reader", Body: "⟦read()⟧", Code: 403, Chapter: "../vips/0004-throw.md", Quote: "- **Amended 2026-10-29: contracts sit on call signatures.** `@throws` and `@rethrows` attach to a call signature, as TypeScript attaches JSDoc to each overload; a returned function's contract sits on its own signature. Declaration output writes the contract on every emitted call signature. Decided by the agent on 2026-10-29 under Will's rule \"when I state a principle, the agent derives the concrete rule and acts; I can override later\" (decided detail 38)."},
		{Name: "coverage-service-assignment", VIP: 4, Lib: "/** @throws {Error} */\nexport declare function read(): number", Decls: "service Reader { read(): number }", Body: "const impl: Reader.Shape = ⟦{ read }⟧", Code: 402, Chapter: "005-services.md", Quote: "For throw tracking a VibeLang service member admits only `never`; a written `@throws` or `@rethrows` is `EK0406` ([Thrown types](003-failures.md#thrown-types)). A foreign implementation must satisfy that non-throwing contract."},
		{Name: "coverage-effect-map-throws", VIP: 4, Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string", Body: "const value = try ⟦Effect.map(Effect.succeed(s), parse)⟧", Code: 402, Chapter: "005-services.md", Quote: "These Effect functions do not inherit the `@rethrows` contracts of `Array.prototype.map`, `Array.prototype.forEach`, `Array.prototype.filter` or `Array.prototype.reduce`; a throwing callback needs the explicit wrapper required by [Failures](003-failures.md)."},
		{Name: "coverage-effect-map-wrapped", VIP: 4, Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string", Body: "const value = try Effect.flatMap(Effect.succeed(s), value => Effect.try(() => parse(value)))", Chapter: "005-services.md", Quote: "These Effect functions do not inherit the `@rethrows` contracts of `Array.prototype.map`, `Array.prototype.forEach`, `Array.prototype.filter` or `Array.prototype.reduce`; a throwing callback needs the explicit wrapper required by [Failures](003-failures.md)."},
	}
}
func coverageCallableWitnesses(tb testing.TB) []coverageCallableWitness {
	tb.Helper()
	all := failuresCases()
	var out []coverageCallableWitness
	for _, rule := range coverageCallableRules() {
		text := strings.Join(strings.Fields(SpecText(rule.chapter)), " ")
		quote := strings.Join(strings.Fields(rule.quote), " ")
		if !strings.Contains(text, quote) {
			tb.Fatalf("%s no longer quotes %s", rule.chapter, rule.quote)
		}
		for _, name := range rule.names {
			at := slices.IndexFunc(all, func(c *failCase) bool { return c.Name == name })
			if at < 0 {
				tb.Fatalf("missing failure witness %s", name)
			}
			c := *all[at]
			c.Chapter, c.Quote = rule.chapter, rule.quote
			out = append(out, coverageCallableWitness{key: rule.key + "/" + name, c: &c, rule: rule.rule})
		}
	}
	return out
}
func TestCoverageCallableContractsQuoted(t *testing.T) {
	coverageCallableWitnesses(t)
}
func checkCoverageCallable(t *testing.T, w *Workspace, entry coverageCallableWitness, choice uint8) {
	t.Helper()
	t.Logf("Spec rule: %s; witness %s", entry.rule, entry.key)
	checkFailures(t, w, entry.c, choice)
}
func TestCoverageCallableContracts(t *testing.T) {
	// Spec rule: docs/design/src/001-functions.md#18eaa1c18c09b10e
	// Chapter 001: callable-const; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#cff8ec19ada090af
	// Chapter 001: foreign-alias-tag-position; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#681aa02d6dd151af
	// Chapter 001: foreign-callable-default; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#4d435bd6aa6eb3bf
	// Chapter 001: effect-overload-bound; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#cdf236364bc3c19d
	// Chapter 001: mixed-overload-rejection; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#f549f1c363802e16
	// Chapter 001: plain-effectful-body; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#31339b2c124b3d3c
	// Chapter 001: direct-call-rejection; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/005-services.md#4c0d571572bbc638
	// Chapter 005: service-member-admission; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/005-services.md#038937fe614e642f
	// Chapter 005: effect-callback-contract; exact failure/declaration oracle across source/sidecar and nested-block mutations.

	w := NewWorkspace(t)
	for _, entry := range coverageCallableWitnesses(t) {
		for _, choice := range []uint8{0, 1, 8, 9} {
			t.Run(fmt.Sprintf("%s/%s/%d", entry.key, entry.rule, choice), func(t *testing.T) { checkCoverageCallable(t, w, entry, choice) })
		}
	}
}
func FuzzCoverageCallableContracts(f *testing.F) {
	// Spec rule: docs/design/src/001-functions.md#18eaa1c18c09b10e
	// Chapter 001: callable-const; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#cff8ec19ada090af
	// Chapter 001: foreign-alias-tag-position; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#681aa02d6dd151af
	// Chapter 001: foreign-callable-default; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#4d435bd6aa6eb3bf
	// Chapter 001: effect-overload-bound; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#cdf236364bc3c19d
	// Chapter 001: mixed-overload-rejection; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#f549f1c363802e16
	// Chapter 001: plain-effectful-body; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/001-functions.md#31339b2c124b3d3c
	// Chapter 001: direct-call-rejection; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/005-services.md#4c0d571572bbc638
	// Chapter 005: service-member-admission; exact failure/declaration oracle across source/sidecar and nested-block mutations.
	// Spec rule: docs/design/src/005-services.md#038937fe614e642f
	// Chapter 005: effect-callback-contract; exact failure/declaration oracle across source/sidecar and nested-block mutations.

	startShortBudget(f)
	entries := coverageCallableWitnesses(f)
	for _, entry := range entries {
		f.Add(entry.key, uint8(0))
		f.Add(entry.key, uint8(8))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		index := slices.IndexFunc(entries, func(e coverageCallableWitness) bool { return e.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(entries)
		}
		checkCoverageCallable(t, w, entries[index], choice)
	})
}
