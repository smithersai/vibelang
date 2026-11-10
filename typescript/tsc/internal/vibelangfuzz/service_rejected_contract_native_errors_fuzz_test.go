package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"slices"
	"strings"
	"testing"
)

const rejectedContractNativeQuote = "Native lexical, syntax and static errors keep their " +
	"\x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types."
const rejectedContractMemberQuote = "a modifier (\x60private\x60, \x60protected\x60, \x60#x\x60, \x60declare\x60, \x60accessor\x60, \x60override\x60), a \x60get\x60 or \x60set\x60 accessor"

func rejectedContractChapter(t testing.TB) string {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	tooling, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), rejectedContractMemberQuote) || !strings.Contains(string(tooling), rejectedContractNativeQuote) {
		t.Fatal("rejected service contract native-error rules changed")
	}
	return string(chapter)
}
func TestServiceRejectedContractNativeErrorsQuoted(t *testing.T) { rejectedContractChapter(t) }

func FuzzServiceRejectedContractNativeErrors(f *testing.F) {
	startShortBudget(f)
	chapter := rejectedContractChapter(f)
	rows := []struct {
		key, member string
		code        int32
	}{
		{"get-name", "get value(): Missing", 2304},
		{"set-name", "set value(next: Missing)", 2304},
		{"get-nested-name", "get value(): { inner: Missing }", 2304},
		{"set-nested-name", "set value(next: { inner: Missing })", 2304},
		{"get-index", "get value(): { [key: string]: string; n: number }", 2411},
		{"set-index", "set value(next: { [key: string]: string; n: number })", 2411},
		{"get-nested-readonly", "get value(): { readonly method(): void }", 1024},
		{"set-nested-parameter", "set value(next: (inner) => void)", 7006},
		{"abstract-method", "abstract read(): Missing", 2304},
		{"abstract-property", "abstract value: Missing", 2304},
		{"declare-method", "declare read(): Missing", 2304},
		{"declare-property", "declare value: Missing", 2304},
		{"private-property", "private value: Missing", 2304},
		{"protected-method", "protected read(): Missing", 2304},
		{"public-property", "public value: Missing", 2304},
		{"auto-accessor", "accessor value: Missing", 2304},
		{"override-method", "override read(): Missing", 2304},
		{"readonly-method", "readonly read(): Missing", 2304},
		{"private-name", "#value: Missing", 2304},
		{"definite", "value!: Missing", 2304},
		{"effect-method", "effect read(): Missing!!", 2304},
		{"modifier-nested-readonly", "private value: { readonly method(): void }", 1024},
		{"modifier-nested-parameter", "private value: (inner) => void", 7006},
		{"get-header", "get value(): number", 0},
		{"set-header", "set value(next: number)", 0},
		{"get-untyped", "get value()", 0},
		{"set-untyped", "set value(next)", 0},
		{"get-declare", "declare get value(): number", 0},
		{"get-readonly", "readonly get value(): number", 0},
		{"abstract-control", "abstract read(): number", 0},
		{"declare-control", "declare value: number", 0},
		{"private-control", "private value: number", 0},
		{"readonly-control", "readonly read(): number", 0},
		{"definite-control", "value!: number", 0},
		{"native-get", "abstract get value(): Missing", 2304},
		{"native-set", "abstract set value(next: Missing)", 2304},
		{"effect-bare-return", "effect read(): Missing", 2304},
		{"private-header-scope", "#value: Missing", 2304},
		{"async-method", "async read(): Missing!!", 2304},
		{"async-promise", "async read(): Promise<Missing>", 2304},
		{"async-control", "async read(): Promise<number>", 0},
		{"async-effect-header", "async read(): number!!", 0},
		{"async-header-scope", "async read(): number!!", 0},
	}
	keys := []string{}
	for _, row := range rows {
		keys = append(keys, row.key)
		f.Add([]byte(row.key))
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
		var member string
		var nativeCode int32
		for _, row := range rows {
			if row.key == key {
				member, nativeCode = row.member, row.code
				break
			}
		}
		name := fmt.Sprintf("Service%d", variant%7)
		head := "export service " + name + " { static readonly key = \"contract/" + name + "\"; " + member + " }"
		wantEK := 1
		if strings.HasPrefix(key, "native-") {
			head = "export abstract class " + name + " { " + member + " }"
			wantEK = 0
		}
		source := strings.ReplaceAll(head, "Missing", fmt.Sprintf("Absent%d", variant%5))
		if variant&1 != 0 {
			source = "namespace Local { " + source + " }"
		}
		outside := variant&4 != 0
		if outside {
			source += "; const outside: number = \"bad\""
		}
		extraEffect := key == "effect-bare-return"
		outsideAsync := variant&16 != 0 || key == "async-header-scope"
		outsidePrivate := variant&8 != 0 || key == "private-header-scope"
		if outsidePrivate {
			source += "; abstract class Outside { abstract #value: number }"
		}
		if outsideAsync {
			source += "; async function OutsideAsync(): number { return 1 }"
		}
		r, err := w.Compile(t.Context(), Project{Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}", Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		code := servicesRuleDiagnostic(chapter, "any member that is not")
		gotEK, gotNative, gotOutside, gotExtra, gotPrivate, gotAsync := 0, 0, 0, 0, 0, 0
		for _, d := range r.Diagnostics {
			switch {
			case d.Source() == "EK" && d.Code() == code:
				gotEK++
			case nativeCode != 0 && d.Code() == nativeCode:
				gotNative++
			case outside && d.Code() == 2322:
				gotOutside++
			case extraEffect && d.Source() == "EK" && d.Code() == 106:
				gotExtra++
			case outsidePrivate && d.Code() == 18019:
				gotPrivate++
			case outsideAsync && d.Code() == 1064:
				gotAsync++
			case d.Category() == diagnostics.CategoryError:
				t.Fatalf("fixture %s: %s", key, d.String())
			}
		}
		wantNative := 0
		if nativeCode != 0 {
			wantNative = 1
		}
		wantOutside := 0
		if outside {
			wantOutside = 1
		}
		wantExtra := 0
		if extraEffect {
			wantExtra = 1
		}
		wantPrivate := 0
		if outsidePrivate {
			wantPrivate = 1
		}
		wantAsync := 0
		if outsideAsync {
			wantAsync = 1
		}
		if gotEK != wantEK || gotNative != wantNative || gotOutside != wantOutside || gotExtra != wantExtra || gotPrivate != wantPrivate || gotAsync != wantAsync {
			Gap(t, "FuzzServiceRejectedContractNativeErrors", key, "%s; got EK%d=%d TS%d=%d TS2322=%d EK0106=%d TS18019=%d TS1064=%d; want %d/%d/%d/%d/%d/%d; %s", rejectedContractNativeQuote, code, gotEK, nativeCode, gotNative, gotOutside, gotExtra, gotPrivate, gotAsync, wantEK, wantNative, wantOutside, wantExtra, wantPrivate, wantAsync, source)
			return
		}
		ExpectPending(t, "FuzzServiceRejectedContractNativeErrors", key)
		ExpectPending(t, "FuzzServiceRejectedContractNativeErrors", specCorpusKey(t))
	})
}
