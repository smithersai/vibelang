package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 5 admits TypeScript PropertySignature and MethodSignature members:
// "A member may have any type, Effect or not, as Context.Service allows."
// VIP-9 and decided detail 276 leave omitted types to native noImplicitAny,
// including its explicit override of strict. Round 8 OPUS-2 found that an
// Effect-only rejection could mask the native signature diagnostics.
func serviceNativeMemberQuotes(tb testing.TB) {
	tb.Helper()
	text := SpecText("005-services.md")
	for _, quote := range []string{
		"A member is typed as in an " + string(rune(96)) + "interface" + string(rune(96)) + ", because it has no body to infer from, and may have any type, Effect or not, as " + string(rune(96)) + "Context.Service" + string(rune(96)) + " allows.",
		"a " + string(rune(96)) + "PropertySignature" + string(rune(96)) + " or a " + string(rune(96)) + "MethodSignature" + string(rune(96)) + " is that member",
	} {
		if !strings.Contains(text, quote) {
			tb.Fatalf("Chapter 5 no longer says %q", quote)
		}
	}
}

func TestServiceNativeMemberTypesQuoted(t *testing.T) { serviceNativeMemberQuotes(t) }

var serviceNativeMembers = []struct {
	name, source string
	implicit     int
}{
	{"method", "read()", 7010},
	{"optional-method", "read?()", 7010},
	{"generic-method", "read<A>(value: A)", 7010},
	{"property", "value", 7008},
	{"optional-property", "value?", 7008},
	{"readonly-property", "readonly value", 7008},
	{"explicit-method", "read(): any", 0},
	{"explicit-property", "value: any", 0},
}

var serviceNativeModes = []struct {
	name     string
	strict   bool
	override bool
}{
	{"loose", false, false},
	{"strict", true, false},
	{"strict-override", true, true},
}

func FuzzServiceNativeMemberTypes(f *testing.F) {
	startShortBudget(f)
	serviceNativeMemberQuotes(f)
	for _, member := range serviceNativeMembers {
		for _, mode := range serviceNativeModes {
			f.Add([]byte("native-member:" + member.name + ":" + mode.name))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		const target = "FuzzServiceNativeMemberTypes"
		defer recoverCompilerPanic(t, target)
		index := 0
		if len(data) > 0 {
			index = int(data[0]) % (len(serviceNativeMembers) * len(serviceNativeModes))
		}
		for i, member := range serviceNativeMembers {
			for j, mode := range serviceNativeModes {
				if string(data) == "native-member:"+member.name+":"+mode.name {
					index = i*len(serviceNativeModes) + j
				}
			}
		}
		member, mode := serviceNativeMembers[index/len(serviceNativeModes)], serviceNativeModes[index%len(serviceNativeModes)]
		key := "native-member:" + member.name + ":" + mode.name
		options := map[string]any{"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": mode.strict, "skipLibCheck": true, "types": []string{}, "noEmit": true}
		if mode.override {
			options["noImplicitAny"] = false
		}
		config := func(file string) string {
			bytes, err := json.Marshal(map[string]any{"compilerOptions": options, "files": []string{file}})
			if err != nil {
				t.Fatal(err)
			}
			return string(bytes)
		}
		compile := func(file, source string) []int {
			c, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config(file)})
			if err != nil {
				t.Fatal(err)
			}
			defer c.Remove()
			if c.Program == nil {
				t.Fatal("native member project has no program")
			}
			var codes []int
			for _, d := range c.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, int(d.Code()))
				}
			}
			slices.Sort(codes)
			return codes
		}
		native := compile("main.ts", "export interface Shape { "+member.source+" }\n")
		var expected []int
		if mode.strict && !mode.override && member.implicit != 0 {
			expected = []int{member.implicit}
		}
		if !slices.Equal(native, expected) {
			t.Fatalf("invalid native signature control %s: got %v, expected %v", key, native, expected)
		}
		source := fmt.Sprintf("export service NativeMembers {\n static readonly key = \"@fuzz/native-members\"\n %s\n}\nexport type Shape = NativeMembers.Shape\n", member.source)
		actual := compile("main.vibe", source)
		g := &Gaps{Target: target, Input: source}
		if !slices.Equal(actual, native) {
			g.Add("feature:"+key, "Chapter 5 native member signatures follow TypeScript noImplicitAny (detail 276): native errors %v; Vibe errors %v", native, actual)
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}
