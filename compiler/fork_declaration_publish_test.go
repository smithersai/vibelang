package compiler

import (
	"context"
	"strings"
	"testing"
)

// The consumer receives the producer's declarations, never its authored or
// lowered source. The two runtime modules deliberately share the same output
// directory/prelude; this is not a claim of cross-runtime ABI compatibility.
func compilePublishedLibrary(t *testing.T, backend Compiler, ctx context.Context, source string, removeComments bool) CompileResult {
	t.Helper()
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"library.vibe"}, Lowering: LoweringInternal,
		Files:   []SourceFile{{Path: "library.vibe", Kind: FileKindVibeLang, Text: source}},
		Options: Options{"declaration": true, "declarationMap": true, "removeComments": removeComments},
	})
	if err != nil {
		t.Fatal(err)
	}
	requireClean(t, result)
	return result
}

func compilePublishedConsumer(t *testing.T, backend Compiler, ctx context.Context, producer CompileResult, source string, extraOptions ...Options) CompileResult {
	t.Helper()
	options := Options{"allowArbitraryExtensions": true}
	for _, extra := range extraOptions {
		for key, value := range extra {
			options[key] = value
		}
	}
	files := []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}
	for _, artifact := range producer.Artifacts {
		if strings.HasSuffix(artifact.Path, ".d.vibe.ts") {
			files = append(files, SourceFile{Path: artifact.Path, Kind: FileKindTypeScript, Text: string(artifact.Content)})
		}
	}
	if len(files) == 1 {
		t.Fatal("the producer emitted no VibeLang declarations")
	}
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.vibe"}, Lowering: LoweringInternal, Files: files,
		Options: options,
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func runPublishedConsumer(t *testing.T, producer, consumer CompileResult) string {
	t.Helper()
	requireClean(t, consumer)
	combined := consumer
	texts := artifactTextsByPath(t, consumer.Artifacts)
	for _, artifact := range producer.Artifacts {
		if existing, present := texts[artifact.Path]; present {
			if existing != string(artifact.Content) {
				t.Fatalf("producer and consumer disagree on shared artifact %q", artifact.Path)
			}
			continue
		}
		combined.Artifacts = append(combined.Artifacts, artifact)
	}
	combined.Artifacts = append(combined.Artifacts, Artifact{Path: "published-observation.js", Content: []byte(
		"import { main as observe } from './main.js'; const answer = await observe(); export function main() { return answer; }")})
	return runComptimeProgramNamed(t, combined, "published-observation.vibe")
}

const publishedContextSource = `import { Context } from "vibelang/context";
import { Layer } from "vibelang/provider";
export abstract class C extends Context { abstract value(): number }
`

