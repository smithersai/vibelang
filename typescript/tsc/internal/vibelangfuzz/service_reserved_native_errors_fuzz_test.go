package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceReservedNativeErrorsQuoted(t *testing.T) { serviceStaticNativeChapters(t) }

func FuzzServiceReservedNativeErrors(f *testing.F) {
	startShortBudget(f)
	chapter := serviceStaticNativeChapters(f)
	code := servicesRuleDiagnostic(chapter, serviceStaticNativeMemberQuote)
	members := []struct {
		key, text string
		code      int32
	}{
		{"key-type", "private static readonly key: Missing = \"native/S\"", 2304},
		{"key-assignment", "protected static readonly key: number = \"native/S\"", 2322},
		{"key-optional", "static readonly key?: Missing = \"native/S\"", 2304},
		{"default-value", "private static readonly defaultValue = Missing", 2304},
		{"default-type", "static defaultValue: Missing = () => ({ n: 1 })", 2304},
		{"default-property", "static readonly defaultValue? = () => ({ n: ({}).missing })", 2339},
		{"default-untyped", "static defaultValue", 0},
		{"default-definite", "static readonly defaultValue!: () => { n: number }", 0},
		{"declare-factory", "declare static readonly defaultValue = () => ({ n: 1 })", 0},
		{"declare-mutable-factory", "declare static defaultValue = () => ({ n: 1 })", 0},
		{"declare-factory-name", "declare static readonly defaultValue = () => ({ n: Missing })", 2304},
		{"declare-typed-property", "declare static readonly defaultValue: () => { n: number } = () => ({ n: ({}).missing })", 2339},
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
		if strings.HasPrefix(memberKey, "key-") {
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
			Gap(t, "FuzzServiceReservedNativeErrors", key, "%s; want one EK%04d and %d TS%d, got %d and %d", serviceStaticNativeQuote, code, wantNative, nativeCode, got, native)
			return
		}
		ExpectPending(t, "FuzzServiceReservedNativeErrors", key)
		ExpectPending(t, "FuzzServiceReservedNativeErrors", specCorpusKey(t))
	})
}
