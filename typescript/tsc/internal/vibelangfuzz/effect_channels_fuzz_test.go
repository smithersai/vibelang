package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

const effectChannelsQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

// FuzzEffectChannelsDeclaration enforces Chapter 1, Declaration output: an
// effect function that runs some Effects declares the channels the Effect.fn
// that yields them declares. TypeScript reads those from the subtype-reduced
// union of the yielded Effects, so a program that runs both a failure alias
// and another alias of the same union declares one alias; this compares the
// compiler with itself on two inputs the sentence says agree (RULES.md 1). The
// input picks up to four runs. alchemy's AWS `syncTags` helpers run
// `tagResource` and `untagResource`, whose errors are two such aliases, and
// declared every member instead (corpus alchemy-aws-sync-tags). alchemy's
// kubernetes `waitForLoadBalancer` reads a hostname whose channel holds
// `Error` and throws `ServiceNotReady`, an `Error` subclass: Effect.fn's
// reduced union absorbs it into `Error`, and a `catch` arm on its tag then
// finds no such member (alchemy-63; corpus alchemy-k8s-service-not-ready,
// whose throw is an expression in alchemy-k8s-service-not-ready-expr). The
// AWS sites read through a .vibe function with a contract
// (alchemy-aws-contract-read-not-ready).
func FuzzEffectChannelsDeclaration(f *testing.F) {
	startShortBudget(f)
	effectChannelsChapter(f)
	for _, first := range effectChannelRuns {
		for _, second := range effectChannelRuns {
			f.Add([]byte("channels:" + first.name + ";" + second.name))
		}
	}
	f.Add([]byte("channels:quiet;tag;untag"))
	f.Add([]byte("channels:env-a;env-b;fail;read"))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckEffectChannels(t, w, parseEffectChannels(data))
	})
}

// TestEffectChannelsQuoted fails when Chapter 1 is reworded (RULES.md 9).
func TestEffectChannelsQuoted(t *testing.T) { effectChannelsChapter(t) }

func effectChannelsChapter(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(text), effectChannelsQuote) {
		tb.Fatalf("Chapter 1 no longer says %q", effectChannelsQuote)
	}
}

// An effectChannelRun is one statement of the body: as a .vibe statement and
// as the statement Effect.fn's generator yields. A throw in an effect body is
// `return yield* Effect.fail(...)`.
type effectChannelRun struct{ name, vibe, twin string }

var effectChannelRuns = []effectChannelRun{
	{"tag", "try tag()", "yield* tag()"},
	{"untag", "try untag()", "yield* untag()"},
	{"list", "try list()", "yield* list()"},
	{"read", "try read()", "yield* read()"},
	{"base", "try base()", "yield* base()"},
	{"derived", "try derived()", "yield* derived()"},
	{"env-a", "try envA()", "yield* envA()"},
	{"env-b", "try envB()", "yield* envB()"},
	{"fail", "if (n > 0) throw new A()", "if (n > 0) return yield* Effect.fail(new A())"},
	{"quiet", "try quiet(n)", "yield* quiet(n)"},
	{"host", "try hostname()", "yield* hostname()"},
	{"not-ready", "if (n > 1) throw new NotReady()", "if (n > 1) return yield* Effect.fail(new NotReady())"},
	{"not-ready-expr", "n > 2 ? n : throw new NotReady()", "n > 2 ? n : yield* Effect.fail(new NotReady())"},
	{"vibe-read", "try vibeRead()", "yield* vibeRead()"},
}

const effectChannelsLib = `import { Effect } from "effect"

export class A { readonly _tag = "A" }
export class B { readonly _tag = "B" }
export class C { readonly _tag = "C" }
export class Base { readonly code: number = 1 }
export class Derived extends Base { readonly detail: string = "" }
export class Cred { readonly cred = true }
export class Http { readonly http = true }
export type TagError = A | B
export type UntagError = A | B
export type ListError = A | B | C
export type EnvA = Cred | Http
export type EnvB = Cred | Http
export declare const tag: () => Effect.Effect<void, TagError>
export declare const untag: () => Effect.Effect<void, UntagError>
export declare const list: () => Effect.Effect<void, ListError>
export declare const read: () => Effect.Effect<number, UntagError>
export declare const base: () => Effect.Effect<void, Base>
export declare const derived: () => Effect.Effect<number, Derived>
export declare const envA: () => Effect.Effect<void, TagError, EnvA>
export declare const envB: () => Effect.Effect<void, UntagError, EnvB>
export class ApiError extends Error { readonly _tag = "ApiError"; readonly status: number = 503 }
export class NotReady extends Error { readonly _tag = "NotReady" }
export declare const hostname: () => Effect.Effect<string | undefined, Error | ApiError>
`

