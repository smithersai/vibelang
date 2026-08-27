package compiler

import (
	"strings"
	"testing"
)

// Handler selection, the nominal brand that makes it checkable, and the
// reachability of the compiler-owned Result constructors.
//
// specification/failures.mdx, "Error Prototype": "Handler selection MUST use
// compiler-stable nominal identity, not a forgeable user `_tag` or
// minifier-sensitive constructor name in compiled artifacts."
//
// specification/failures.mdx, "Compiler Lifting" (Locked): "Authors MUST NOT
// need to write `Result.ok(...)` or `Result.err(...)`. Those constructors MUST
// NOT be part of the ordinary Smithers authoring API."
//
// Every claim below is measured by RUNNING the emitted JavaScript, not by
// reading it, except where the claim is explicitly about the emitted text (the
// brand is type-only, so its whole point is that the JavaScript does not
// change).

// ---------------------------------------------------------------------------
// Selection is not forgeable
// ---------------------------------------------------------------------------

// A class may install its own `Symbol.hasInstance`. `instanceof` consults it, so
// a lowered `error instanceof CaseClass` chain let a lying class decide whether
// ANOTHER class's instances were its own. The four subtests are the four ways
// that goes wrong: capture a sibling, capture through a lying base, deny its own
// instance to a fallback, and deny its own instance out of an exhaustive match.
func TestPinnedForkMatchSelectionIgnoresAUserInstalledHasInstance(t *testing.T) {
	for _, item := range []struct {
		name   string
		source string
		want   string
	}{
		{
			name: "a lying case class does not capture a sibling",
			source: `export class NotFound extends Error {
    constructor(readonly key: string) { super("not found " + key); }
}

export class Timeout extends Error {
    static [Symbol.hasInstance](value: unknown): boolean { return true; }
    constructor(readonly ms: number) { super("timeout " + ms); }
}

export function classify(error: NotFound | Timeout): string {
    return error.match({
        Timeout: (failure) => "timeout",
        NotFound: (failure) => "notfound:" + failure.key,
    });
}

export function main(): string[] { return [classify(new NotFound("k"))]; }
`,
			want: "notfound:k",
		},
		{
			name: "a lying case class does not capture a sibling into matchPartial",
			source: `export class NotFound extends Error {
    constructor(readonly key: string) { super("not found " + key); }
}

export class Timeout extends Error {
    static [Symbol.hasInstance](value: unknown): boolean { return true; }
    constructor(readonly ms: number) { super("timeout " + ms); }
}

export function classify(error: NotFound | Timeout): string {
    return error.matchPartial({ Timeout: (failure) => "timeout" }, (rest) => "fallback:" + rest.message);
}

export function main(): string[] { return [classify(new NotFound("k"))]; }
`,
			want: "fallback:not found k",
		},
		{
			name: "a case class whose BASE lies does not capture a sibling",
			source: `export class LyingBase extends Error {
    static [Symbol.hasInstance](value: unknown): boolean { return true; }
}

export class Derived extends LyingBase {
    constructor(readonly ms: number) { super("derived"); }
}

export class NotFound extends Error {
    constructor(readonly key: string) { super("not found " + key); }
}

export function classify(error: NotFound | Derived): string {
    return error.match({
        Derived: (failure) => "derived",
        NotFound: (failure) => "notfound:" + failure.key,
    });
}

export function main(): string[] { return [classify(new NotFound("k"))]; }
`,
			want: "notfound:k",
		},
		{
			name: "a case class that DENIES its own instances still receives them",
			source: `export class Denier extends Error {
    static [Symbol.hasInstance](value: unknown): boolean { return false; }
    constructor(readonly key: string) { super("denier " + key); }
}

export class NotFound extends Error {
    constructor(readonly key: string) { super("not found " + key); }
}

export function classify(error: NotFound | Denier): string {
    return error.match({
        Denier: (failure) => "denier:" + failure.key,
        NotFound: (failure) => "notfound:" + failure.key,
    });
}

export function main(): string[] { return [classify(new Denier("k"))]; }
`,
			// A bare `instanceof` answered false here and the program died in
			// smithersMatchFailed: denial is the other half of the same hole,
			// and it turns a total match into a crash rather than a wrong answer.
			want: "denier:k",
		},
	} {
		t.Run(item.name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: item.source}})
			texts := requireCleanCompile(t, result)
			if strings.Contains(texts["main.js"], " instanceof ") {
				t.Fatalf("handler selection must not be lowered to instanceof:\n%s", texts["main.js"])
			}
			if got := runEmittedMain(t, result); got != item.want {
				t.Fatalf("classify = %q, want %q", got, item.want)
			}
		})
	}
}

