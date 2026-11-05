package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const wholeShapeCaptureQuote = "the annotation is the whole shape; the body adds no members"
const wholeShapeCaptureParameterQuote = "a written member contract depending on an outer type parameter"

func wholeShapeCaptureChapter(t testing.TB) string {
	t.Helper()
	chapter := SpecText("005-services.md")
	for _, quote := range []string{wholeShapeCaptureQuote, wholeShapeCaptureParameterQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
	return chapter
}

func TestWholeShapeServiceCaptureQuoted(t *testing.T) { wholeShapeCaptureChapter(t) }

func FuzzWholeShapeServiceRejectedMemberCapture(f *testing.F) {
	startShortBudget(f)
	chapter := wholeShapeCaptureChapter(f)
	type probe struct {
		key, source string
		capture     bool
	}
	var probes []probe
	for _, shape := range []struct {
		key, text string
		capture   bool
	}{
		{"object", "{ n: number }", false}, {"named", "Concrete", false},
		{"phantom", "Phantom<T>", false}, {"primitive", "number", false},
		{"union", "number | { n: number }", false}, {"tuple", "[number]", false},
		{"captured-object", "{ n: T }", true}, {"captured-alias", "Box<T>", true},
		{"captured-tuple", "[T]", true},
	} {
		for _, member := range []struct{ key, text string }{
			{"field", "value: T"}, {"method", "read(): T"}, {"parameter", "read(value: T): number"},
			{"initializer", "value: T = undefined!"}, {"private", "private value: T"},
			{"bound", "read<U extends T>(value: U): U"}, {"body", "read(value: T): T { return value }"},
		} {
			source := "type Concrete = { n: number }; type Box<U> = { n: U }; type Phantom<U> = { n: number }; export function outer<T>() { service S: " + shape.text + " { static readonly key = \"whole/S\"; " + member.text + " } }; export const invalid: number = \"wrong\""
			probes = append(probes, probe{shape.key + "/" + member.key, source, shape.capture})
		}
	}
	for _, p := range probes {
		f.Add([]byte(p.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		selected := 0
		if len(data) != 0 {
			selected = int(data[0]) % len(probes)
		}
		for i, p := range probes {
			if string(data) == p.key {
				selected = i
				break
			}
		}
		p := probes[selected]
		source := p.source
		if len(data) > 1 && data[1]%2 != 0 {
			source = strings.ReplaceAll(source, "; ", ";\r\n")
		}
		if len(data) > 2 && data[2]%2 != 0 {
			source = "/* retained */\n" + strings.ReplaceAll(source, "\"", "'")
		}
		if len(data) > 3 && data[3]%2 != 0 {
			source = strings.ReplaceAll(source, "value", "valueCafé")
		}
		r, err := w.Compile(t.Context(), Project{
			Files:  map[string]string{"main.vibe": source, "package.json": servicesPackage},
			Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}",
		})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		captureCode := servicesRuleDiagnostic(chapter, wholeShapeCaptureParameterQuote)
		memberCode := servicesRuleDiagnostic(chapter, wholeShapeCaptureQuote)
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
				Gap(t, "FuzzWholeShapeServiceRejectedMemberCapture", "native:"+p.key, "%s: unexpected %s\n%s", p.key, d.String(), source)
				return
			}
		}
		wantCapture, wantKinds := 0, 2
		if p.capture {
			wantCapture, wantKinds = 1, 3
		}
		if len(got) != wantKinds || got[memberCode] != 1 || got[captureCode] != wantCapture || got[2322] != 1 {
			Gap(t, "FuzzWholeShapeServiceRejectedMemberCapture", "contract:"+p.key, "%s: want %d EK%04d, one EK%04d and TS2322; got %v\n%s", p.key, wantCapture, captureCode, memberCode, got, source)
		}
	})
}
