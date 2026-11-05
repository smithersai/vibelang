package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

func TestArgumentsRegionWarningsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), "every `IdentifierReference` named `arguments`") {
		t.Fatal("arguments rule changed")
	}
	if !strings.Contains(SpecText("900-appendices.md"), "EK0801") {
		t.Fatal("resource migration diagnostic is missing")
	}
}

func FuzzArgumentsRegionWarnings(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"using", "arrow", "fork"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestArgumentsRegionWarningsQuoted(t)
		read := "arguments[0] as number"
		if mode%2 == 1 {
			read = "args[0]"
		}
		body := "using resource = try Effect.acquireRelease(effect { return 1 }, effect () => {}); return " + read
		wantWarning := 1
		switch key {
		case "arrow":
			body = "const inspect = effect () => { try Effect.yieldNow; return " + read + " }; return try inspect()"
			wantWarning = 0
		case "fork":
			body = "const child = fork Effect.yieldNow; join child; return " + read
			wantWarning = 0
		default:
			key = "using"
		}
		r, err := w.Compile(t.Context(), Single("import { Effect } from 'effect'; export effect function probe(...args:number[]): number!! { "+body+" }"))
		if err != nil {
			t.Fatal(err)
		}
		errors := r3Errors(r.Diagnostics)
		warnings := 0
		for _, d := range r.Diagnostics {
			if d.Code() == 801 && d.Category().Name() == "warning" {
				warnings++
			}
		}
		r.Remove()
		wantError := 0
		if mode%2 == 0 {
			wantError = 1
		}
		if len(errors) != wantError || (wantError == 1 && errors[0] != "EK0107") || warnings != wantWarning {
			Gap(t, "FuzzArgumentsRegionWarnings", fmt.Sprintf("%s/%d", key, mode%2), "arguments errors and migration warnings remain independent: errors=%v warnings=%d", errors, warnings)
		}
	})
}
