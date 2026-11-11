package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceCaptureRecoveryQuote = "A service's resolved member contracts cannot capture a type parameter from an enclosing scope"
const serviceCaptureRecoveryRuleQuote = "a written member contract depending on an outer type parameter"

// Each alias names itself with a larger argument at every step.
const serviceCaptureRecursiveAliases = "type Builder<A extends unknown[]> = { add<V>(v: V): Builder<[...A, V]>; done(): A }; " +
	"type Next<U> = { next: Next<U[]>; value: U }; type Skip<U> = { next: Skip<U[]>; n: number }; " +
	"type Nested<U> = Nested<U[]>[]; type NestedValue<U> = U | NestedValue<U[]>[]; " +
	"type Chain<U> = (value: U) => Chain<U[]>; type Grow<U> = U extends string ? number : { next: Grow<U[]> }; "

func serviceCaptureRecoveryChapter(t testing.TB) string {
	t.Helper()
	chapter := serviceKeyRecoveryChapter(t)
	for _, quote := range []string{serviceCaptureRecoveryQuote, serviceCaptureRecoveryRuleQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
	return chapter
}

func TestServiceCaptureRecoveryQuoted(t *testing.T) { serviceCaptureRecoveryChapter(t) }

func FuzzServiceCaptureWithRejectedMembers(f *testing.F) {
	startShortBudget(f)
	chapter := serviceCaptureRecoveryChapter(f)
	type probe struct {
		key, source string
		capture     bool
	}
	var probes []probe
	source := func(contract, rejected string) string {
		if contract != "" {
			contract += "; "
		}
		return "type Box<U> = { value: U }; type Phantom<U> = { n: number }; " + serviceCaptureRecursiveAliases + "export function outer<T>() { service S { static readonly key = \"capture/S\"; " + contract + rejected + " } }; export const invalid: number = \"wrong\""
	}
	for _, contract := range []struct {
		key, text string
		capture   bool
	}{
		{"property", "value: T", true}, {"method", "read(): T", true},
		{"alias", "value: Box<T>", true}, {"constraint", "read<U extends T>(value: U): U", true},
		{"phantom", "value: Phantom<T>", false}, {"member-local", "read<U>(value: U): U", false},
		{"concrete", "value: number", false},
		// A recursive alias whose argument grows has no largest instantiation.
		// It captures exactly when a used argument does.
		{"recursive-array", "value: Nested<number>", false}, {"recursive-array-phantom", "value: Nested<T>", false},
		{"recursive-array-capture", "value: NestedValue<T>", true},
		{"recursive-builder", "value: Builder<[]>", false}, {"recursive-growing", "value: Next<number>", false},
		{"recursive-function", "value: Chain<number>", false}, {"recursive-conditional", "read<U>(value: U): Grow<U>", false},
		{"recursive-phantom", "value: Skip<T>", false}, {"recursive-nested-concrete", "value: Next<Next<number>>", false},
		{"recursive-builder-capture", "value: Builder<[T]>", true}, {"recursive-growing-capture", "value: Next<T>", true},
		{"recursive-function-capture", "value: Chain<T>", true}, {"recursive-nested-capture", "value: Next<Next<T>>", true},
	} {
		for _, rejected := range []struct{ key, text string }{
			{"constructor", "constructor() {}"}, {"index", "[name: string]: unknown"},
			{"call", "(): number"}, {"getter", "get n() { return 1 }"}, {"method", "impl() { return 1 }"},
		} {
			key := contract.key + "/" + rejected.key
			probes = append(probes, probe{key, source(contract.text, rejected.text), contract.capture})
		}
	}
	for _, member := range []struct{ key, text string }{
		{"private-field", "private value: T"}, {"initializer", "value: T = undefined!"},
		{"body", "read(): T { return undefined! }"}, {"accessor", "get value(): T { return undefined! }"},
		{"effect", "effect read(): T!!"}, {"async", "async read(): Promise<T>"}, {"constructor", "constructor(value: T) {}"},
	} {
		probes = append(probes, probe{"invalid/" + member.key, source("", member.text), false})
	}
	for _, p := range probes {
		f.Add([]byte(p.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		selected := 0
		if len(data) > 0 {
			selected = int(data[0]) % len(probes)
		}
		for i, p := range probes {
			if string(data) == p.key {
				selected = i
				break
			}
		}
		p := probes[selected]
		text := p.source
		if len(data) > 1 && data[1]%2 == 1 {
			text = strings.ReplaceAll(text, "; ", ";\r\n")
		}
		if len(data) > 2 && data[2]%2 == 1 {
			text = "/* retained */\n" + strings.ReplaceAll(text, "\"", "'")
		}
		if len(data) > 3 && data[3]%2 == 1 {
			text = strings.ReplaceAll(text, "outer<T>", "outer<T = string>")
		}
		r, err := w.Compile(t.Context(), Project{
			Files:  map[string]string{"main.vibe": text, "package.json": servicesPackage},
			Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}",
		})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		captureCode := servicesRuleDiagnostic(chapter, serviceCaptureRecoveryRuleQuote)
		memberCode := servicesRuleDiagnostic(chapter, serviceRejectedMemberQuote)
		if captureCode == 0 || memberCode == 0 {
			t.Fatal("chapter 5 capture/member codes are missing")
		}
		got := map[int32]int{}
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && (d.Code() == captureCode || d.Code() == memberCode) || !IsEK(d) && d.Code() == 2322 {
				got[d.Code()]++
			} else {
				Gap(t, "FuzzServiceCaptureWithRejectedMembers", "native:"+p.key, "%s: unexpected %s\n%s", p.key, d.String(), text)
				return
			}
		}
		wantCapture, wantKinds := 0, 2
		if p.capture {
			wantCapture, wantKinds = 1, 3
		}
		if len(got) != wantKinds || got[memberCode] != 1 || got[captureCode] != wantCapture || got[2322] != 1 {
			Gap(t, "FuzzServiceCaptureWithRejectedMembers", "contract:"+p.key, "%s: want %d EK%04d, one EK%04d and TS2322; got %v\n%s", p.key, wantCapture, captureCode, memberCode, got, text)
		}
	})
}
