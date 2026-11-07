package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const defaultLiteralDeclarationsTarget = "FuzzServiceDefaultLiteralDeclarations"
const defaultLiteralDeclarationsQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

const defaultLiteralNativeClassQuote = "Use an equivalent native `Context.Service` class, retaining its key, eager initialization, cached identity, field and type reads, mutable shape members and missing-provider failure; otherwise refuse (VIP-9)."

func TestServiceDefaultLiteralDeclarationsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), defaultLiteralDeclarationsQuote) {
		t.Fatalf("chapter 7 no longer says %q; update the oracle", defaultLiteralDeclarationsQuote)
	}
	if !strings.Contains(SpecText("007-tooling.md"), defaultLiteralNativeClassQuote) {
		t.Fatalf("chapter 7 no longer says %q; update the reference", defaultLiteralNativeClassQuote)
	}
	TestServiceDefaultReadsQuoted(t)
}

var defaultLiteralKinds = []string{"number", "string", "boolean", "bigint", "null", "undefined", "union", "annotated-number", "wide-number", "symbol", "void", "never", "unknown"}

func defaultLiteralKeys() []string {
	var keys []string
	for _, form := range []string{"typeof", "indexed"} {
		for _, kind := range defaultLiteralKinds {
			keys = append(keys, form+"-"+kind)
		}
	}
	return keys
}

func defaultLiteralProject(key string, choice uint8) map[string]string {
	kind := strings.TrimPrefix(strings.TrimPrefix(key, "typeof-"), "indexed-")
	n := strconv.Itoa(1 + int(choice%20))
	shape, annotation, value, prefix := "number", "", n, ""
	switch kind {
	case "string":
		shape, value = "string", strconv.Quote("value"+n)
	case "boolean":
		shape, value = "boolean", strconv.FormatBool(choice&1 == 0)
	case "bigint":
		shape, value = "bigint", n+"n"
	case "null":
		shape, value = "string | null", "null"
	case "undefined":
		shape, value = "number | undefined", "undefined"
	case "union":
		annotation, value = ": 1 | 2", "seed"
		prefix = "const seed: 1 | 2 = 1\n"
	case "annotated-number":
		annotation = ": " + n
	case "wide-number":
		shape, annotation = "unknown", ": number"
	case "symbol":
		shape, annotation, value = "unknown", ": symbol", "Symbol.for(\"default-literal\")"
	case "void":
		shape, annotation, value = "unknown", ": void", "undefined"
	case "never":
		shape, annotation, value = "unknown", ": never", "stop()"
		prefix = "function stop(): never { while (true) {} }\n"
	case "unknown":
		shape, annotation = "any", ": unknown"
	}
	declaration := prefix + "export service Flags: " + shape + " { static readonly key = \"literal/Flags\"; static readonly default" + annotation + " = " + value + " }\n"
	read := "typeof Flags.default"
	if strings.HasPrefix(key, "indexed-") {
		read = "(typeof Flags)[\"default\"]"
	}
	if choice&2 != 0 {
		read = "(" + read + ")[]"
	}
	if choice&4 != 0 {
		read = "readonly [" + read + ", " + read + "]"
	}
	statement := "export type Read = " + read + "\n"
	if choice&1 != 0 {
		return map[string]string{"flags.vibe": declaration, "main.vibe": "import { Flags } from \"./flags.js\"\n" + statement}
	}
	return map[string]string{"main.vibe": strings.Replace(declaration, "export service Flags:", "service Flags:", 1) + statement}
}

// VIP-9 gives the native class as the preserving reference. The retired
// declaration can report EK0902 while remaining an EK4855 migration input;
// its erroneous checker type is not a declaration-output oracle.
func defaultLiteralNativeProject(t *testing.T, files map[string]string) map[string]string {
	t.Helper()
	native := maps.Clone(files)
	for name, source := range files {
		if !strings.Contains(source, "service Flags: ") {
			continue
		}
		prefix, body, ok := strings.Cut(source, "service Flags: ")
		if !ok {
			t.Fatal("missing legacy service")
		}
		shape, members, ok := strings.Cut(body, " { static readonly key = \"literal/Flags\"; ")
		if !ok {
			t.Fatal("missing legacy key")
		}
		native[name] = "import * as Context from \"effect/Context\"\n" + prefix +
			"class Flags extends Context.Service<Flags, " + shape + ">()(\"literal/Flags\") { " + members
	}
	return native
}

// The same type-only client reads each actual emitted package declaration.
// Chapter 7 promises that a repair preserves this surface, not only the
// producer checker's view of a static field. No declaration text is guessed.
func defaultLiteralPublishedType(t *testing.T, w *Workspace, emitted *Result, key string) (string, bool) {
	t.Helper()
	files := map[string]string{"main.vibe": "export type Read = import(\"./public/main.js\").Read\n"}
	for name, text := range emitted.Outputs {
		if strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.vibe.ts") {
			files["public/"+strings.TrimPrefix(name, "out/")] = text
		}
	}
	published := toolsCompile(t, w, defaultLiteralDeclarationsTarget, files)
	defer published.Remove()
	if !toolsErrorFree(published) {
		Gap(t, defaultLiteralDeclarationsTarget, "published:"+key, "declaration client errors: %v\n%s", SortedKeys(Keys(published.Dir, published.Diagnostics)), Archive(files))
		return "", false
	}
	return serviceDefaultReadType(t, published), true
}