const effectChannelsImports = `import { A, ApiError, base, derived, envA, envB, hostname, list, NotReady, read, tag, untag } from "./lib.js"
`

// parseEffectChannels reads `channels:<run>;<run>…` (RULES.md 11), and
// otherwise picks up to four runs from the bytes.
func parseEffectChannels(data []byte) []effectChannelRun {
	var runs []effectChannelRun
	if rest, ok := strings.CutPrefix(string(data), "channels:"); ok {
		for _, name := range strings.Split(rest, ";") {
			for _, run := range effectChannelRuns {
				if run.name == name && len(runs) < 4 {
					runs = append(runs, run)
				}
			}
		}
		return runs
	}
	for i := 0; i < len(data) && i < 4; i++ {
		runs = append(runs, effectChannelRuns[int(data[i])%len(effectChannelRuns)])
	}
	return runs
}

const effectChannelsConfig = `{"compilerOptions":{"target":"ES2022","lib":["esnext"],"module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["lib.ts","%s"]}`

// CheckEffectChannels compares what main.vibe and its Effect.fn twin declare.
func CheckEffectChannels(t *testing.T, w *Workspace, runs []effectChannelRun) {
	const target = "FuzzEffectChannelsDeclaration"
	defer recoverCompilerPanic(t, target)
	if len(runs) == 0 {
		return
	}
	vibe, twin := []string{effectChannelsImports, "const quiet = effect (n: number) => n\n\neffect function vibeRead(): (string | undefined)!(Error | ApiError)! { return undefined }\n\nexport const program = effect (n: number) => {\n"}, []string{"import { Effect } from \"effect\"\n", effectChannelsImports, "const quiet = Effect.fn(function* (n: number) {\n  return n\n})\n\nconst vibeRead = (): Effect.Effect<string | undefined, Error | ApiError> => Effect.succeed(undefined)\n\nexport const program = Effect.fn(function* (n: number) {\n"}
	for _, run := range runs {
		vibe = append(vibe, "  "+run.vibe+"\n")
		twin = append(twin, "  "+run.twin+"\n")
	}
	vibeText, twinText := strings.Join(vibe, "")+"}\n", strings.Join(twin, "")+"})\n"
	g := &Gaps{Target: target, Input: vibeText}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	declared := func(name, text string) (string, []string) {
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"package.json": `{"type":"module"}`, "lib.ts": effectChannelsLib, name: text}, Config: fmt.Sprintf(effectChannelsConfig, name)})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var errors []string
		for _, d := range r.Diagnostics {
			if d.Category().Name() == "error" {
				errors = append(errors, fmt.Sprintf("%s%d", d.Source(), d.Code()))
			}
		}
		var lines []string
		for _, line := range strings.Split(r.Outputs["out/main.d.ts"], "\n") {
			if strings.HasPrefix(line, "export declare const program") {
				lines = append(lines, line)
			}
		}
		return strings.Join(lines, "\n"), errors
	}
	vibeDeclares, vibeErrors := declared("main.vibe", vibeText)
	twinDeclares, twinErrors := declared("main.ts", twinText)
	switch {
	case len(twinErrors) != 0:
		t.Fatalf("the twin must compile: %v\n%s", twinErrors, twinText)
	case len(vibeErrors) != 0:
		g.Add("feature:effect-channels-compile", "%v\n%s", vibeErrors, vibeText)
	case vibeDeclares != twinDeclares:
		// An unannotated .vibe callee adds its channels but no run: its
		// success is the type being inferred, so it adds no candidate to
		// compare (feature:effect-channels:vibe-callee).
		key := "feature:effect-channels"
		if slices.ContainsFunc(runs, func(run effectChannelRun) bool { return run.name == "quiet" }) {
			key += ":vibe-callee"
		}
		g.Add(key, "Chapter 1: %q.\n.vibe:  %s\ntwin:   %s\n%s", effectChannelsQuote, vibeDeclares, twinDeclares, vibeText)
	}
	g.FinishInput(t, key)
}
