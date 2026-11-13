package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"maps"
	"os"
	"strings"
	"testing"
)

const serviceConstructorMethodsQuote = "a member that parses as a [KeyMember](900-appendices.md#keymember), a [DefaultMember](900-appendices.md#defaultmember), a \x60PropertySignature\x60 or a \x60MethodSignature\x60 is that member"

func serviceConstructorMethodsChapter(t testing.TB) {
	t.Helper()
	data, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), serviceConstructorMethodsQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceConstructorMethodsQuote)
	}
}
func TestServiceConstructorMethodsQuoted(t *testing.T) { serviceConstructorMethodsChapter(t) }

// The same method signature supplies the service shape and its TypeScript
// object-type counterpart. Compare compiler diagnostics on these equivalent
// static contracts, including incomplete and mistyped implementations.
func FuzzServiceConstructorMethods(f *testing.F) {
	startShortBudget(f)
	serviceConstructorMethodsChapter(f)
	type probe struct{ key, native, custom string }
	var probes []probe
	for _, member := range []struct{ key, signature, value string }{
		{"plain", "constructor():number", "()=>7"},
		{"quoted", "\"constructor\"():number", "()=>7"},
		{"generic", "constructor<T>(x:T):T", "<T>(x:T):T=>x"},
		{"escaped", "c\\u006fnstructor():number", "()=>7"},
	} {
		for _, implementation := range []struct{ key, entry string }{
			{"complete", "constructor:" + member.value},
			{"missing", ""},
			{"mistyped", "constructor:false"},
		} {
			native := "import * as Context from \"effect/Context\";type Shape={" + member.signature + "};export class S extends Context.Service<S,Shape>()(\"fuzz/S\"){};export const impl:Context.Service.Shape<typeof S>={" + implementation.entry + "}"
			custom := "export service S {static readonly key=\"fuzz/S\";" + member.signature + "};export const impl:S.Shape={" + implementation.entry + "}"
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
		var noise byte
		if len(parts) == 2 && len(parts[1]) > 0 {
			noise = parts[1][0]
		}
		compile := func(file, source string) map[int32]int {
			if noise&1 != 0 {
				source = "// retained trivia\r\n" + strings.ReplaceAll(source, ";", ";\r\n")
			}
			if noise&2 != 0 {
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
		native, custom := compile("main.ts", p.native), compile("main.vibe", p.custom)
		if strings.HasSuffix(p.key, "/complete") && len(native) != 0 {
			Gap(t, "FuzzServiceConstructorMethods", "native:"+p.key, "chapter 5: %s; complete counterpart reports %v\n%s", serviceConstructorMethodsQuote, native, p.native)
			return
		}
		if !maps.Equal(native, custom) {
			Gap(t, "FuzzServiceConstructorMethods", "signature:"+p.key, "chapter 5: %s; counterpart %v, service %v\n%s", serviceConstructorMethodsQuote, native, custom, p.custom)
		}
	})
}