// The same predicate governs which channel a foreign `@throws {T}` call is
// admitted into. `T` is a class an author named, so a lying one admitted ANY
// thrown value into the declared recoverable channel — a Result failure that
// never came from that class at all. The honest control is the second subtest:
// a truthful class must still be admitted, or the rule would have closed the
// hole by closing the channel.
func TestPinnedForkDeclaredForeignChannelIgnoresAUserInstalledHasInstance(t *testing.T) {
	host := func(class string, body string) string {
		return `/**
 * @module a trusted foreign host whose initialization cannot panic
 * @throws {never}
 */

` + class + `

/** @throws {Chosen} */
export function lookup(key: string): string {
    ` + body + `
}
`
	}
	main := `import { Panic } from "smithers:exceptions"
import { lookup, Chosen } from "./host.ts"

export function run(key: string): Result<string, Chosen | Panic> {
    return lookup(key);
}

export function main(): string[] {
    return [run("k").match({ ok: (value) => "ok:" + value, error: (failure) => "error:" + failure.name })];
}
`
	for _, item := range []struct {
		name  string
		class string
		body  string
		want  string
	}{
		{
			name: "a lying declared channel does not admit an unrelated throw",
			class: `export class Chosen extends Error {
    static [Symbol.hasInstance](value: unknown): boolean { return true; }
    constructor(readonly key: string) { super("chosen " + key); }
}`,
			body: `throw new RangeError("a RangeError, not a Chosen: " + key);`,
			want: "error:Panic",
		},
		{
			name: "an honest declared channel still admits its own error",
			class: `export class Chosen extends Error {
    constructor(readonly key: string) { super("chosen " + key); }
}`,
			body: `throw new Chosen(key);`,
			want: "error:Error",
		},
	} {
		t.Run(item.name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{
				{Path: "main.sm", Kind: FileKindSmithers, Text: main},
				{Path: "host.ts", Kind: FileKindTypeScript, Text: host(item.class, item.body)},
			})
			requireCleanCompile(t, result)
			if got := runEmittedMain(t, result); got != item.want {
				t.Fatalf("run = %q, want %q", got, item.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// The nominal brand
// ---------------------------------------------------------------------------

// The predicate narrows its else branch by ASSIGNABILITY, so two same-shape
// Error classes subtract each other and the surviving sibling would collapse to
// `never`. The brand is what stops that, and these are the programs that prove
// it: each one has a fallback whose parameter is UNANNOTATED, which is where the
// collapse showed up (TS2339 "Property 'message' does not exist on type
// 'never'") because TypeScript types an immediately-invoked function's
// parameters from its argument.
func TestPinnedForkStructurallyIdenticalSiblingsStayDistinguishable(t *testing.T) {
	t.Run("two same-named classes in two modules", func(t *testing.T) {
		result := compileInternalSource(t, []SourceFile{
			{Path: "main.sm", Kind: FileKindSmithers, Text: `import { Missing as PaymentsMissing } from "./payments.sm"

export class Missing extends Error {
    constructor(readonly key: string) { super("local " + key); }
}

export function classify(error: Missing | PaymentsMissing): string {
    return error.matchPartial({ Missing: (failure) => "local:" + failure.key }, (rest) => "fallback:" + rest.message);
}

export function main(): string[] {
    return [classify(new Missing("zoe")), classify(new PaymentsMissing("zoe"))];
}
`},
			{Path: "payments.sm", Kind: FileKindSmithers, Text: `export class Missing extends Error {
    constructor(readonly key: string) { super("payments has no " + key); }
}
`},
		})
		texts := requireCleanCompile(t, result)
		// The identity in the brand is the identity in the registration, so the
		// nominal key and the wire key cannot drift apart.
		for _, want := range []string{
			`export interface Missing extends __SmithersNominalError<"smithers:main.sm:Missing"> {`,
		} {
			if !strings.Contains(texts["main.d.sm.ts"], want) {
				t.Fatalf("missing %q in declarations:\n%s", want, texts["main.d.sm.ts"])
			}
		}
		if !strings.Contains(texts["payments.d.sm.ts"], `extends __SmithersNominalError<"smithers:payments.sm:Missing">`) {
			t.Fatalf("payments.sm brand is wrong:\n%s", texts["payments.d.sm.ts"])
		}
		if got, want := runEmittedMain(t, result), "local:zoe\nfallback:payments has no zoe"; got != want {
			t.Fatalf("classify = %q, want %q", got, want)
		}
	})

	t.Run("two same-shape classes in one module", func(t *testing.T) {
		result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: `export class MissingA extends Error {
    constructor(readonly key: string) { super("a " + key); }
}

export class MissingB extends Error {
    constructor(readonly key: string) { super("b " + key); }
}

export function classify(error: MissingA | MissingB): string {
    return error.matchPartial({ MissingA: (failure) => "a:" + failure.key }, (rest) => "fallback:" + rest.message);
}

export function main(): string[] {
    return [classify(new MissingA("x")), classify(new MissingB("y"))];
}
`}})
		texts := requireCleanCompile(t, result)
		for _, want := range []string{
			`export interface MissingA extends __SmithersNominalError<"smithers:main.sm:MissingA">`,
			`export interface MissingB extends __SmithersNominalError<"smithers:main.sm:MissingB">`,
		} {
			if !strings.Contains(texts["main.d.sm.ts"], want) {
				t.Fatalf("missing %q in declarations:\n%s", want, texts["main.d.sm.ts"])
			}
		}
		if got, want := runEmittedMain(t, result), "a:x\nfallback:b y"; got != want {
			t.Fatalf("classify = %q, want %q", got, want)
		}
	})

	// The form annotateFallbackParameter cannot cover, and therefore the one
	// that proves the brand is load-bearing rather than decorative: handlers
	// with NO parameter that close over the scrutinee. There is no parameter to
	// annotate, so the handler body is checked against whatever the case's own
	// predicate left the scrutinee — and without the brand the earlier case has
	// already subtracted its structurally identical sibling, so the body reads a
	// member of `never`. Measured with the brand removed: TS2339 "Property 'key'
	// does not exist on type 'never'", on a program the reference accepts.
	t.Run("zero-parameter handlers closing over the scrutinee", func(t *testing.T) {
		result := compileInternalSource(t, []SourceFile{
			{Path: "main.sm", Kind: FileKindSmithers, Text: `import { Missing as PaymentsMissing } from "./payments.sm"

export class Missing extends Error {
    constructor(readonly key: string) { super("local " + key); }
}

export function classify(error: Missing | PaymentsMissing): string {
    return error.match({
        Missing: () => "local:" + error.key,
        PaymentsMissing: () => "remote:" + error.key,
    });
}

export function main(): string[] {
    return [classify(new Missing("zoe")), classify(new PaymentsMissing("zoe"))];
}
`},
			{Path: "payments.sm", Kind: FileKindSmithers, Text: `export class Missing extends Error {
    constructor(readonly key: string) { super("payments has no " + key); }
}
`},
		})
		requireCleanCompile(t, result)
		if got, want := runEmittedMain(t, result), "local:zoe\nremote:zoe"; got != want {
			t.Fatalf("classify = %q, want %q", got, want)
		}
	})

	// Two SUBCLASSES of one base must share their ancestor's brand, because
	// TypeScript refuses a merged interface whose inherited members differ from
	// the base's (TS2320). They therefore stay mutually assignable, the
	// subtraction reaches `never`, and only annotateFallbackParameter keeps the
	// lowered program checking. This is the residual the reference frontend has
	// too, pinned here as a working program rather than left to be discovered.
	t.Run("two subclasses of one branded base", func(t *testing.T) {
		result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: `export abstract class Family extends Error {}

export class Left extends Family {
    constructor(readonly key: string) { super("l " + key); }
}

export class Right extends Family {
    constructor(readonly key: string) { super("r " + key); }
}

export function classify(error: Left | Right): string {
    return error.matchPartial({ Left: (failure) => "left:" + failure.key }, (rest) => "fallback:" + rest.message);
}

export function main(): string[] {
    return [classify(new Left("a")), classify(new Right("b"))];
}
`}})
		texts := requireCleanCompile(t, result)
		if !strings.Contains(texts["main.d.sm.ts"], `export interface Family extends __SmithersNominalError<"smithers:main.sm:Family">`) {
			t.Fatalf("the top of the chain must carry the brand:\n%s", texts["main.d.sm.ts"])
		}
		for _, unwanted := range []string{"interface Left extends __SmithersNominalError", "interface Right extends __SmithersNominalError"} {
			if strings.Contains(texts["main.d.sm.ts"], unwanted) {
				t.Fatalf("a subclass must inherit its ancestor's brand, not carry its own:\n%s", texts["main.d.sm.ts"])
			}
		}
		if got, want := runEmittedMain(t, result), "left:a\nfallback:r b"; got != want {
			t.Fatalf("classify = %q, want %q", got, want)
		}
	})
}

