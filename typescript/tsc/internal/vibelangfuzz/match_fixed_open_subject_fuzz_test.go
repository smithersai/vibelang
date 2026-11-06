package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const fixedOpenSubjectTarget = "FuzzFixedPatternOpenSubjects"
const fixedOpenSubjectQuote = "| fixed \x60Option.Some(let v)\x60 | \x60Option.isOption(s) && Option.isSome(s)\x60 | \x60v\x60: \x60A\x60 for \x60Option<A>\x60; \x60unknown\x60 for an \x60unknown\x60 subject |"
const fixedOpenSubjectOptionsQuote = "Patterns type as the TypeScript counterpart this chapter shows for them, under the project's compiler options"

func fixedOpenSubjectQuotes(tb testing.TB) {
	tb.Helper()
	for _, quote := range []string{fixedOpenSubjectQuote, fixedOpenSubjectOptionsQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			tb.Fatalf("fixed pattern typing rule changed: %q", quote)
		}
	}
}

func TestFixedPatternOpenSubjectsQuoted(t *testing.T) { fixedOpenSubjectQuotes(t) }

type fixedOpenSubjectPattern struct{ key, pattern, brand, guard, field, declared, loose string }

var fixedOpenSubjectPatterns = []fixedOpenSubjectPattern{
	{"option-some", "Option.Some", "Option.isOption", "Option.isSome", "value", "Option.Option<number>", "Option.Option<any>"},
	{"result-success", "Result.Success", "Result.isResult", "Result.isSuccess", "success", "Result.Result<number, string>", "Result.Result<any, any>"},
	{"result-failure", "Result.Failure", "Result.isResult", "Result.isFailure", "failure", "Result.Result<number, string>", "Result.Result<any, any>"},
	{"exit-success", "Exit.Success", "Exit.isExit", "Exit.isSuccess", "value", "Exit.Exit<number, string>", "Exit.Exit<any, any>"},
	{"exit-failure", "Exit.Failure", "Exit.isExit", "Exit.isFailure", "cause", "Exit.Exit<number, string>", "Exit.Exit<any, any>"},
}

var fixedOpenSubjectKinds = []string{"unknown", "any", "empty", "object", "declared", "any-argument", "union"}

func fixedOpenSubjectType(pattern fixedOpenSubjectPattern, kind string) string {
	switch kind {
	case "empty":
		return "{}"
	case "declared":
		return pattern.declared
	case "any-argument":
		return pattern.loose
	case "union":
		return "string | " + pattern.declared
	}
	return kind
}

// The extraction's type is written once as what the native guards leave on the
// subject's field, and the TypeScript program checks that it agrees. The same
// assertion must hold for the pattern's binding.
func FuzzFixedPatternOpenSubjects(f *testing.F) {
	startShortBudget(f)
	fixedOpenSubjectQuotes(f)
	var keys []string
	for _, pattern := range fixedOpenSubjectPatterns {
		for _, kind := range fixedOpenSubjectKinds {
			key := pattern.key + "/" + kind
			keys = append(keys, key)
			f.Add(key)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		index := slices.Index(keys, key)
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) * 31 % len(keys)
			key = keys[index]
		}
		pattern := fixedOpenSubjectPatterns[index/len(fixedOpenSubjectKinds)]
		subject := fixedOpenSubjectType(pattern, fixedOpenSubjectKinds[index%len(fixedOpenSubjectKinds)])
		header := "import { Exit, Option, Result } from \"effect\";" +
			"type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;" +
			"type Is<A extends true>=A;"
		native := header + fmt.Sprintf("declare const s: %s;"+
			"export function read(){if(%s(s)&&%s(s)){const value=s.%s;return value}return undefined}"+
			"export type Read=Exclude<ReturnType<typeof read>,undefined>;",
			subject, pattern.brand, pattern.guard, pattern.field)
		custom := header + fmt.Sprintf("declare const s: %s;"+
			"export function read(){return match (s) {when %s(let value): value;default: undefined;}}"+
			"export type Read=Exclude<ReturnType<typeof read>,undefined>;",
			subject, pattern.pattern)
		compile := func(file, source string) (string, []string) {
			config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"declaration\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"" + file + "\"]}"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
				}
			}
			for name, output := range r.Outputs {
				if strings.HasSuffix(name, ".d.ts") {
					for line := range strings.SplitSeq(output, "\n") {
						if strings.HasPrefix(line, "export declare function read") {
							return line, errors
						}
					}
				}
			}
			return "", errors
		}
		nativeDeclaration, errors := compile("main.ts", native)
		if len(errors) != 0 {
			Gap(t, fixedOpenSubjectTarget, "native:"+key, "%s: the counterpart fails: %v", fixedOpenSubjectOptionsQuote, errors)
			return
		}
		customDeclaration, errors := compile("main.vibe", custom)
		if len(errors) != 0 {
			Gap(t, fixedOpenSubjectTarget, "custom:"+key, "%s: %v\n%s", fixedOpenSubjectQuote, errors, custom)
			return
		}
		if nativeDeclaration == "" || nativeDeclaration != customDeclaration {
			Gap(t, fixedOpenSubjectTarget, "type:"+key, "%s: %s\nnative:\n%s\ncustom:\n%s", fixedOpenSubjectOptionsQuote, custom, nativeDeclaration, customDeclaration)
			return
		}
		ExpectPending(t, fixedOpenSubjectTarget, "native:"+key)
		ExpectPending(t, fixedOpenSubjectTarget, "custom:"+key)
		ExpectPending(t, fixedOpenSubjectTarget, "type:"+key)
		ExpectPending(t, fixedOpenSubjectTarget, specCorpusKey(t))
	})
}
