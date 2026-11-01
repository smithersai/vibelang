package vibelangfuzz

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const nativeLoopTarget = "FuzzReviewNativeLoops"
const nativeLoopQuote = "A function literal never becomes an Effect because a parameter expects one, and a type never decides whether a loop consumes a Stream"
const nativeLoopAwaitQuote = "It mirrors \x60for await\x60 over AsyncIterables, which keeps its JavaScript meaning."

func TestReviewNativeLoopsQuoted(t *testing.T) {
	for _, row := range []struct{ chapter, quote string }{
		{"000-intro.md", nativeLoopQuote}, {"002-running.md", nativeLoopAwaitQuote},
	} {
		if !strings.Contains(SpecText(row.chapter), row.quote) {
			t.Fatalf("%s no longer says %q", row.chapter, row.quote)
		}
	}
}

// VIP-20 and detail 293 preserve native syntax even when its value also
// implements Stream. The spec requires comparison with the same native loop.
type reviewNativeLoop struct{ key, typ, home, body string }

func reviewNativeLoops() []reviewNativeLoop {
	var rows []reviewNativeLoop
	for _, typ := range []struct{ key, text string }{
		{"array", "number[]"}, {"any", "any"}, {"never", "never"},
		{"sync-dual", "S.Stream<number> & Iterable<number>"},
		{"async-dual", "S.Stream<number> & AsyncIterable<number>"},
		{"both-dual", "S.Stream<number> & Iterable<number> & AsyncIterable<number>"},
		{"stream", "S.Stream<number>"}, {"alias-dual", "Dual"}, {"shadow-stream", "number[]"},
	} {
		for _, home := range []string{"plain", "async", "await", "effect"} {
			rows = append(rows, reviewNativeLoop{typ.key + "/" + home, typ.text, home, "const value: unknown = row;"})
		}
	}
	for _, body := range []struct{ key, text string }{
		{"break", "break;"}, {"return", "return row;"}, {"destructure", "const [value] = [row];"},
	} {
		rows = append(rows, reviewNativeLoop{"sync-dual/plain/" + body.key, "S.Stream<number> & Iterable<number>", "plain", body.text})
	}
	return append(rows, reviewNativeLoop{"both-dual/effect-await", "S.Stream<number> & Iterable<number> & AsyncIterable<number>", "effect-await", ""})
}

func reviewNativeLoopSource(row reviewNativeLoop, vibe bool) string {
	modifier := ""
	if row.home == "async" || row.home == "await" || row.home == "effect-await" && !vibe {
		modifier = "async "
	}
	if vibe && (row.home == "effect" || row.home == "effect-await") {
		modifier = "effect "
	}
	await := ""
	if row.home == "await" || row.home == "effect-await" {
		await = "await "
	}
	name := "rows"
	if strings.HasPrefix(row.key, "shadow-stream/") {
		name = "Stream"
	}
	return "import type * as S from \"effect/Stream\";\ntype Dual = S.Stream<number> & Iterable<number>;\nexport " + modifier + "function f(" + name + ": " + row.typ + ") { for " + await + "(const row of " + name + ") { " + row.body + " } }\n"
}

func reviewNativeLoopErrors(t *testing.T, w *Workspace, source string, vibe bool) (*Result, []string) {
	t.Helper()
	name := "main.ts"
	if vibe {
		name = "main.vibe"
	}
	var r *Result
	var err error
	within(t, "compile", func() { r, err = w.Compile(t.Context(), Project{Files: map[string]string{name: source}}) })
	if err != nil {
		t.Fatal(err)
	}
	var codes []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, fmt.Sprintf("%s%04d", d.Source(), d.Code()))
		}
	}
	slices.Sort(codes)
	return r, codes
}

func FuzzReviewNativeLoops(f *testing.F) {
	startShortBudget(f)
	rows := reviewNativeLoops()
	short := []int{0, 3, 4, 8, 9, 12, 14, 17, 21, 24, 26, 28, 32, 36, 37, 38, 39}
	for i, row := range rows {
		if !testing.Short() || toolsFuzzing() || slices.Contains(short, i) {
			for _, mode := range []string{"diagnostic", "fix"} {
				f.Add(row.key + "/" + mode)
			}
		}
	}
	w := NewWorkspace(f)
	forTry := regexp.MustCompile("\\bfor\\s+try\\b")
	effectFunction := regexp.MustCompile("\\beffect\\s+function\\s+f\\b")
	f.Fuzz(func(t *testing.T, key string) {
		TestReviewNativeLoopsQuoted(t)
		row := rows[0]
		mode := "diagnostic"
		found := false
		for _, candidate := range rows {
			for _, m := range []string{"diagnostic", "fix"} {
				if key == candidate.key+"/"+m {
					row = candidate
					mode = m
					found = true
				}
			}
		}
		if !found {
			if key == "" {
				return
			}
			row = rows[int(key[0])%len(rows)]
			if key[len(key)-1]&1 != 0 {
				mode = "fix"
			}
		}
		precise := row.key + "/" + mode
		native, nativeCodes := reviewNativeLoopErrors(t, w, reviewNativeLoopSource(row, false), false)
		defer native.Remove()
		source := reviewNativeLoopSource(row, true)
		result, codes := reviewNativeLoopErrors(t, w, source, true)
		defer result.Remove()
		if mode == "diagnostic" {
			good := slices.Equal(codes, nativeCodes)
			if row.home == "effect-await" {
				good = slices.Contains(codes, "EK0102") && !slices.Contains(codes, "EK2007")
			}
			if !good {
				Gap(t, nativeLoopTarget, "native:"+precise, "VIP-20/detail293: %q; native=%v, Vibe=%v\n%s", nativeLoopQuote, nativeCodes, codes, source)
			}
		} else if len(nativeCodes) == 0 && row.home != "effect-await" {
			config := toolsConfig(w, result.Dir)
			if result.Program == nil || config == nil || len(config.Errors) > 0 {
				t.Fatal("valid native control has no fixable project")
			}
			var fixed *vibelang.FixResult
			toolsRun(t, nativeLoopTarget, "fix", source, nil, func() {
				fixed = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			if fixed.Err != nil {
				Gap(t, nativeLoopTarget, "fix:"+precise, "native loop fix failed: %v\n%s", fixed.Err, source)
			}
			for _, file := range fixed.Files {
				if forTry.MatchString(file.Text) || row.home != "effect" && effectFunction.MatchString(file.Text) {
					Gap(t, nativeLoopTarget, "fix:"+precise, "VIP-20/detail293: native iteration cannot become Stream execution or a new Effect function\noriginal:\n%s\nfixed:\n%s", source, file.Text)
				}
			}
		}
		ExpectPending(t, nativeLoopTarget, specCorpusKey(t))
	})
}
