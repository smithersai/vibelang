package vibelangmapper

import (
	"os"
	"strings"
	"testing"
)

func TestRetiredControlProjectionSyntax(t *testing.T) {
	for _, test := range []struct {
		source string
		code   int32
	}{
		{`control Ask {ask(x: number): number!!}`, 3501},
		{`effect function probe(){try {return 1} handle Ask.ask(x){return try resume(x)}}`, 3501},
		{`effect function probe(){try { work() } handle Ask.ask(x){ consume(x) }}`, 3501},
		{`effect function probe(){for (const x of [1]) { try { work() } handle Ask.ask(y){ consume(y) } }}`, 3501},
		{`effect function probe(){try { work() } handle Ask.ask(x){ if (x) consume(x) }}`, 3501},
		{`effect function probe(){select {default: return 1}}`, 4607},
	} {
		for _, projection := range []Projection{Project(test.source, FileContext{}), Executable(test.source, FileContext{})} {
			found := false
			assertValidMap(t, projection, test.source)
			assertParses(t, projection.Text)
			for _, d := range projection.Diagnostics {
				if strings.Contains(d.Message, "overlapping edits") {
					t.Fatalf("rejected handler received overlapping edits: %+v", projection.Diagnostics)
				}
				if d.Code == test.code {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing EK%04d: %+v", test.code, projection.Diagnostics)
			}
			if strings.Contains(projection.Text, "$control") || strings.Contains(projection.Text, "$tailResume") {
				t.Fatalf("retired continuation lowering survives: %s", projection.Text)
			}
		}
	}
}

func TestRetiredControlProjectionNativeNames(t *testing.T) {
	for _, name := range []string{"control", "handle", "resume", "resumeWith", "abandon", "select"} {
		source := "export function probe(" + name + ": (n: number) => number){return " + name + "(1)}; export const object={" + name + "(n: number){return n}}"
		projection := Project(source, FileContext{})
		for _, d := range projection.Diagnostics {
			if d.Code == 3501 || d.Code == 4607 {
				t.Fatalf("native %s rejected: %+v", name, projection.Diagnostics)
			}
		}
	}
	source := `abstract class Control {abstract value(): number}; export abstract class Native extends Control {abstract value(): number}`
	projection := Executable(source, FileContext{})
	if strings.Contains(projection.Text, "$control") || strings.Contains(projection.Text, "~vibelang/service") {
		t.Fatalf("native inheritance became a control: %s", projection.Text)
	}
}

func TestRetiredControlCorpusPlan(t *testing.T) {
	source, err := os.ReadFile("../../../vibelang/cases/appendix-ek2110-ek2119-archived-control.fail/main.vibe")
	if err != nil {
		t.Fatal(err)
	}
	p := lower(string(source), testContext)
	plan := p.execPlan()
	renderer := newExecRendering(p.names)
	_, _, overlap, ok := plan.render(renderer, p.text, renderer.prefix)
	if !ok {
		for _, edit := range plan.edits {
			if edit.pos <= overlap+20 && edit.end >= overlap-20 {
				t.Logf("overlap edit: %+v", edit)
			}
		}
		t.Fatalf("retired control executable plan overlaps at %d", overlap)
	}
}
