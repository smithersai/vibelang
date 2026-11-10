package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceDeclarationMergeQuote = "the compiler declares `Users.Shape` as a direct alias of the written member object"
const serviceDeclarationMergeNativeQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."

func serviceDeclarationMergeQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	native, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(native), serviceDeclarationMergeNativeQuote) {
		t.Fatalf("chapter 7 no longer says %q", serviceDeclarationMergeNativeQuote)
	}
	if !strings.Contains(string(text), serviceDeclarationMergeQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceDeclarationMergeQuote)
	}
}

func TestServiceDeclarationMergeQuoted(t *testing.T) { serviceDeclarationMergeQuoted(t) }

// A namespace or interface merged with a service, as one merges with a
// class, leaves Users.Shape the written member object: a namespace keeps its
// own members beside Shape, an interface declares members of the identifier
// only. A generated alias also participates in native name collisions.
func FuzzServiceDeclarationMerge(f *testing.F) {
	startShortBudget(f)
	serviceDeclarationMergeQuoted(f)
	keys := []string{"namespace", "namespace-layer", "declare-namespace", "namespace-shape", "namespace-shape-rejects", "namespace-rejects-own", "interface", "interface-local", "both", "written-namespace", "namespace-before", "namespace-shape-value", "namespace-shape-function", "namespace-shape-recursive", "namespace-shape-alias", "namespace-shape-alias-chain", "namespace-shape-namespace"}
	for _, key := range keys {
		f.Add([]byte(key))
		for variant := byte(0); variant < 4; variant++ {
			f.Add(append([]byte(key+"\x00"), variant))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			key = keys[len(data)%len(keys)]
		}
		variant := byte(len(data))
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		const service = "service S { static readonly key = \"merge/S\"; n: number }\n"
		extra := ""
		if variant&2 != 0 {
			extra = " export const extra = 2;"
		}
		companion, use, allowed := "", "", []int32(nil)
		switch key {
		case "namespace":
			companion = "namespace S {" + extra + " export const x = 1 }\n"
			use = "const impl: S.Shape = { n: 1 }; const x: number = S.x\n"
		case "namespace-layer":
			companion = "namespace S {" + extra + " export const Live = Layer.succeed(S, { n: 1 }); export const impl: S.Shape = { n: 2 } }\n"
			use = "effect function read() { provide S.Live { return (try S).n + S.impl.n } }\nconst r = read\n"
		case "declare-namespace":
			companion = "declare namespace S { const x: number }\n"
			use = "const impl: S.Shape = { n: 1 }; const x: number = S.x\n"
		case "namespace-shape":
			companion = "namespace S {" + extra + " export type Shape = { z: number } }\n"
			use = "const impl: S.Shape = { z: 1 }\n"
			allowed = []int32{2300, 2353}
		case "namespace-shape-rejects":
			companion = "namespace S {" + extra + " export type Shape = { z: number } }\n"
			use = "const impl: S.Shape = { n: 1 }\n"
			allowed = []int32{2300}
		case "namespace-rejects-own":
			companion = "namespace S {" + extra + " export const x = 1 }\n"
			use = "const impl: S.Shape = { x: 1 }\n"
			allowed = []int32{2353}
		case "interface":
			companion = "interface S { extra: string }\n"
			use = "const impl: S.Shape = { n: 1 }; const viaEffect: Context.Service.Shape<typeof S> = { n: 1 }\n"
		case "interface-local":
			companion = ""
			use = "function f() { " + strings.TrimSuffix(service, "\n") + "; interface S { extra: string }; const impl: Context.Service.Shape<typeof S> = { n: 1 }; return impl }\nconst g = f\n"
		case "both":
			companion = "interface S { extra: string }\nnamespace S {" + extra + " export const x = 1 }\n"
			use = "const impl: S.Shape = { n: 1 }; const x: number = S.x\n"
		case "written-namespace":
			companion = "namespace S {" + extra + " export const x = 1 }\n"
			use = "const impl: Context.Service.Shape<typeof S> = { value: \"a\" }; const x: number = S.x\n"
		case "namespace-shape-value":
			companion = "namespace S {" + extra + " export const Shape = 1 }\n"
			use = "const impl: S.Shape = { n: 1 }; const value: number = S.Shape; const query: typeof S.Shape = 1\n"
		case "namespace-shape-function":
			companion = "namespace S {" + extra + " export function Shape() { return 1 } }\n"
			use = "const impl: S.Shape = { n: 1 }; const value: number = S.Shape(); const query: ReturnType<typeof S.Shape> = 1\n"
		case "namespace-shape-recursive":
			companion = "namespace S {" + extra + " export const Shape = 1 }\n"
			use = "const impl: S.Shape = { n: 1, peer: { n: 2 } }; const query: typeof S.Shape = 1\n"
		case "namespace-shape-alias":
			companion = "namespace Values { export const value = 1 }\nnamespace S {" + extra + " export import Shape = Values.value }\n"
			use = "const impl: S.Shape = { n: 1 }; const value: number = S.Shape; const query: typeof S.Shape = 1\n"
		case "namespace-shape-alias-chain":
			companion = "namespace Values { export const value = 1 }\nnamespace Aliases { export import value = Values.value }\nnamespace S {" + extra + " export import Shape = Aliases.value }\n"
			use = "const impl: S.Shape = { n: 1 }; const value: number = S.Shape; const query: typeof S.Shape = 1\n"
		case "namespace-shape-namespace":
			companion = "namespace S {" + extra + " export namespace Shape { export const value = 1 } }\n"
			use = "const impl: S.Shape = { n: 1 }; const value: number = S.Shape.value; const query: typeof S.Shape = S.Shape\n"
		case "namespace-before":
			companion = "namespace S {" + extra + " export const x = 1 }\n"
			use = "const impl: S.Shape = { n: 1 }\n"
			allowed = []int32{2434} // TypeScript: a namespace cannot precede the class it merges with
		}
		var source string
		switch key {
		case "interface-local":
			source = use
		case "written-namespace":
			source = "service S: { value: string } { static readonly key = \"merge/S\" }\n" + companion + use
		case "namespace-before":
			source = companion + service + use
		default:
			source = service + companion + use
		}
		if key == "namespace-shape-recursive" {
			source = strings.Replace(source, "n: number }", "n: number; peer?: S.Shape }", 1)
		}
		if variant&1 != 0 && key != "interface-local" {
			lines := strings.Split(source, "\n")
			for i, line := range lines {
				if strings.HasPrefix(line, "service S") || strings.HasPrefix(line, "namespace S") ||
					strings.HasPrefix(line, "declare namespace S") || strings.HasPrefix(line, "interface S") {
					lines[i] = "export " + line
				}
			}
			source = strings.Join(lines, "\n")
		}
		source += "export {}\n"
		r, err := w.Compile(t.Context(), Project{Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]},"files":["main.vibe"]}`, Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var seen []int32
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if slices.Contains(allowed, d.Code()) {
				seen = append(seen, d.Code())
				continue
			}
			Gap(t, "FuzzServiceDeclarationMerge", key, "%s; merged declaration rejected: %s\n%s", serviceDeclarationMergeQuote, d.String(), source)
			return
		}
		for _, code := range allowed {
			if !slices.Contains(seen, code) {
				Gap(t, "FuzzServiceDeclarationMerge", key, "%s; expected TypeScript's TS%d\n%s", serviceDeclarationMergeQuote, code, source)
				return
			}
		}
		ExpectPending(t, "FuzzServiceDeclarationMerge", key)
		ExpectPending(t, "FuzzServiceDeclarationMerge", specCorpusKey(t))
	})
}