// The parameter shapes annotateSoleParameter must NOT rewrite. A rest parameter
// binds the array of remaining arguments rather than the selected error, so
// annotating it with an error type is invalid TypeScript rather than a more
// precise version of the same thing — the reference accepts both programs below,
// and annotating produced TS2370 on the fork alone. The destructuring and
// already-annotated shapes are the neighbouring forms, pinned so that a later
// change to the annotation reads as deliberate.
func TestPinnedForkHandlerAndFallbackParameterShapesAreLeftAlone(t *testing.T) {
	for _, item := range []struct {
		name   string
		source string
		want   string
	}{
		{
			name: "rest-parameter handlers",
			source: `export class NotFound extends Error {
    constructor(readonly key: string) { super("not found " + key); }
}

export class Timeout extends Error {
    constructor(readonly ms: number) { super("timeout"); }
}

export function classify(error: NotFound | Timeout): string {
    return error.match({ NotFound: (...f) => "nf:" + f.length, Timeout: (...f) => "to:" + f.length });
}

export function main(): string[] { return [classify(new NotFound("k")), classify(new Timeout(3))]; }
`,
			want: "nf:1\nto:1",
		},
		{
			name: "a rest-parameter matchPartial fallback",
			source: `export class NotFound extends Error {
    constructor(readonly key: string) { super("not found " + key); }
}

export class Missing extends Error {
    constructor(readonly key: string) { super("missing " + key); }
}

export function classify(error: NotFound | Missing): string {
    return error.matchPartial({ NotFound: (f) => "nf:" + f.key }, (...rest) => "fallback:" + rest.length);
}

export function main(): string[] { return [classify(new Missing("k"))]; }
`,
			want: "fallback:1",
		},
		{
			name: "a destructuring matchPartial fallback",
			source: `export class NotFound extends Error {
    constructor(readonly key: string) { super("not found " + key); }
}

export class Missing extends Error {
    constructor(readonly key: string) { super("missing " + key); }
}

export function classify(error: NotFound | Missing): string {
    return error.matchPartial({ NotFound: (f) => "nf:" + f.key }, ({ message }) => "fallback:" + message);
}

export function main(): string[] { return [classify(new Missing("k"))]; }
`,
			want: "fallback:missing k",
		},
	} {
		t.Run(item.name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: item.source}})
			requireCleanCompile(t, result)
			if got := runEmittedMain(t, result); got != item.want {
				t.Fatalf("classify = %q, want %q", got, item.want)
			}
		})
	}
}

