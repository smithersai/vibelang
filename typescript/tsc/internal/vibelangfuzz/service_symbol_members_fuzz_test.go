package vibelangfuzz

import (
	"maps"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceShapeMembersQuote = "\x60Users.Shape\x60 is the members, the type an implementation has; Effect writes it \x60Context.Service.Shape<typeof Users>\x60"

func serviceShapeMembersChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), serviceShapeMembersQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceShapeMembersQuote)
	}
}

func TestServiceSymbolMembersQuoted(t *testing.T) { serviceShapeMembersChapter(t) }

// FuzzServiceSymbolMembers compares a service whose member has a symbol key
// with its Effect TypeScript counterpart: chapter 5 gives both the same
// implementation type, so a complete, an incomplete and a mistyped
// implementation report the same error codes against either. The comparison
// is the compiler with itself on two programs the chapter equates.
func FuzzServiceSymbolMembers(f *testing.F) {
	startShortBudget(f)
	serviceShapeMembersChapter(f)
	type probe struct{ key, native, custom string }
	var probes []probe
	for _, member := range []struct{ key, prelude, signature, name, value string }{
		{"iterator-method", "", "[Symbol.iterator]():Iterator<number>", "[Symbol.iterator]", "null as never"},
		{"tag-property", "", "[Symbol.toStringTag]:string", "[Symbol.toStringTag]", "\"S\""},
		{"unique-const", "const tag:unique symbol=Symbol(\"tag\");", "[tag]:number", "[tag]", "1"},
		{"optional-property", "", "[Symbol.asyncIterator]?:()=>AsyncIterator<number>", "[Symbol.asyncIterator]", "undefined"},
	} {
		for _, implementation := range []struct{ key, entry string }{
			{"complete", "," + member.name + ":" + member.value},
			{"missing", ""},
			{"mistyped", "," + member.name + ":false"},
		} {
			native := "import * as Context from \"effect/Context\";" + member.prelude + "type Shape={value:number;" + member.signature + "};export class S extends Context.Service<S,Shape>()(\"fuzz/S\"){};export const implementation:Context.Service.Shape<typeof S>={value:1" + implementation.entry + "}"
			custom := member.prelude + "export service S {static readonly key=\"fuzz/S\";value:number;" + member.signature + "};export const implementation:S.Shape={value:1" + implementation.entry + "}"
			p := probe{member.key + "/" + implementation.key, native, custom}
			probes = append(probes, p)
			f.Add([]byte(p.key + "\x00\x00"))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		selected := 0
		if len(data) > 0 {
			selected = int(data[0]) % len(probes)
		}
		parts := strings.SplitN(string(data), "\x00", 2)
		for i, p := range probes {
			if parts[0] == p.key {
				selected = i
				break
			}
		}
		p := probes[selected]
		var variant byte
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		compile := func(source, file string) map[int32]int {
			if variant&1 != 0 {
				source = "// retained trivia\r\n" + strings.ReplaceAll(source, ";", ";\r\n")
			}
			if variant&2 != 0 {
				source = strings.ReplaceAll(source, "\"", "'")
			}
			config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":[\"" + file + "\"]}"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			got := map[int32]int{}
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					got[d.Code()]++
				}
			}
			return got
		}
		native, custom := compile(p.native, "main.ts"), compile(p.custom, "main.vibe")
		if strings.HasSuffix(p.key, "/complete") && len(native) != 0 {
			Gap(t, "FuzzServiceSymbolMembers", "native:"+p.key, "chapter 5: %s; the Effect counterpart of a complete implementation reports %v\n%s", serviceShapeMembersQuote, native, p.native)
			return
		}
		if !maps.Equal(native, custom) {
			Gap(t, "FuzzServiceSymbolMembers", "shape:"+p.key, "chapter 5: %s; Effect counterpart reports %v, service reports %v\n%s", serviceShapeMembersQuote, native, custom, p.custom)
			return
		}
		ExpectPending(t, "FuzzServiceSymbolMembers", "native:"+p.key)
		ExpectPending(t, "FuzzServiceSymbolMembers", "shape:"+p.key)
		ExpectPending(t, "FuzzServiceSymbolMembers", specCorpusKey(t))
	})
}
