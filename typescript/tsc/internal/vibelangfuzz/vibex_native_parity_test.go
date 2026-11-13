package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const vibexNativeTarget = "FuzzVibexNativeParity"

var vibexNativeQuotes = []string{
	"A project without `jsx` gets `.tsx`'s errors (TS17004 at the element, TS6142 at the import).",
	"`x.vibex` emits `x.jsx` under `\"jsx\": \"preserve\"` and `x.js` otherwise (`react-native` keeps JSX in `x.js`), as `x.tsx` does.",
	"No new `ScriptKind`, `LanguageVariant`, scanner mode or JSX parser.",
	"JSX errors keep their TypeScript codes; VibeLang errors keep their `EK` codes (VIP-34).",
}

func TestVibexNativeParityQuoted(t *testing.T) {
	chapter := SpecText("../vips/0039-vibex.md")
	for _, quote := range vibexNativeQuotes {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("VIP-39 no longer says %q; re-read native JSX parity before changing the oracle", quote)
		}
	}
}

type vibexNativeShape struct{ key, source string }

func vibexNativeShapes() []vibexNativeShape {
	declarations := "declare function Box(props: {value?: unknown}): any;\ndeclare function h(...args: any[]): any;\n"
	return []vibexNativeShape{
		{"plain", "export const value = 1;\n"},
		{"generator-argument", "import {Effect} from \"effect\"; function makeGenerator(){return function*(){yield* [];return 7}}; export const value=Effect.gen(makeGenerator());\n"},
		{"element", declarations + "export const value = <Box value={1} />;\n"},
		{"space-regexp", "const a = 1; export const value = a < /b/.source.length;\n"},
		{"joined-regexp", "const a = 1; export const value = a </b/.source.length;\n"},
		{"generic-comma", "export const id = <T,>(x: T) => x;\n"},
		{"generic-ambiguous", "export const id = <T>(x: T) => x;\n"},
		{"assertion", "export const value = <number>1;\n"},
		{"nullish-throw", declarations + "export async function f(x: unknown) { return x ?? throw <Box/>; }\n"},
		{"import-plain", "export { value } from './component.js';\n"},
	}
}

// VIP-41 specifies throw expressions in VibeLang; native TypeScript needs the
// equivalent IIFE. Comparing the proposal spelling directly with TSX would
// mistake TS1109 on unsupported native syntax for a VibeLang JSX defect.
func vibexNativeReferenceSource(shape vibexNativeShape) string {
	if shape.key == "nullish-throw" {
		return strings.Replace(shape.source, "throw <Box/>", "(() => { throw <Box/> })()", 1)
	}
	return shape.source
}

func vibexNativeConfig(file, mode string) string {
	options := map[string]any{
		"target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
		"strict": true, "skipLibCheck": true, "types": []string{}, "outDir": "out",
	}
	if mode != "none" {
		options["jsx"] = mode
	}
	if mode == "react" {
		options["jsxFactory"] = "h"
	}
	b, _ := json.Marshal(map[string]any{"compilerOptions": options, "files": []string{file}})
	return string(b)
}

func vibexNativeCodes(result *Result) []string {
	codes := []string{}
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Category().Name() == "error" {
			prefix := "TS"
			if IsEK(diagnostic) {
				prefix = "EK"
			}
			codes = append(codes, fmt.Sprintf("%s%d", prefix, diagnostic.Code()))
		}
	}
	slices.Sort(codes)
	return codes
}

// Identical native sources require the same error codes and source ranges.
func vibexNativeDiagnosticRanges(result *Result) []string {
	keys := []string{}
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Category().Name() == "error" {
			prefix := "TS"
			if IsEK(diagnostic) {
				prefix = "EK"
			}
			keys = append(keys, fmt.Sprintf("%s%d:%d:%d", prefix, diagnostic.Code(), diagnostic.Pos(), diagnostic.End()-diagnostic.Pos()))
		}
	}
	slices.Sort(keys)
	return keys
}

