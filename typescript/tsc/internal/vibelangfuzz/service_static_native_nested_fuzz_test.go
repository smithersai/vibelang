package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceStaticNativeNestedErrorsQuoted(t *testing.T) { serviceStaticNativeChapters(t) }

func FuzzServiceStaticNativeNestedErrors(f *testing.F) {
	startShortBudget(f)
	chapter := serviceStaticNativeChapters(f)
	code := servicesRuleDiagnostic(chapter, serviceStaticNativeMemberQuote)
	members := []struct {
		key, text string
		code      int32
	}{
		{"getter-signature", "static get helper(): number", 0},
		{"setter-signature", "static set helper(value: number)", 0},
		{"definite-initializer", "static helper!: number = 1", 0},
		{"definite-untyped", "static helper!", 0},
		{"key-marker", "static readonly key!: string = \"native/S\"", 0},
		{"default-marker", "static readonly defaultValue!: () => { n: number } = () => ({ n: 1 })", 0},
		{"nested-property", "static helper(): void { class Inner { field } }", 7008},
		{"nested-overload", "static helper(): void { function inner(): void; }", 2391},
		{"nested-static-marker", "static helper = class Inner { static field!: number }", 1255},
		{"nested-initializer-marker", "static helper = class Inner { field!: number = 1 }", 1263},
		{"nested-accessor", "static helper(): void { class Inner { get value(): number; } }", 1005},
		{"modifier-order", "static private helper = 1", 0},
		{"override-static", "static override helper = 1", 0},
		{"nested-modifier-order", "static helper = class Inner { static private x = 1 }", 1029},
		{"default-nested-property", "static defaultValue = () => { class Inner { field }; return { n: 1 } }", 7008},
		{"default-nested-overload", "static defaultValue = () => { function inner(): void; return { n: 1 } }", 2391},
	}
	keys := []string{}
	for _, shape := range []string{"body", "whole"} {
		for _, m := range members {
			keys = append(keys, shape+"-"+m.key)
		}
	}
	for _, key := range keys {
		f.Add([]byte(key))
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
		shape, memberKey, _ := strings.Cut(key, "-")
		member, nativeCode := "", int32(0)
		for _, m := range members {
			if m.key == memberKey {
				member, nativeCode = m.text, m.code
				break
			}
		}
		head, body, keyField := "export service S", "n: number;", "static readonly key = \"native/S\";"
		if shape == "whole" {
			head, body = head+": { n: number }", ""
		}
		if memberKey == "key-marker" {
			keyField = ""
		}
		if variant&1 != 0 {
			body = member + ";" + body
		} else {
			body += member
		}
		source := head + " { " + keyField + body + " }"
		if variant&2 != 0 {
			source = "function local() { " + strings.TrimPrefix(source, "export ") + " }"
		}
		r, err := w.Compile(t.Context(), Project{
			Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}",
			Files:  map[string]string{"main.vibe": source, "package.json": servicesPackage},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got, native := 0, 0
		for _, d := range r.Diagnostics {
			switch {
			case d.Source() == "EK" && d.Code() == code:
				got++
			case nativeCode != 0 && d.Code() == nativeCode:
				native++
			case d.Category() == diagnostics.CategoryError:
				t.Fatalf("fixture %s: %s", key, d.String())
			}
		}
		wantNative := 0
		if nativeCode != 0 {
			wantNative = 1
		}
		if got != 1 || native != wantNative {
			Gap(t, "FuzzServiceStaticNativeNestedErrors", key, "%s; want one EK%04d and %d TS%d, got %d and %d", serviceStaticNativeQuote, code, wantNative, nativeCode, got, native)
			return
		}
		ExpectPending(t, "FuzzServiceStaticNativeNestedErrors", key)
		ExpectPending(t, "FuzzServiceStaticNativeNestedErrors", specCorpusKey(t))
	})
}