func TestPinnedForkPublishesExecutableCallableContracts(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, vector := range []struct{ name, body, use string }{
		{"function", "export function read() { return C.context().value() }", "lib.read()"},
		{"arrow", "export const read = () => C.context().value();", "lib.read()"},
		{"function expression", "export const read = function() { return C.context().value() };", "lib.read()"},
		{"returned arrow", "export function factory() { return () => C.context().value() }", "lib.factory()()"},
		{"returned alias", "export function factory() { const read = () => C.context().value(); return read }", "lib.factory()()"},
		{"nested factory", "function inner() { return () => C.context().value() } export function factory() { return inner() }", "lib.factory()()"},
		{"object method", "export const api = { read() { return C.context().value() } };", "lib.api.read()"},
		{"nested object member", "export const api = { nested: { read: () => C.context().value() } };", "lib.api.nested.read()"},
		{"tuple element", "export const readers = [() => C.context().value()] as const;", "lib.readers[0]()"},
		{"returned object", "export function factory() { return { read() { return C.context().value() } } }", "lib.factory().read()"},
		{"instance method", "export class Service { read() { return C.context().value() } }", "new lib.Service().read()"},
		{"static method", "export class Service { static read() { return C.context().value() } }", "lib.Service.read()"},
		{"getter", "export class Service { get value() { return C.context().value() } }", "new lib.Service().value"},
		{"constructor", "export class Service { value: number; constructor() { this.value = C.context().value() } }", "new lib.Service().value"},
		{"overload", "export function read(x: number): number; export function read(x: string): number; export function read(x: number | string) { return C.context().value() + String(x).length }", "lib.read('')"},
		{"anonymous default factory", "export default function() { return () => C.context().value() }", "lib.default()()"},
		{"anonymous default arrow", "export default () => C.context().value();", "lib.default()"},
		{"anonymous default object", "export default { read() { return C.context().value() } };", "lib.default.read()"},
	} {
		t.Run(vector.name, func(t *testing.T) {
			producer := compilePublishedLibrary(t, backend, ctx, publishedContextSource+vector.body, false)
			declaration := artifactTextsByPath(t, producer.Artifacts)["library.d.vibe.ts"]
			for _, marker := range []string{"@vibelangModule", `"runtimeABI":"vibelang-go-eager@1"`, "@vibelangEffects", `"requirements":["C"]`, `"convention":"eager"`} {
				if !strings.Contains(declaration, marker) {
					t.Fatalf("missing published contract %q:\n%s", marker, declaration)
				}
			}
			unprovided := compilePublishedConsumer(t, backend, ctx, producer,
				"import * as lib from './library.vibe'; export const answer = "+vector.use+";")
			requireCode(t, unprovided, "VIBE2102", "C")
			if !unprovided.EmitSkipped || len(unprovided.Artifacts) != 0 {
				t.Fatal("a source-free unsatisfied requirement emitted code")
			}
			consumer := compilePublishedConsumer(t, backend, ctx, producer,
				"import * as lib from './library.vibe'; import { Layer } from 'vibelang/provider'; export function main() { return Layer.provide(Layer.succeed(lib.C, { value: () => 7 }), () => "+vector.use+"); }")
			if actual := runPublishedConsumer(t, producer, consumer); actual != "7" {
				t.Fatalf("the published callable computed %q, expected 7", actual)
			}
		})
	}
}

func TestPinnedForkPublishedContractsSurviveCommentRemoval(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	producer := compilePublishedLibrary(t, backend, ctx, publishedContextSource+
		"/** User documentation. */ export function factory() { return () => C.context().value() }", true)
	declaration := artifactTextsByPath(t, producer.Artifacts)["library.d.vibe.ts"]
	if strings.Contains(declaration, "User documentation") {
		t.Fatal("removeComments did not remove authored documentation")
	}
	result := compilePublishedConsumer(t, backend, ctx, producer,
		"import { factory } from './library.vibe'; const slot: () => number = factory(); export function main() { return slot() }")
	requireCode(t, result, "VIBE1808", "C")
}

func TestPinnedForkPublishesPrivateCapabilityIdentity(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	producer := compilePublishedLibrary(t, backend, ctx,
		strings.Replace(publishedContextSource, "export abstract class C", "abstract class C", 1)+`
export function read() { return C.context().value() }
export function provided() { return Layer.provide(Layer.succeed(C, { value: () => 7 }), read) }
`, false)
	declaration := artifactTextsByPath(t, producer.Artifacts)["library.d.vibe.ts"]
	if !strings.Contains(declaration, "typeof C") || !strings.Contains(declaration, "declare abstract class C") {
		t.Fatalf("private requirement constructor was lost:\n%s", declaration)
	}
	bad := compilePublishedConsumer(t, backend, ctx, producer,
		"import { read } from './library.vibe'; export const answer = read();")
	requireCode(t, bad, "VIBE2102", "C")
	good := compilePublishedConsumer(t, backend, ctx, producer,
		"import { provided } from './library.vibe'; export function main() { return provided() }")
	if actual := runPublishedConsumer(t, producer, good); actual != "7" {
		t.Fatalf("private capability provider computed %q", actual)
	}
}