// Exactly one level of an inheritance chain may carry a brand, and a generic
// Error class carries none, because the merged interface would have to restate
// its type parameter list. Both exclusions are TypeScript's, not the language's,
// and both match the reference frontend's nominalErrorInterface.
func TestPinnedForkBrandsExactlyTheClassesTheReferenceBrands(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: `export class FileError extends Error {
    constructor(readonly path: string) { super("file " + path); }
}

export class FileNotFound extends FileError {}

export class Parameterized<T> extends Error {
    constructor(readonly detail: T) { super("parameterized"); }
}

class Local extends Error {}

export function main(): string[] {
    return [new FileNotFound("/x").message, new Parameterized("d").message, new Local().name];
}
`}})
	texts := requireCleanCompile(t, result)
	declaration := texts["main.d.sm.ts"]
	if !strings.Contains(declaration, `export interface FileError extends __SmithersNominalError<"smithers:main.sm:FileError">`) {
		t.Fatalf("the base of the chain must be branded:\n%s", declaration)
	}
	for _, unwanted := range []string{
		"interface FileNotFound extends __SmithersNominalError",
		"interface Parameterized extends __SmithersNominalError",
	} {
		if strings.Contains(declaration, unwanted) {
			t.Fatalf("unexpected brand %q:\n%s", unwanted, declaration)
		}
	}
	// A registration is emitted for every named Error class, branded or not:
	// the two decisions are independent and only the brand has the TypeScript
	// constraint.
	for _, want := range []string{
		`__smithersRegisterError(FileError, "smithers:main.sm:FileError");`,
		`__smithersRegisterError(FileNotFound, "smithers:main.sm:FileNotFound");`,
		`__smithersRegisterError(Parameterized, "smithers:main.sm:Parameterized");`,
		`__smithersRegisterError(Local, "smithers:main.sm:Local");`,
	} {
		if !strings.Contains(texts["main.js"], want) {
			t.Fatalf("missing registration %q:\n%s", want, texts["main.js"])
		}
	}
}

