package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const writtenDeclarationTwinQuote = "Ordinary package declarations use the native twin’s relative specifiers:"
const writtenDeclarationSidecarQuote = "Compatibility sidecars instead keep VibeLang source references"

func writtenSourceDeclarationSpellingsQuoted(t testing.TB) {
	t.Helper()
	for _, quote := range []string{writtenDeclarationTwinQuote, writtenDeclarationSidecarQuote} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			t.Fatalf("chapter 1 no longer says %q", quote)
		}
	}
}

func TestWrittenSourceDeclarationSpellingsQuoted(t *testing.T) {
	writtenSourceDeclarationSpellingsQuoted(t)
}

// Check both declaration destinations against the TypeScript twin. The public
// output keeps the twin spelling; only the sidecar maps it to the source name.
func FuzzWrittenSourceDeclarationSpellings(f *testing.F) {
	startShortBudget(f)
	writtenSourceDeclarationSpellingsQuoted(f)
	for _, extension := range []string{"vibe", "vibex"} {
		for _, form := range []string{"reexport", "namespace", "import-type", "export-type", "inferred", "native-import"} {
			for _, mode := range []uint8{0, 1, 2, 3, 4, 5, 6, 7} {
				f.Add(extension+":"+form, mode)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		extension, form, _ := strings.Cut(key, ":")
		if extension != "vibe" && extension != "vibex" {
			extension = "vibe"
		}
		forms := map[string]string{
			"reexport":      "export { value } from %s;\n",
			"namespace":     "export * as model from %s;\n",
			"import-type":   "export type Value = import(%s).Value;\n",
			"export-type":   "export type { Value } from %s;\n",
			"native-import": "import type { Value } from %s; export type { Value as PublicValue };\n",
			"inferred":      "import { use } from %s; import { value } from \"./banners\"; export function read() { use(1); return { now: value() } };\n",
		}
		if _, ok := forms[form]; !ok {
			form = "reexport"
		}
		quote := "\""
		if mode&1 != 0 {
			quote = "'"
		}
		stem := "producer"
		if mode&4 != 0 {
			stem = "nested/producer"
		}
		twinExtension := "ts"
		if extension == "vibex" {
			twinExtension = "tsx"
		}
		written := "./" + stem + "." + extension
		twin := "./" + stem + "." + twinExtension
		compile := func(mainExtension, leafExtension, specifier string) *Result {
			config := fmt.Sprintf(
				"{\"compilerOptions\":{\"strict\":true,\"types\":[],\"skipLibCheck\":true,\"target\":\"ES2022\",\"module\":\"Preserve\",\"moduleResolution\":\"Bundler\",\"jsx\":\"preserve\",\"declaration\":true,\"emitDeclarationOnly\":true,\"allowImportingTsExtensions\":true,\"rewriteRelativeImportExtensions\":%t,\"rootDir\":\".\",\"outDir\":\"out\"},\"files\":[%q,%q]}",
				mode&2 != 0, "main."+mainExtension, stem+"."+leafExtension)
			leaf := "export const value = 1; export interface Value { readonly n: number }\n"
			files := map[string]string{
				"main." + mainExtension:    fmt.Sprintf(forms[form], quote+specifier+quote),
				stem + "." + leafExtension: leaf,
			}
			if form == "inferred" {
				// The bridge changes source language; the inferred public type
				// still originates in the same ordinary TypeScript module.
				files[stem+"."+leafExtension] = "export function use(value: number): number { return value; }\n"
				files["banners.ts"] = "import type { Value } from " + quote + "./" + stem + "-view" + quote + "; export declare function value(): Value;\n"
				files[stem+"-view.ts"] = "export interface Value { readonly n: number };\n"
			}
			result, err := w.Compile(t.Context(), Project{
				Files:  files,
				Config: config,
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(result.Remove)
			return result
		}
		native := compile("ts", twinExtension, twin)
		want, ok := native.Outputs["out/main.d.ts"]
		if HasError(native.Diagnostics) || !ok {
			t.Fatalf("invalid native control: %v; output %q", SortedKeys(Keys(native.Dir, native.Diagnostics)), want)
		}
		consumer := "vibe"
		if form == "inferred" || form == "native-import" {
			consumer = "ts"
		}
		vibe := compile(consumer, extension, written)
		got, emitted := vibe.Outputs["out/main.d.ts"]
		if HasError(vibe.Diagnostics) || !emitted || got != want {
			Gap(t, "FuzzWrittenSourceDeclarationSpellings", extension+":"+form+":public",
				"%s\nnative=%s\nvibe=%s\ndiagnostics=%v", writtenDeclarationTwinQuote, want, got, SortedKeys(Keys(vibe.Dir, vibe.Diagnostics)))
		}
		sidecar, count := "", 0
		result := vibe.Program.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
			if strings.HasSuffix(name, "/main.d.vibe.ts") {
				sidecar, count = text, count+1
			}
			return nil
		})
		wantSidecar := strings.ReplaceAll(want, twin, written)
		wantCount := 1
		if form == "inferred" || form == "native-import" {
			wantCount, wantSidecar = 0, ""
		}
		if count != wantCount || sidecar != wantSidecar || result != nil && HasError(result.Diagnostics) {
			Gap(t, "FuzzWrittenSourceDeclarationSpellings", extension+":"+form+":sidecar",
				"%s\ncount=%d\nwant=%s\ngot=%s", writtenDeclarationSidecarQuote, count, wantSidecar, sidecar)
		}
	})
}