func TestPinnedForkPublishesAllReturnedAlternatives(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	producer := compilePublishedLibrary(t, backend, ctx, publishedContextSource+`
export abstract class D extends Context { abstract value(): number }
export function factory(flag: boolean) {
    const first = () => C.context().value();
    const second = () => D.context().value();
    return flag ? first : second;
}
`, false)
	for _, name := range []string{"C", "D"} {
		consumer := compilePublishedConsumer(t, backend, ctx, producer,
			"import * as lib from './library.vibe'; import { Layer } from 'vibelang/provider'; export const answer = Layer.provide(Layer.succeed(lib."+name+", { value: () => 7 }), () => lib.factory(true)());")
		missing := "C"
		if name == "C" {
			missing = "D"
		}
		requireCode(t, consumer, "VIBE2101", missing)
	}
}

func TestPinnedForkPublishedMethodsDoNotShareNames(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	producer := compilePublishedLibrary(t, backend, ctx, publishedContextSource+`
export abstract class D extends Context { abstract value(): number }
export const first = { read() { return C.context().value() } };
export const second = { read() { return D.context().value() } };
`, false)
	for _, vector := range []struct{ key, member string }{{"C", "first"}, {"D", "second"}} {
		consumer := compilePublishedConsumer(t, backend, ctx, producer,
			"import * as lib from './library.vibe'; import { Layer } from 'vibelang/provider'; export function main() { return Layer.provide(Layer.succeed(lib."+vector.key+", { value: () => 7 }), () => lib."+vector.member+".read()); }")
		if actual := runPublishedConsumer(t, producer, consumer); actual != "7" {
			t.Fatalf("same-named method computed %q", actual)
		}
	}
}

func TestPinnedForkPublishedDeclarationMapsStayAuthored(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := publishedContextSource + "export function factory() { return () => C.context().value() }"
	producer := compilePublishedLibrary(t, backend, ctx, source, true)
	texts := artifactTextsByPath(t, producer.Artifacts)
	declaration := texts["library.d.vibe.ts"]
	_, points := decodeEmittedMap(t, texts["library.d.vibe.ts.map"])
	line, column := positionOf(t, declaration, "factory")
	authoredLine, authoredColumn := positionOf(t, source, "factory")
	if !hasMapping(points, line, column, authoredLine, authoredColumn) {
		t.Fatalf("metadata insertion lost the factory's authored mapping: generated %d:%d, authored %d:%d", line, column, authoredLine, authoredColumn)
	}
}

func TestPinnedForkPublishedResultsAndAsyncCallsExecute(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	producer := compilePublishedLibrary(t, backend, ctx, publishedContextSource+`
export class Boom extends Error {}
export function read(ok: boolean): Result<number, Boom> {
    if (!ok) throw new Boom("expected");
    return C.context().value();
}
function inferred(ok: boolean) {
    if (!ok) throw new Boom("inferred");
    return C.context().value();
}
export function fromInferred(ok: boolean): Result<number, Boom> { return inferred(ok)!; }
export async function readAsync(ok: boolean): Promise<Result<number, Boom>> {
    await Promise.resolve();
    return read(ok)!;
}
`, false)
	consumer := compilePublishedConsumer(t, backend, ctx, producer, `
import * as lib from "./library.vibe";
import { Layer } from "vibelang/provider";
export async function main(): Promise<string> {
    return await Layer.provide(Layer.succeed(lib.C, { value: () => 7 }), async () => {
        const first = lib.read(true).unwrapOr(-1);
        const second = (await lib.readAsync(true)).unwrapOr(-1);
        const third = lib.fromInferred(true).unwrapOr(-1);
        const failure = await lib.readAsync(false);
        return [first, second, third, failure.match({ ok: () => "wrong", error: e => String(e.is(lib.Boom)) })].join(",");
    });
}
`)
	if actual := runPublishedConsumer(t, producer, consumer); actual != "7,7,7,true" {
		t.Fatalf("published Result/Promise/nominal Error ABI computed %q", actual)
	}
}