// The brand is a phantom type-only member, so the emitted JavaScript may not
// mention it at all — not the interface, not the type-only import specifier, and
// not the `unique symbol` the prelude declares for it.
func TestPinnedForkNominalBrandLeavesTheEmittedJavaScriptUntouched(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: `export class NotFound extends Error {
    constructor(readonly key: string) { super("not found " + key); }
}

export function main(): string[] { return [new NotFound("k").message]; }
`}})
	texts := requireCleanCompile(t, result)
	for _, unwanted := range []string{"SmithersNominalError", "smithersNominalErrorBrand"} {
		if strings.Contains(texts["main.js"], unwanted) {
			t.Fatalf("emitted JavaScript must not mention %q:\n%s", unwanted, texts["main.js"])
		}
		if strings.Contains(texts["__smithers_prelude.js"], unwanted) {
			t.Fatalf("emitted prelude JavaScript must not mention %q", unwanted)
		}
	}
	if !strings.Contains(texts["main.d.sm.ts"], `import { type SmithersNominalError as __SmithersNominalError }`) {
		t.Fatalf("the declaration must carry the brand's type-only import:\n%s", texts["main.d.sm.ts"])
	}
}

// ---------------------------------------------------------------------------
// Both directions: genuine programs must still work
// ---------------------------------------------------------------------------