// Throw-expression controls use an IIFE, so their emitted text and diagnostic
// ranges differ intentionally. All byte-identical inputs use exact equality.
func vibexNativeOutputMatches(key, native, vibe string) bool {
	if native == "" || vibe == "" {
		return false
	}
	if key == "nullish-throw" {
		return strings.Contains(native, "<Box") == strings.Contains(vibe, "<Box")
	}
	return native == vibe
}

func TestVibexNativeOutputOracle(t *testing.T) {
	for _, row := range []struct{ key, native, mutant string }{
		{"space-regexp", "export const value = a < /b/.source.length;", "export const value = false;"},
		{"element", "h(Box, { value: 1 });", "otherFactory(Box, { value: 1 });"},
		{"element", "jsxDEV(Box, {}, void 0, false, source, this);", "jsxDEV(Box, {}, void 0, false);"},
		{"generator-argument", "Effect.gen(makeGenerator());", "Effect.gen(makeGenerator);"},
		{"plain", "export const value = 1;", ""},
	} {
		if !vibexNativeOutputMatches(row.key, row.native, row.native) {
			t.Fatalf("%s: identical output was rejected", row.key)
		}
		if vibexNativeOutputMatches(row.key, row.native, row.mutant) {
			t.Fatalf("%s: changed output escaped the oracle: %s", row.key, row.mutant)
		}
	}
	if !vibexNativeOutputMatches("nullish-throw", "x ?? (() => { throw <Box/>; })()", "x ?? throw <Box/>") ||
		vibexNativeOutputMatches("nullish-throw", "throw <Box/>", "throw h(Box, null)") {
		t.Fatal("rewritten throw control must retain JSX preservation")
	}
}

func TestVibexNativeDiagnosticOracle(t *testing.T) {
	result := func(pos, end int) *Result {
		return &Result{Diagnostics: []*ast.Diagnostic{
			ast.NewExternalDiagnostic(nil, core.NewTextRange(pos, end), "TS", diagnostics.CategoryError, 1005, "expected token"),
		}}
	}
	want := vibexNativeDiagnosticRanges(result(3, 5))
	for _, span := range [][2]int{{4, 6}, {3, 6}} {
		if slices.Equal(want, vibexNativeDiagnosticRanges(result(span[0], span[1]))) {
			t.Fatalf("changed diagnostic range escaped the oracle: %v", span)
		}
	}
}

// Native JSX grammar, options and output do not
// change under a .vibex rename. This deliberately tests no Effect syntax:
// each ordinary .tsx control is the identical spec-prescribed counterpart.
// Chapter 007 / vibex scanning, generic heads, JSX diagnostics and five emit modes match TSX: docs/design/src/007-tooling.md#afd1a269444d0083
// Chapter 007 / vibex scanning, generic heads, JSX diagnostics and five emit modes match TSX: docs/design/src/007-tooling.md#99f81eef65c3c2cd
// Chapter 007 / vibex scanning, generic heads, JSX diagnostics and five emit modes match TSX: docs/design/src/007-tooling.md#e5877b1243039358
// Chapter 007 / vibex scanning, generic heads, JSX diagnostics and five emit modes match TSX: docs/design/src/007-tooling.md#00e94dcb179b71b6
// Chapter 007 / vibex scanning, generic heads, JSX diagnostics and five emit modes match TSX: docs/design/src/007-tooling.md#5771f09901349387
// Chapter 007 / vibex scanning, generic heads, JSX diagnostics and five emit modes match TSX: docs/design/src/007-tooling.md#d8345352dc059dd5
// Chapter 007 / vibex scanning, generic heads, JSX diagnostics and five emit modes match TSX: docs/design/src/007-tooling.md#bbe0a85047d1be0a
// Chapter 007 / ordinary TSX syntax keeps native codes: docs/design/src/007-tooling.md#b493f68dc366ea9b