func TestPinnedForkPublishedRuntimeIdentityIsRequired(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	producer := compilePublishedLibrary(t, backend, ctx, publishedContextSource+
		"export function read() { return C.context().value() }", false)
	for _, vector := range []struct{ name, old, replacement string }{
		{"different runtime ABI", `"runtimeABI":"vibelang-go-eager@1"`, `"runtimeABI":"vibelang-js@1"`},
		{"missing runtime ABI", `,"runtimeABI":"vibelang-go-eager@1"`, ""},
		{"unlinked runtime location", `"runtimes":["./__vibelang_prelude.js"]`, `"runtimes":["./unlinked.js"]`},
	} {
		t.Run(vector.name, func(t *testing.T) {
			altered := producer
			altered.Artifacts = append([]Artifact{}, producer.Artifacts...)
			for index := range altered.Artifacts {
				artifact := &altered.Artifacts[index]
				if artifact.Path == "library.d.vibe.ts" {
					text := string(artifact.Content)
					if !strings.Contains(text, vector.old) {
						t.Fatalf("missing ABI control %q in %s", vector.old, text)
					}
					artifact.Content = []byte(strings.Replace(text, vector.old, vector.replacement, 1))
				}
			}
			consumer := compilePublishedConsumer(t, backend, ctx, altered,
				"import { read } from './library.vibe'; export function main() { return read() }")
			requireCode(t, consumer, "VIBE1810", "published")
			if !consumer.EmitSkipped || len(consumer.Artifacts) != 0 {
				t.Fatal("an unlinked runtime contract emitted code")
			}
		})
	}
}

func TestPinnedForkPublishedNominalKeysCannotBeSubstituted(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	producer := compilePublishedLibrary(t, backend, ctx, publishedContextSource+
		"export function read() { return C.context().value() }", false)
	consumer := compilePublishedConsumer(t, backend, ctx, producer, `
import { read } from "./library.vibe";
import { Context } from "vibelang/context";
import { Layer } from "vibelang/provider";
abstract class C extends Context { abstract value(): number }
export const answer = Layer.provide(Layer.succeed(C, { value: () => 7 }), () => read());
`)
	requireCode(t, consumer, "VIBE2101", "C")
}

func TestPinnedForkRefusesUnpublishableLocalCapability(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"library.vibe"}, Lowering: LoweringInternal,
		Files: []SourceFile{{Path: "library.vibe", Kind: FileKindVibeLang, Text: `
import { Context } from "vibelang/context";
export function factory() {
    abstract class Local extends Context { abstract value(): number }
    return () => Local.context().value();
}
`}}, Options: Options{"declaration": true},
	})
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, result, "VIBE1810", "publishable nominal constructor")
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatal("an unpublishable nominal requirement emitted artifacts")
	}
}

