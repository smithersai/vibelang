package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
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
		{"element", declarations + "export const value = <Box value={1} />;\n"},
		{"space-regexp", "const a = 1; export const value = a < /b/.source.length;\n"},
		{"joined-regexp", "const a = 1; export const value = a </b/.source.length;\n"},
		{"generic-comma", "export const id = <T,>(x: T) => x;\n"},
		{"generic-ambiguous", "export const id = <T>(x: T) => x;\n"},
		{"assertion", "export const value = <number>1;\n"},
		{"nullish-throw", declarations + "export function f(x: unknown) { return x ?? throw <Box/>; }\n"},
		{"import-plain", "export { value } from './component.js';\n"},
	}
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

// r4 ASTRA-1/2 and OPUS-2/3/4/6: native JSX grammar/options/output do not
// change under a .vibex rename. This deliberately tests no Effect syntax:
// each ordinary .tsx control is the identical spec-prescribed counterpart.
func FuzzVibexNativeParity(f *testing.F) {
	startShortBudget(f)
	shapes := vibexNativeShapes()
	modes := []string{"none", "preserve", "react-native", "react"}
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
		gapKey := shape.key + ":" + mode
		var reference *Result
		for _, native := range []bool{true, false} {
			extension := "vibex"
			if native {
				extension = "tsx"
			}
			file := "main." + extension
			files := map[string]string{file: shape.source}
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
			expected, actual := vibexNativeCodes(reference), vibexNativeCodes(result)
			if !slices.Equal(expected, actual) {
				Gap(t, vibexNativeTarget, gapKey, "VIP-39: identical native JSX source/options require codes %v; got %v\n%s", expected, actual, shape.source)
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
				// Ordinary JSX emission must preserve JSX in the same modes as .tsx.
				if shape.key == "element" && strings.Contains(nativeOutput, "<Box") != strings.Contains(vibeOutput, "<Box") {
					Gap(t, vibexNativeTarget, gapKey, "VIP-39: JSX preservation differs from native output under %s", mode)
				}
			}
		}
		ExpectPending(t, vibexNativeTarget, gapKey)
		ExpectPending(t, vibexNativeTarget, specCorpusKey(t))
	})
}