func FuzzVibexNativeParity(f *testing.F) {
	startShortBudget(f)
	shapes := vibexNativeShapes()
	modes := []string{"none", "preserve", "react-native", "react", "react-jsx", "react-jsxdev"}
	for _, shape := range shapes {
		for _, mode := range modes {
			f.Add(shape.key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key, mode string) {
		TestVibexNativeParityQuoted(t)
		index := slices.IndexFunc(shapes, func(shape vibexNativeShape) bool { return shape.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(shapes)
		}
		if !slices.Contains(modes, mode) {
			if mode == "" {
				return
			}
			mode = modes[int(mode[0])%len(modes)]
		}
		shape := shapes[index]
		if shape.key == "nullish-throw" {
			TestChapter007ThrowNativeReferenceQuoted(t)
		}
		if shape.key == "generator-argument" {
			TestChapter007GeneratorArgumentQuoted(t)
		}
		gapKey := shape.key + ":" + mode
		var reference *Result
		for _, native := range []bool{true, false} {
			extension := "vibex"
			if native {
				extension = "tsx"
			}
			file := "main." + extension
			source := shape.source
			if native {
				source = vibexNativeReferenceSource(shape)
			}
			files := map[string]string{file: source}
			if mode == "react-jsx" || mode == "react-jsxdev" {
				files["node_modules/react/package.json"] = "{\"name\":\"react\",\"types\":\"index.d.ts\"}"
				files["node_modules/react/jsx-runtime.d.ts"] = "export namespace JSX { type Element = any; interface IntrinsicElements { [key:string]: any } } export declare const jsx: any; export declare const jsxs: any; export declare const Fragment: any;\n"
				files["node_modules/react/jsx-dev-runtime.d.ts"] = "export * from './jsx-runtime.js'; export declare const jsxDEV: any;\n"
			}

			if shape.key == "import-plain" {
				files["component."+extension] = "export const value=1;\n"
			}
			var result *Result
			var err error
			within(t, "check native JSX parity", func() {
				result, err = w.Compile(t.Context(), Project{Files: files, Config: vibexNativeConfig(file, mode)})
			})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if native {
				reference = result
				continue
			}
			expected, actual := vibexNativeDiagnosticRanges(reference), vibexNativeDiagnosticRanges(result)
			if shape.key == "nullish-throw" {
				expected, actual = vibexNativeCodes(reference), vibexNativeCodes(result)
			}
			if !slices.Equal(expected, actual) {
				Gap(t, vibexNativeTarget, gapKey, "VIP-39: identical native JSX source/options require diagnostics %v; got %v\n%s", expected, actual, shape.source)
			}
			if len(expected) == 0 {
				suffix := "/main.js"
				if mode == "preserve" {
					suffix = "/main.jsx"
				}
				nativeOutput, vibeOutput := "", ""
				for path, output := range reference.Outputs {
					if strings.HasSuffix("/"+path, suffix) {
						nativeOutput = output
					}
				}
				for path, output := range result.Outputs {
					if strings.HasSuffix("/"+path, suffix) {
						vibeOutput = output
					}
				}
				if nativeOutput == "" {
					t.Fatal("native JSX control produced no expected output")
				}
				if vibeOutput == "" {
					Gap(t, vibexNativeTarget, gapKey, "VIP-39: expected output %s is missing", suffix)
				}
				if mode == "react-jsxdev" {
					// Native JSX development metadata names the actual input file.
					// Normalize only that generated literal, retaining every argument.
					nativeName := strconv.Quote(filepath.ToSlash(filepath.Join(reference.Dir, "main.tsx")))
					vibeName := strconv.Quote(filepath.ToSlash(filepath.Join(result.Dir, "main.vibex")))
					nativeOutput = strings.ReplaceAll(nativeOutput, nativeName, `"main.tsx"`)
					vibeOutput = strings.ReplaceAll(vibeOutput, vibeName, `"main.tsx"`)
				}
				if !vibexNativeOutputMatches(shape.key, nativeOutput, vibeOutput) {
					Gap(t, vibexNativeTarget, gapKey, "VIP-39: emitted text differs from native output under %s\nnative:\n%s\nvibex:\n%s", mode, nativeOutput, vibeOutput)
				}
			}
		}
		ExpectPending(t, vibexNativeTarget, gapKey)
		ExpectPending(t, vibexNativeTarget, specCorpusKey(t))
	})
}
