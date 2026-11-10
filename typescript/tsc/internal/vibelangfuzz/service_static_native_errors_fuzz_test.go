package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceStaticNativeQuote = "Native lexical, syntax and static errors keep their " +
	"\x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types."
const serviceStaticNativeMemberQuote = "a body, an initializer, a modifier"

func serviceStaticNativeChapters(t testing.TB) string {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	tooling, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(tooling), serviceStaticNativeQuote) ||
		!strings.Contains(string(chapter), serviceStaticNativeMemberQuote) {
		t.Fatal("service static native-error rules changed")
	}
	return string(chapter)
}

func TestServiceStaticNativeErrorsQuoted(t *testing.T) { serviceStaticNativeChapters(t) }

func FuzzServiceStaticNativeErrors(f *testing.F) {
	startShortBudget(f)
	chapter := serviceStaticNativeChapters(f)
	members := []struct {
		key, text string
		code      int32
	}{
		{"name", "static helper = Missing", 2304},
		{"assignment", "static helper: number = \"bad\"", 2322},
		{"property", "static helper = ({}).missing", 2339},
		{"argument", "static helper = ((n: number) => n)(\"bad\")", 2345},
		{"type", "static helper: Missing = 1", 2304},
		{"method", "static helper(): number { return Missing }", 2304},
		{"getter", "static get helper(): number { return Missing }", 2304},
		{"nested-untyped", "static helper = class { nested }", 7008},
		{"nested-bodyless", "static helper = class { nested(): void }", 2391},
		{"nested-definite", "static helper = class { static nested!: number }", 1255},
		{"untyped", "static helper", 0},
		{"bodyless", "static helper(): void", 0},
		{"definite", "static helper!: number", 0},
	}
	keys := []string{}
	for _, shape := range []string{"body", "whole"} {
		for _, member := range members {
			keys = append(keys, shape+"-"+member.key)
		}
	}
	keys = append(keys, "native-name", "native-assignment")
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
		for _, row := range members {
			if row.key == memberKey {
				member, nativeCode = row.text, row.code
				break
			}
		}
		head, body, want := "export service S", "n: number;", 1
		if shape == "whole" {
			head, body = head+": { n: number }", ""
		}
		if shape == "native" {
			head, want = "export class S", 0
		}
		if variant&1 != 0 {
			body = member + "; " + body
		} else {
			body += member
		}
		source := head + " { static readonly key = \"native/S\"; " + body + " }"
		if shape == "native" {
			source = head + " { static readonly key = \"native/S\"; " + member + " }"
		} else if variant&2 != 0 {
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
		code := servicesRuleDiagnostic(chapter, serviceStaticNativeMemberQuote)
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
		if got != want || native != wantNative {
			Gap(t, "FuzzServiceStaticNativeErrors", key, "%s; want %d EK%04d and %d TS%d, got %d and %d; %s", serviceStaticNativeQuote, want, code, wantNative, nativeCode, got, native, source)
			return
		}
		ExpectPending(t, "FuzzServiceStaticNativeErrors", key)
		ExpectPending(t, "FuzzServiceStaticNativeErrors", specCorpusKey(t))
	})
}
