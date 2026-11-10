package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceInstanceNativeQuote = "Native lexical, syntax and static errors keep their " +
	"\x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types."
const serviceInstanceNativeMemberQuote = "a body, an initializer, a modifier"

func serviceInstanceNativeChapters(t testing.TB) string {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	tooling, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(tooling), serviceInstanceNativeQuote) ||
		!strings.Contains(string(chapter), serviceInstanceNativeMemberQuote) {
		t.Fatal("service static native-error rules changed")
	}
	return string(chapter)
}

func TestServiceInstanceNativeErrorsQuoted(t *testing.T) { serviceInstanceNativeChapters(t) }

func FuzzServiceInstanceNativeErrors(f *testing.F) {
	startShortBudget(f)
	chapter := serviceInstanceNativeChapters(f)
	members := []struct {
		key, text string
		code      int32
	}{
		{"name", "helper = Missing", 2304},
		{"assignment", "helper: number = \"bad\"", 2322},
		{"property", "helper = ({}).missing", 2339},
		{"argument", "helper = ((n: number) => n)(\"bad\")", 2345},
		{"type", "helper: Missing = 1", 2304},
		{"method", "helper(): number { return Missing }", 2304},
		{"getter", "get helper(): number { return Missing }", 2304},
		{"return-effect", "helper(): number!! { return 1 }", 2322},
		{"nested-untyped", "helper = class { nested }", 7008},
		{"nested-bodyless", "helper = class { nested(): void }", 2391},
		{"nested-definite", "helper = class { static nested!: number }", 1255},
	}
	keys := []string{}
	for _, shape := range []string{"body"} {
		for _, member := range members {
			keys = append(keys, shape+"-"+member.key)
		}
	}
	keys = append(keys, "native-name", "native-assignment", "native-return-effect")
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
		code := servicesRuleDiagnostic(chapter, serviceInstanceNativeMemberQuote)
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
			Gap(t, "FuzzServiceInstanceNativeErrors", key, "%s; want %d EK%04d and %d TS%d, got %d and %d; %s", serviceInstanceNativeQuote, want, code, wantNative, nativeCode, got, native, source)
			return
		}
		ExpectPending(t, "FuzzServiceInstanceNativeErrors", key)
		ExpectPending(t, "FuzzServiceInstanceNativeErrors", specCorpusKey(t))
	})
}
