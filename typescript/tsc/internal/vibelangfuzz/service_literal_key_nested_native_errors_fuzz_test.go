package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"strings"
	"testing"
)

const literalKeyNestedNativeQuote = "Native lexical, syntax and static errors keep their " + "`" + "TS" + "`" + " codes, as in TypeScript, including independent errors in embedded expressions and types."
const literalKeyNestedKeyQuote = "a " + "`" + "key" + "`" + " whose initializer is not a string literal"

func literalKeyNestedNativeRules(t testing.TB) {
	t.Helper()
	for _, item := range []struct{ chapter, quote string }{{"005-services.md", literalKeyNestedKeyQuote}, {"007-tooling.md", literalKeyNestedNativeQuote}} {
		text, err := os.ReadFile(SpecPath(item.chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), item.quote) {
			t.Fatalf("%s no longer says %q", item.chapter, item.quote)
		}
	}
}
func TestServiceLiteralKeyNestedNativeErrorsQuoted(t *testing.T) { literalKeyNestedNativeRules(t) }

func FuzzServiceLiteralKeyNestedNativeErrors(f *testing.F) {
	startShortBudget(f)
	literalKeyNestedNativeRules(f)
	probes := []struct {
		key, source string
		codes       []int32
	}{
		{"body/nested-untyped", "export service ServiceKey { static readonly key = class { untyped } }", []int32{901, 7008}},
		{"body/nested-static-untyped", "export service ServiceKey { static readonly key = class { static untyped } }", []int32{901, 7008}},
		{"body/nested-static-definite", "export service ServiceKey { static readonly key = class { static field!: number } }", []int32{901, 1255}},
		{"body/nested-both", "export service ServiceKey { static readonly key = class { untyped; static field!: number } }", []int32{901, 7008, 1255}},
		{"body/arrow-untyped", "export service ServiceKey { static readonly key = () => { class Inner { untyped }; return 'key' } }", []int32{901, 7008}},
		{"body/arrow-definite", "export service ServiceKey { static readonly key = () => { class Inner { static field!: number }; return 'key' } }", []int32{901, 1255}},
		{"body/object-class", "export service ServiceKey { static readonly key = ({ inner: class { untyped } }) }", []int32{901, 7008}},
		{"body/satisfies-class", "export service ServiceKey { static readonly key = (class { untyped }) satisfies Function }", []int32{901, 7008}},
		{"body/unknown-name", "export service ServiceKey { static readonly key = Missing }", []int32{901, 2304}},
		{"body/missing-key", "export service ServiceKey { static readonly key }", []int32{901}},
		{"body/own-definite", "export service ServiceKey { static readonly key!: string }", []int32{901}},
		{"body/valid-literal", "export service ServiceKey { static readonly key = \"key/body\" }", []int32{}},
		{"whole/nested-untyped", "export service ServiceKey: number { static readonly key = class { untyped } }", []int32{901, 7008}},
		{"whole/nested-static-untyped", "export service ServiceKey: number { static readonly key = class { static untyped } }", []int32{901, 7008}},
		{"whole/nested-static-definite", "export service ServiceKey: number { static readonly key = class { static field!: number } }", []int32{901, 1255}},
		{"whole/nested-both", "export service ServiceKey: number { static readonly key = class { untyped; static field!: number } }", []int32{901, 7008, 1255}},
		{"whole/arrow-untyped", "export service ServiceKey: number { static readonly key = () => { class Inner { untyped }; return 'key' } }", []int32{901, 7008}},
		{"whole/arrow-definite", "export service ServiceKey: number { static readonly key = () => { class Inner { static field!: number }; return 'key' } }", []int32{901, 1255}},
		{"whole/object-class", "export service ServiceKey: number { static readonly key = ({ inner: class { untyped } }) }", []int32{901, 7008}},
		{"whole/satisfies-class", "export service ServiceKey: number { static readonly key = (class { untyped }) satisfies Function }", []int32{901, 7008}},
		{"whole/unknown-name", "export service ServiceKey: number { static readonly key = Missing }", []int32{901, 2304}},
		{"whole/missing-key", "export service ServiceKey: number { static readonly key }", []int32{901}},
		{"whole/own-definite", "export service ServiceKey: number { static readonly key!: string }", []int32{901}},
		{"whole/valid-literal", "export service ServiceKey: number { static readonly key = \"key/whole\" }", []int32{}},
		{"native/untyped", "export class Native { static readonly key = class { untyped } }", []int32{7008}},
		{"native/definite", "export class Native { static readonly key = class { static field!: number } }", []int32{1255}},
		{"outside/untyped", "export service ServiceKey { static readonly key }; export class Outside { untyped }", []int32{901, 7008}},
		{"outside/definite", "export service ServiceKey { static readonly key }; export class Outside { static field!: number }", []int32{901, 1255}},
	}
	for _, p := range probes {
		f.Add([]byte(p.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key, mutation, _ := strings.Cut(string(data), "\x00")
		index := 0
		if len(data) > 0 {
			index = int(data[0]) % len(probes)
		}
		for i, p := range probes {
			if key == p.key {
				index = i
				break
			}
		}
		p := probes[index]
		source := p.source
		if len(mutation) > 0 && mutation[0]&1 != 0 {
			source = strings.ReplaceAll(source, "ServiceKey", "OtherKey")
		}
		if len(mutation) > 0 && mutation[0]&2 != 0 {
			source = strings.ReplaceAll(source, "; ", ";\r\n")
		}
		if len(mutation) > 0 && mutation[0]&4 != 0 {
			source = "function outer() { " + strings.ReplaceAll(source, "export ", "") + " }"
		}
		result, err := w.Compile(t.Context(), Project{
			Files:  map[string]string{"main.vibe": source, "package.json": servicesPackage},
			Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}",
		})
		if err != nil {
			Gap(t, "FuzzServiceLiteralKeyNestedNativeErrors", p.key, "compile: %v", err)
			return
		}
		defer result.Remove()
		got, want := map[int32]int{}, map[int32]int{}
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got[d.Code()]++
			}
		}
		for _, code := range p.codes {
			want[code]++
		}
		if fmt.Sprint(got) != fmt.Sprint(want) {
			Gap(t, "FuzzServiceLiteralKeyNestedNativeErrors", p.key, "want %v got %v\n%s", want, got, source)
		}
	})
}