// A Result that came from a checked exit, an exhaustive match that narrows, a
// subclass matched by its base's case, and a re-exported class matched under its
// alias. None of these is a forgery, and each one is a way the fix could have
// over-corrected.
func TestPinnedForkGenuineSelectionStillNarrowsAndRuns(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: `import { Missing as Relayed } from "./payments.sm"

export class NotFound extends Error {
    constructor(readonly key: string) { super("not found " + key); }
}

export class Timeout extends Error {
    constructor(readonly ms: number) { super("timeout"); }
}

export class FileError extends Error {
    constructor(readonly path: string) { super("file " + path); }
}

export class FileNotFound extends FileError {}

function load(key: string): Result<string, NotFound | Timeout> {
    if (key === "") throw new Timeout(3);
    if (key !== "ada") throw new NotFound(key);
    return "guest";
}

function exhaustive(key: string): string {
    return load(key).match({
        ok: (value) => value,
        error: (error) => error.match({
            NotFound: (failure) => "notfound:" + failure.key,
            Timeout: (failure) => "timeout:" + failure.ms,
        }),
    });
}

function byBase(error: FileError): string {
    return error.match({ FileError: (failure) => "file:" + failure.path });
}

function relayed(error: Relayed): string {
    return error.match({ Relayed: (failure) => "relayed:" + failure.key });
}

export function main(): string[] {
    return [
        exhaustive("ada"),
        exhaustive("zoe"),
        exhaustive(""),
        byBase(new FileNotFound("/x")),
        relayed(new Relayed("k")),
        ` + "`${new NotFound(\"k\").is(NotFound)}`" + `,
        ` + "`${new NotFound(\"k\").is(Timeout)}`" + `,
    ];
}
`},
		{Path: "payments.sm", Kind: FileKindSmithers, Text: `export class Missing extends Error {
    constructor(readonly key: string) { super("payments has no " + key); }
}
`},
	})
	requireCleanCompile(t, result)
	want := strings.Join([]string{
		"guest", "notfound:zoe", "timeout:3", "file:/x", "relayed:k", "true", "false",
	}, "\n")
	if got := runEmittedMain(t, result); got != want {
		t.Fatalf("main = %q, want %q", got, want)
	}
}

// ---------------------------------------------------------------------------
// The compiler-owned prelude is not part of the authoring surface
// ---------------------------------------------------------------------------

// specification/failures.mdx, "Compiler Lifting" (Locked). Every route an author
// has to the compiler's emitted prelude file, and to the Result variant
// constructors it exports. A Result the compiler did not construct at a checked
// exit has a failure channel that means nothing, so a program that hand-builds
// one must not compile.
func TestPinnedForkAuthoredSmithersCannotReachThePreludeByPath(t *testing.T) {
	for _, item := range []struct {
		name   string
		source string
	}{
		{name: "a direct import", source: `import { SmithersOk, SmithersErr } from "./__smithers_prelude.ts"
export function main(): string[] { return ["x"]; }
`},
		{name: "a renamed import", source: `import { SmithersOk as Ok } from "./__smithers_prelude.ts"
export function main(): string[] { return ["x"]; }
`},
		{name: "a namespace import", source: `import * as Prelude from "./__smithers_prelude.ts"
export function main(): string[] { return ["x"]; }
`},
		{name: "a re-export", source: `export { SmithersOk } from "./__smithers_prelude.ts"
export function main(): string[] { return ["x"]; }
`},
		{name: "a star re-export", source: `export * from "./__smithers_prelude.ts"
export function main(): string[] { return ["x"]; }
`},
		{name: "the emitted .js spelling", source: `import { SmithersOk } from "./__smithers_prelude.js"
export function main(): string[] { return ["x"]; }
`},
		{name: "a dynamic import", source: `export async function reach(): Promise<string> {
    const prelude = await import("./__smithers_prelude.ts");
    return typeof prelude;
}
export function main(): string[] { return ["x"]; }
`},
	} {
		t.Run(item.name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: item.source}})
			requireDiagnostic(t, result, "SMITHERS1510", "main.sm", "")
		})
	}
}

