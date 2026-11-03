package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const platformBoundaryTarget = "FuzzPlatformBoundaryHomes"

var platformBoundaryQuotes = []string{
	"anywhere: in plain and `async` functions, and inside `Effect.try` and `tryPromise` arrows too",
	"A wrapper changes how a failure is represented, not whether the platform may be called.",
	"A property on an unrelated object, such as `client.fetch` or `client.timeout`, is a different symbol.",
	"A local binding, an import or an Effect module in scope (`Option`, `FileSystem`, `Headers`, `Worker`) shadows the global first",
	"| a statically named value that reaches the platform (rule below) anywhere in a `.vibe` file, including inside `Effect.try` and `tryPromise` arrows.",
}

func platformBoundaryHomesQuoted(t testing.TB) {
	t.Helper()
	chapter := SpecText("005-services.md")
	for _, quote := range platformBoundaryQuotes {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 5 no longer says %q; re-read VIP-33 before changing the platform-boundary oracle", quote)
		}
	}
}

func TestPlatformBoundaryHomesQuoted(t *testing.T) { platformBoundaryHomesQuoted(t) }

type platformBoundaryShape struct {
	name, member, result, local string
}

var platformBoundaryShapes = []platformBoundaryShape{
	{"window", ".location.origin", "string", "{ location: { origin: \"local\" } }"},
	{"document", ".title", "string", "{ title: \"local\" }"},
	{"crypto", ".getRandomValues(new Uint8Array(2))", "Uint8Array", "{ getRandomValues: (bytes: Uint8Array): Uint8Array => bytes }"},
}

var platformBoundaryAccesses = []string{"identifier", "dot", "bracket"}
var platformBoundaryHomes = []string{"function", "arrow", "async", "effect-wrapper", "promise-wrapper", "options-wrapper", "sync-wrapper", "callback-wrapper"}

func platformBoundaryKeys() []string {
	var keys []string
	for _, shape := range platformBoundaryShapes {
		for _, access := range platformBoundaryAccesses {
			for _, home := range platformBoundaryHomes {
				// Crypto's EK4403 retirement is a separate pending class.
				if shape.name == "crypto" && home != "function" && home != "arrow" && home != "async" && home != "effect-wrapper" {
					continue
				}
				for _, binding := range []string{"global", "local"} {
					keys = append(keys, strings.Join([]string{shape.name, access, home, binding}, ":"))
				}
			}
		}
	}
	return keys
}

func platformBoundarySource(key string, native bool) string {
	parts := strings.Split(key, ":")
	shape := platformBoundaryShapes[slices.IndexFunc(platformBoundaryShapes, func(s platformBoundaryShape) bool { return s.name == parts[0] })]
	access, home, local := parts[1], parts[2], parts[3] == "local"
	prefix := "import { Effect } from \"effect\";\n"
	object := "globalThis"
	if local {
		if access == "identifier" {
			prefix += "const " + shape.name + " = " + shape.local + ";\n"
		} else {
			prefix += "const client = { " + shape.name + ": " + shape.local + " };\n"
			object = "client"
		}
	}
	value := shape.name
	if access == "dot" {
		value = object + "." + shape.name
	} else if access == "bracket" {
		value = object + "[\"" + shape.name + "\"]"
	}
	expression := value + shape.member
	switch home {
	case "function":
		return prefix + "export function probe(): " + shape.result + " { return " + expression + "; }\n"
	case "arrow":
		return prefix + "export const probe = (): " + shape.result + " => " + expression + ";\n"
	case "async":
		return prefix + "export async function probe(): Promise<" + shape.result + "> { return " + expression + "; }\n"
	case "promise-wrapper", "options-wrapper", "sync-wrapper", "callback-wrapper":
		wrapped := ""
		switch home {
		case "promise-wrapper":
			wrapped = "Effect.tryPromise(async () => " + expression + ")"
		case "options-wrapper":
			wrapped = "Effect.try({ try: () => " + expression + ", catch: (e) => e })"
		case "sync-wrapper":
			wrapped = "Effect.sync(() => " + expression + ")"
		case "callback-wrapper":
			wrapped = "Effect.callback<" + shape.result + ">((resume) => { const value = " + expression + "; resume(Effect.succeed(value)); })"
		}
		if native {
			return prefix + "export function probe() { return " + wrapped + "; }\n"
		}
		return prefix + "export effect function probe() { return try " + wrapped + "; }\n"
	case "effect-wrapper":
		if native {
			return prefix + "export function probe() { return Effect.try(() => " + expression + "); }\n"
		}
		return prefix + "export effect function probe() { return try Effect.try(() => " + expression + "); }\n"
	default:
		panic("unknown platform-boundary home")
	}
}