func checkDefaultLiteralDeclaration(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	TestServiceDefaultLiteralDeclarationsQuoted(t)
	toolsGuard(t, defaultLiteralDeclarationsTarget, func() {
		files := defaultLiteralProject(key, choice)
		before := toolsCompile(t, w, defaultLiteralDeclarationsTarget, files)
		defer before.Remove()
		// Admit only the retired member diagnostic, never unrelated source
		// errors, and require the migration warning to remain observable.
		for _, d := range before.Diagnostics {
			if d.Category() == diagnostics.CategoryError && (!IsEK(d) || d.Code() != 902) {
				Gap(t, defaultLiteralDeclarationsTarget, "original:"+key, "unexpected migration input errors: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), Archive(files))
				return
			}
		}
		if serviceDefaultReadCodes(before, 902) > 1 || serviceDefaultReadCodes(before, 4855) != 1 {
			Gap(t, defaultLiteralDeclarationsTarget, "warning:"+key, "expected one cached-default warning and at most its retired-member error: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
			return
		}
		reference := toolsCompile(t, w, defaultLiteralDeclarationsTarget, defaultLiteralNativeProject(t, files))
		defer reference.Remove()
		if !toolsErrorFree(reference) {
			Gap(t, defaultLiteralDeclarationsTarget, "reference:"+key, "invalid native class reference: %v\n%s", SortedKeys(Keys(reference.Dir, reference.Diagnostics)), Archive(defaultLiteralNativeProject(t, files)))
			return
		}
		want := serviceDefaultReadType(t, reference)
		publishedBefore, ok := defaultLiteralPublishedType(t, w, reference, key)
		if !ok {
			return
		}
		if publishedBefore != want {
			Gap(t, defaultLiteralDeclarationsTarget, "original-declaration:"+key, "native reference type %s differs from its declaration %s\n%s", want, publishedBefore, Archive(files))
			return
		}
		options := vibelang.FixOptions{MigrationOnly: choice&32 != 0, CheckEachFix: choice&64 != 0}
		fix := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
		if _, exported := files["flags.vibe"]; exported {
			// VIP-9 permits an explained refusal when a public key's
			// native class cannot be rewritten with the same public API.
			explained := false
			for _, site := range fix.Sites {
				if site.Code == "EK4855" && site.Reason != "" {
					explained = true
				}
			}
			if fix.Err != nil || len(fix.Files) != 0 || !explained {
				Gap(t, defaultLiteralDeclarationsTarget, "exported:"+key, "exported key requires an unchanged, explained refusal: error=%v files=%v sites=%+v", fix.Err, fix.Order, fix.Sites)
			}
			return
		}
		if fix.Err != nil || len(fix.Refused) != 0 || len(fix.Files) == 0 {
			Gap(t, defaultLiteralDeclarationsTarget, "fix:"+key, "migration failed: %v refused %v\n%s", fix.Err, fix.Refused, Archive(files))
			return
		}
		fixed := maps.Clone(files)
		for name, file := range fix.Files {
			relative := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
			if _, own := fixed[relative]; !own {
				t.Fatalf("foreign migration write %s", relative)
			}
			fixed[relative] = file.Text
		}
		after := toolsCompile(t, w, defaultLiteralDeclarationsTarget, fixed)
		defer after.Remove()
		if !toolsErrorFree(after) || serviceDefaultReadCodes(after, 4855) != 0 {
			Gap(t, defaultLiteralDeclarationsTarget, "compile:"+key, "migration diagnostics: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), Archive(fixed))
			return
		}
		if got := serviceDefaultReadType(t, after); got != want {
			Gap(t, defaultLiteralDeclarationsTarget, "source-type:"+key, "type changed from %s to %s\n%s", want, got, Archive(fixed))
			return
		}
		publishedAfter, ok := defaultLiteralPublishedType(t, w, after, key)
		if !ok {
			return
		}
		if publishedAfter != publishedBefore {
			Gap(t, defaultLiteralDeclarationsTarget, "declaration:"+key, "%s\npublic Read changed from %s to %s\n%s\n%s", defaultLiteralDeclarationsQuote, publishedBefore, publishedAfter, Archive(files), Archive(fixed))
			return
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			Gap(t, defaultLiteralDeclarationsTarget, "fixed-point:"+key, "second migration changed %v, error %v", again.Order, again.Err)
			return
		}
		ExpectPending(t, defaultLiteralDeclarationsTarget, key)
	})
}

func TestServiceDefaultLiteralDeclarations(t *testing.T) {
	w := NewWorkspace(t)
	for _, key := range defaultLiteralKeys() {
		t.Run(key, func(t *testing.T) { checkDefaultLiteralDeclaration(t, w, key, 0) })
	}
	for _, input := range []struct {
		key    string
		choice uint8
	}{{"indexed-number", 3}, {"typeof-string", 36}, {"indexed-null", 64}} {
		t.Run(input.key+"/placement", func(t *testing.T) { checkDefaultLiteralDeclaration(t, w, input.key, input.choice) })
	}
}

func FuzzServiceDefaultLiteralDeclarations(f *testing.F) {
	startShortBudget(f)
	keys := defaultLiteralKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	f.Add("indexed-number", uint8(3))
	f.Add("typeof-string", uint8(36))
	f.Add("indexed-null", uint8(64))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		index := slices.Index(keys, key)
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(keys)
		}
		checkDefaultLiteralDeclaration(t, w, keys[index], choice)
	})
}
