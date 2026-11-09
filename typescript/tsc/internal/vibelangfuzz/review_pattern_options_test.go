package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const reviewPatternOptionsTarget = "FuzzReviewPatternOptions"
const reviewPatternOptionsQuote = "A `let` binding has the type TypeScript gives the value it is bound to in the counterpart."

func TestReviewPatternOptionsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), reviewPatternOptionsQuote) {
		t.Fatalf("Chapter 4 no longer says %q", reviewPatternOptionsQuote)
	}
}

type reviewPatternOption struct{ key, config string }

var reviewPatternOptions = []reviewPatternOption{
	{"strict", ""},
	{"exact", `"exactOptionalPropertyTypes":true,`},
	{"access", `"noUncheckedIndexedAccess":true,"noPropertyAccessFromIndexSignature":true,`},
	{"all", `"exactOptionalPropertyTypes":true,"noUncheckedIndexedAccess":true,"noPropertyAccessFromIndexSignature":true,`},
	{"loose-access", `"strictNullChecks":false,"noUncheckedIndexedAccess":true,"noPropertyAccessFromIndexSignature":true,`},
}

type reviewPatternOptionRule struct{ key, subject, pattern, native string }

var reviewPatternOptionRules = []reviewPatternOptionRule{
	{"optional", "{ x?: number }", "{ let x }", `if ("x" in s) return s.x;`},
	{"optional-undefined", "{ x?: number | undefined }", "{ let x }", `if ("x" in s) return s.x;`},
	{"required-undefined", "{ x: number | undefined }", "{ let x }", `if ("x" in s) return s.x;`},
	{"dictionary", "Record<string,number>", "{ x: let x }", `if ("x" in s) return s["x"];`},
	{"array", "number[]", "[let x]", ""},
	{"array-undefined", "(number | undefined)[]", "[let x]", ""},
	{"array-extractor", "number[]", "Array(let x)", ""},
	{"array-extractor-undefined", "(number | undefined)[]", "Array(let x)", ""},
	{"written-dot", "Record<string,number>", "", `if ("x" in s) return s.x;`},
	{"written-index", "number[]", "", "return s[0];"},
}

// Detail 294 applies the selected project options to the native counterpart.
// The iterator result's done test proves presence without deleting a real
// undefined payload. Ordinary authored dot/index reads remain native controls.
func reviewPatternOptionProgram(rule reviewPatternOptionRule, vibe bool) string {
	body := rule.native
	if rule.pattern != "" && vibe {
		body = "return match (s) { when " + rule.pattern + ": x; default: 0; };"
	} else if body == "" {
		body = "const next = s[Symbol.iterator]().next(); if (!next.done) return next.value;"
	}
	return "export function read(s: " + rule.subject + "): number { " + body + " return 0; }\n"
}

func reviewPatternOptionCodes(t *testing.T, w *Workspace, source string, option reviewPatternOption, vibe bool) []string {
	t.Helper()
	name := "main.ts"
	if vibe {
		name = "main.vibe"
	}
	config := strings.Replace(DefaultConfig, `"strict": true,`, `"strict": true,`+option.config, 1)
	var r *Result
	var err error
	within(t, "compile", func() {
		r, err = w.Compile(t.Context(), Project{Files: map[string]string{name: source}, Config: config})
	})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var codes []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, fmt.Sprintf("%s%04d", d.Source(), d.Code()))
		}
	}
	slices.Sort(codes)
	return codes
}

func FuzzReviewPatternOptions(f *testing.F) {
	startShortBudget(f)
	for _, rule := range reviewPatternOptionRules {
		for _, option := range reviewPatternOptions {
			f.Add(rule.key + "/" + option.key)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestReviewPatternOptionsQuoted(t)
		ri, oi := 0, 0
		if key == "" {
			return
		}
		ri = int(key[0]) % len(reviewPatternOptionRules)
		oi = int(key[len(key)-1]) % len(reviewPatternOptions)
		for i, r := range reviewPatternOptionRules {
			for j, o := range reviewPatternOptions {
				if key == r.key+"/"+o.key {
					ri, oi = i, j
				}
			}
		}
		rule, option := reviewPatternOptionRules[ri], reviewPatternOptions[oi]
		native := reviewPatternOptionCodes(t, w, reviewPatternOptionProgram(rule, false), option, false)
		source := reviewPatternOptionProgram(rule, true)
		actual := reviewPatternOptionCodes(t, w, source, option, true)
		// A negative native witness ensures this comparison cannot become a
		// vacuous two-sided acceptance if configuration or payload typing is lost.
		wantsUndefined := option.key != "loose-access" && (rule.key == "required-undefined" || rule.key == "optional-undefined" || rule.key == "array-undefined" || rule.key == "array-extractor-undefined" || rule.key == "optional" && option.key != "exact" && option.key != "all" || rule.key == "written-index" && (option.key == "access" || option.key == "all"))
		if wantsUndefined && !slices.Contains(native, "2322") {
			t.Fatalf("native undefined control did not reject: %s %v", key, native)
		}
		if !slices.Equal(native, actual) {
			Gap(t, reviewPatternOptionsTarget, "options:"+rule.key+"/"+option.key, "VIP-7/detail294: %s; native=%v Vibe=%v under %s\n%s", reviewPatternOptionsQuote, native, actual, option.key, source)
		}
		ExpectPending(t, reviewPatternOptionsTarget, specCorpusKey(t))
	})
}

// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#1427e4d6b181f70e
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#021d0d8b108648f2
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#0152143a72e9d2c0
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#86f60f6f70df4213
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#529afa875695a5ca
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#cb7f95f00dc6a449
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#69ee8e46180dc542
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#e77ff765c929c00e
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#e949727c169e716d
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#b7dff24ee9c74f94
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#3982ab0e9319ecd4
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#84c9f7f8c951d5af
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#54b02de13f62ac02
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#4d14fd61714ff50d
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#abb8adfb3e534523
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#97eeadb15de185ca
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#3d03a116b031f0ca
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#9f934464f9f4b303
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#5c1f3fcee35cbf26
// VIP-7 native differential under strict/exact/access/all/loose project options including real undefined and author-written access controls; rule: docs/design/vips/0007-match.md#63495d7641d04b8f