// VIP-33 bans the resolved host value in every callable home, including
// wrapper arrows. The identically spelled field of a local object is a
// mandatory passing control. These admission checks do not change a caller's
// synchronous API or replace it with a service; runtime semantics remain in
// FuzzVIPDifferential. The window/crypto sources are the minimized T3Code
// synchronous-browser and secure-random API findings.
func FuzzPlatformBoundaryHomes(f *testing.F) {
	// Spec rule: docs/design/src/005-services.md#6025b09c021107b2
	// Chapter 005: native TS escape, builtin imports, static aliases, erased type positions and all source callable homes (FuzzPlatformBoundaryHomes).

	// Spec rule: docs/design/src/005-services.md#d16476dbfa1d6895
	// Chapter 005: native TS escape, builtin imports, static aliases, erased type positions and all source callable homes (FuzzPlatformBoundaryHomes).

	// Spec rule: docs/design/src/005-services.md#c0a9d54075654004
	// Chapter 005: native TS escape, builtin imports, static aliases, erased type positions and all source callable homes (FuzzPlatformBoundaryHomes).

	// Spec rule: docs/design/src/005-services.md#4e7cb9db2be5615c
	// Chapter 005: native TS escape, builtin imports, static aliases, erased type positions and all source callable homes (FuzzPlatformBoundaryHomes).

	// Spec rule: docs/design/src/005-services.md#9cef79a7fc6bf1bf
	// Chapter 005: native TS escape, builtin imports, static aliases, erased type positions and all source callable homes (FuzzPlatformBoundaryHomes).

	// Spec rule: docs/design/src/005-services.md#132ea3896834f46b
	// Chapter 005: native TS escape, builtin imports, static aliases, erased type positions and all source callable homes (FuzzPlatformBoundaryHomes).

	// Spec rule: docs/design/src/005-services.md#d0fc5f4fdfe85af1
	// Chapter 005: native TS escape, builtin imports, static aliases, erased type positions and all source callable homes (FuzzPlatformBoundaryHomes).

	// Spec rule: docs/design/src/005-services.md#799326c177f5b6d6
	// Chapter 005: native TS escape, builtin imports, static aliases, erased type positions and all source callable homes (FuzzPlatformBoundaryHomes).

	// Spec rule: docs/design/src/005-services.md#3188434136b87337
	// Chapter 005: native TS escape, builtin imports, static aliases, erased type positions and all source callable homes (FuzzPlatformBoundaryHomes).

	// Spec rule: docs/design/src/001-functions.md#d0cf0636327eb955
	// Chapter 001: fetch is forbidden in the ordinary, Effect, try and tryPromise source homes (FuzzPlatformBoundaryHomes).

	startShortBudget(f)
	platformBoundaryHomesQuoted(f)
	keys := platformBoundaryKeys()
	for _, key := range keys {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		banned := strings.HasSuffix(key, ":global")
		for _, native := range []bool{true, false} {
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			source := platformBoundarySource(key, native)
			project := Project{
				Files:  map[string]string{file: source, "package.json": "{\"type\":\"module\"}"},
				Config: fmt.Sprintf("{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":true,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"types\":[],\"lib\":[\"ES2022\",\"DOM\"],\"outDir\":\"out\"},\"files\":[%q]}", file),
			}
			var result *Result
			var err error
			within(t, "check platform boundary", func() { result, err = w.Compile(t.Context(), project) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if native {
				if HasError(result.Diagnostics) {
					t.Fatalf("invalid native platform/shadow control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
				}
				continue
			}
			reported := slices.ContainsFunc(result.Diagnostics, func(diagnostic *ast.Diagnostic) bool { return IsEK(diagnostic) && diagnostic.Code() == 4402 })
			if reported != banned || !banned && HasError(result.Diagnostics) {
				Gap(t, platformBoundaryTarget, key, "VIP-33: host=%t expects EK4402=%t in this callable home; local controls compile without errors; got %v\n%s", banned, banned, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
		}
		ExpectPending(t, platformBoundaryTarget, key)
		ExpectPending(t, platformBoundaryTarget, specCorpusKey(t))
	})
}