// The prelude is also reachable through the SANCTIONED compiler-owned module
// names, which the module-trust rule correctly does not charge — they are the
// language's own names for a compiler-owned module. What must not be reachable
// through them is the CONSTRUCTOR, which is what the Locked sentence names.
func TestPinnedForkAuthoredSmithersCannotReachTheResultConstructors(t *testing.T) {
	for _, item := range []struct {
		name   string
		source string
	}{
		{name: "through smthrs/context", source: `import { SmithersOk } from "smthrs/context"
export function main(): string[] { return ["x"]; }
`},
		{name: "through smthrs/provider", source: `import { SmithersErr } from "smthrs/provider"
export function main(): string[] { return ["x"]; }
`},
		{name: "through smithers:exceptions", source: `import { SmithersOk, SmithersErr } from "smithers:exceptions"
export function main(): string[] { return ["x"]; }
`},
		{name: "renamed", source: `import { SmithersOk as Ok } from "smithers:exceptions"
export function main(): string[] { return ["x"]; }
`},
		{name: "re-exported", source: `export { SmithersOk } from "smithers:exceptions"
export function main(): string[] { return ["x"]; }
`},
		{name: "through a namespace member read", source: `import * as Exceptions from "smithers:exceptions"
export function main(): string[] { return [typeof Exceptions.SmithersOk]; }
`},
	} {
		t.Run(item.name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: item.source}})
			requireDiagnostic(t, result, "SMITHERS1201", "main.sm", "compiler-owned Result constructor")
		})
	}

	// A `.sm` module in the middle of the chain does not launder the
	// constructor: the relay is refused where it names it.
	t.Run("through a re-export chain in a project module", func(t *testing.T) {
		result := compileInternalSource(t, []SourceFile{
			{Path: "main.sm", Kind: FileKindSmithers, Text: `import { SmithersOk } from "./relay.sm"
export function main(): string[] { return [typeof SmithersOk]; }
`},
			{Path: "relay.sm", Kind: FileKindSmithers, Text: `export { SmithersOk } from "smithers:exceptions"
`},
		})
		requireDiagnostic(t, result, "SMITHERS1201", "relay.sm", "compiler-owned Result constructor")
	})
}

// The over-correction guard. The compiler-owned modules must still hand authors
// exactly what the specification says they hand them, the prelude must still
// function for the compiler's own emitted code, and a local binding that merely
// SHARES a name with a compiler constructor is an ordinary value.
func TestPinnedForkCompilerOwnedModulesStillServeTheirAuthoringSurface(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"
import { panic, Panic } from "smithers:exceptions"

abstract class Clock extends Context {
    abstract now(): number;
}

class FixedClock extends Clock {
    now(): number { return 1700000000000; }
}

export class Missing extends Error {
    constructor(readonly key: string) { super("missing " + key); }
}

// An author's own binding that merely shares a compiler constructor's NAME.
class SmithersOk {
    constructor(readonly label: string) {}
}

function lookup(key: string): Result<string, Missing> {
    if (key !== "ada") throw new Missing(key);
    return "guest";
}

function stamp(): string {
    return "at:" + Clock.context().now();
}

function refuse(): string {
    panic("a defect");
}

export function main(): string[] {
    const found = lookup("ada").match({ ok: (value) => value, error: (error) => error.message });
    const missing = lookup("zoe").match({ ok: (value) => value, error: (error) => error.match({ Missing: (failure) => "missing:" + failure.key }) });
    const timed = Layer.provide(Layer.succeed(Clock, new FixedClock()), () => stamp());
    const defect = Result.try(() => refuse()).match({ ok: () => "no defect", error: (failure) => "defect:" + (failure instanceof Panic) });
    return [found, missing, timed, defect, new SmithersOk("mine").label];
}
`}})
	requireCleanCompile(t, result)
	want := strings.Join([]string{
		"guest", "missing:zoe", "at:1700000000000", "defect:true", "mine",
	}, "\n")
	if got := runEmittedMain(t, result); got != want {
		t.Fatalf("main = %q, want %q", got, want)
	}
}