func TestPinnedForkPublishesImportedFunctionValues(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	producer := compilePublishedLibrary(t, backend, ctx, publishedContextSource+
		"export function read() { return C.context().value() }", false)
	declaration := artifactTextsByPath(t, producer.Artifacts)["library.d.vibe.ts"]
	for _, vector := range []struct{ name, body, use string }{
		{"alias", "export const forwarded = read;", "forward.forwarded()"},
		{"container", "export const api = { read };", "forward.api.read()"},
		{"nested container", "export const api = { nested: { read } };", "forward.api.nested.read()"},
		{"same-name collision", `import { Context } from "vibelang/context"; abstract class C extends Context { abstract value(): number } export function local() { return C.context().value() } export const forwarded = read;`, "forward.forwarded()"},
		{"re-export", `export { read as forwarded } from "./library.vibe";`, "forward.forwarded()"},
	} {
		t.Run(vector.name, func(t *testing.T) {
			forward, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"forward.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{
					{Path: "library.d.vibe.ts", Kind: FileKindTypeScript, Text: declaration},
					{Path: "forward.vibe", Kind: FileKindVibeLang, Text: `import { read } from "./library.vibe"; ` + vector.body},
				}, Options: Options{"declaration": true, "allowArbitraryExtensions": true},
			})
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, forward)
			forward.Artifacts = append(forward.Artifacts, Artifact{Path: "library.d.vibe.ts", Content: []byte(declaration)})
			bad := compilePublishedConsumer(t, backend, ctx, forward,
				`import * as forward from "./forward.vibe"; export const answer = `+vector.use+";")
			requireCode(t, bad, "VIBE2102", "C")
			good := compilePublishedConsumer(t, backend, ctx, forward, `
import * as forward from "./forward.vibe";
import { C } from "./library.vibe";
import { Layer } from "vibelang/provider";
export function main() { return Layer.provide(Layer.succeed(C, { value: () => 7 }), () => `+vector.use+`); }
`)
			for _, artifact := range producer.Artifacts {
				if artifact.Path == "library.js" || artifact.Path == "library.js.map" {
					forward.Artifacts = append(forward.Artifacts, artifact)
				}
			}
			if actual := runPublishedConsumer(t, forward, good); actual != "7" {
				t.Fatalf("forwarded callable computed %q", actual)
			}
		})
	}
}

func TestPinnedForkRepublishesImportedCapabilityIdentity(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, private := range []bool{false, true} {
		source := publishedContextSource + "export function read() { return C.context().value() }"
		if private {
			source = strings.Replace(source, "export abstract class C", "abstract class C", 1)
		}
		producer := compilePublishedLibrary(t, backend, ctx, source, false)
		declaration := artifactTextsByPath(t, producer.Artifacts)["library.d.vibe.ts"]
		forward, err := backend.Compile(ctx, CompileRequest{
			RootNames: []string{"forward.vibe"}, Lowering: LoweringInternal,
			Files: []SourceFile{
				{Path: "library.d.vibe.ts", Kind: FileKindTypeScript, Text: declaration},
				{Path: "forward.vibe", Kind: FileKindVibeLang, Text: `import { read } from "./library.vibe"; export function forwarded() { return read() }`},
			}, Options: Options{"declaration": true, "allowArbitraryExtensions": true},
		})
		if err != nil {
			t.Fatal(err)
		}
		requireClean(t, forward)
		text := artifactTextsByPath(t, forward.Artifacts)["forward.d.vibe.ts"]
		if !strings.Contains(text, `import("./library.vibe").__vibelangRequirements["C"]`) {
			t.Fatalf("forwarding lost the original requirement table (private=%v):\n%s", private, text)
		}
		// Retain the source-free dependency, not any implementation source.
		forward.Artifacts = append(forward.Artifacts, Artifact{Path: "library.d.vibe.ts", Content: []byte(declaration)})
		bad := compilePublishedConsumer(t, backend, ctx, forward,
			`import { forwarded } from "./forward.vibe"; export const answer = forwarded();`)
		requireCode(t, bad, "VIBE2102", "C")
		if !private {
			consumer := compilePublishedConsumer(t, backend, ctx, forward, `
import { C } from "./library.vibe";
import { forwarded } from "./forward.vibe";
import { Layer } from "vibelang/provider";
export function main() { return Layer.provide(Layer.succeed(C, { value: () => 7 }), forwarded) }
`)
			for _, artifact := range producer.Artifacts {
				if artifact.Path == "library.js" || artifact.Path == "library.js.map" {
					forward.Artifacts = append(forward.Artifacts, artifact)
				}
			}
			if actual := runPublishedConsumer(t, forward, consumer); actual != "7" {
				t.Fatalf("source-free forwarded call computed %q", actual)
			}
		}
	}
}
