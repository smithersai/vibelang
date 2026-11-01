package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const matchOpenSubjectTarget = "FuzzMatchOpenSubject"

// Chapter 4, "Subjects" (VIP-7, decided details 10, 78 and 102); foldkit-71.
const matchOpenSubjectClosedQuote = "`EK4701` applies when every member is a literal type, `true`, `false`, `null`, `undefined`, an enum member, a `data` variant, an `error` or `schema error` instance, one of those six `Option`, `Exit` and `Result` cases, a retained Effect error ([Retained fixed patterns](#retained-fixed-patterns)), or a tagged member."
const matchOpenSubjectOpenQuote = "Any other member (`string`, `number`, an untagged object or class instance, `unknown`, `any`) turns the check off for that `match`, which keeps TC39's run-time `TypeError`."

func TestMatchOpenSubjectQuoted(t *testing.T) {
	chapter := SpecText("004-match.md")
	for _, quote := range []string{matchOpenSubjectClosedQuote, matchOpenSubjectOpenQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 4 no longer says %q; re-read the subjects rule before changing this oracle", quote)
		}
	}
}

type matchOpenSubject struct {
	name    string
	declare string   // the subject's type and any declarations it needs
	full    []string // arms that cover every case the type has
	partial []string // arms that leave a case out
	open    bool     // an untagged, string, number, class or unknown member: EK4701 is off
}

func matchOpenSubjects() []matchOpenSubject {
	pair := func(o, a string) string { return "when { orientation: \"" + o + "\", align: \"" + a + "\" }: 1;" }
	return []matchOpenSubject{
		{"object-required", "type Subject = { orientation: \"h\" | \"v\"; align: \"start\" | \"end\" };",
			[]string{pair("h", "start"), pair("h", "end"), pair("v", "start"), pair("v", "end")}, []string{pair("h", "start"), pair("v", "end")}, true},
		{"object-optional", "type Subject = { orientation?: \"h\" | \"v\" };",
			[]string{"when { orientation: \"h\" }: 1;", "when { orientation: \"v\" }: 2;", "when { orientation: undefined }: 3;"}, []string{"when { orientation: \"h\" }: 1;"}, true},
		{"class-instance", "class Subject { kind: \"a\" | \"b\" = \"a\" }",
			[]string{"when { kind: \"a\" }: 1;", "when { kind: \"b\" }: 2;"}, []string{"when { kind: \"a\" }: 1;"}, true},
		{"string", "type Subject = string;", []string{"when \"a\": 1;", "when \"b\": 2;"}, []string{"when \"a\": 1;"}, true},
		{"number", "type Subject = number;", []string{"when 1: 1;", "when 2: 2;"}, []string{"when 1: 1;"}, true},
		{"unknown", "type Subject = unknown;", []string{"when 1: 1;", "when \"a\": 2;"}, []string{"when 1: 1;"}, true},
		{"tagged-or-object", "type Subject = { _tag: \"A\" } | { x: number };",
			[]string{"when { _tag: \"A\" }: 1;", "when { x: let x }: 2;"}, []string{"when { _tag: \"A\" }: 1;"}, true},
		{"literal-or-string", "type Subject = \"a\" | string;", []string{"when \"a\": 1;", "when let other: 2;"}, []string{"when \"a\": 1;"}, true},
		// Closed subjects: the check applies and a missing case is EK4701.
		{"tagged", "type Subject = { _tag: \"A\" } | { _tag: \"B\" };", []string{"when { _tag: \"A\" }: 1;", "when { _tag: \"B\" }: 2;"}, []string{"when { _tag: \"A\" }: 1;"}, false},
		{"literals", "type Subject = \"a\" | \"b\";", []string{"when \"a\": 1;", "when \"b\": 2;"}, []string{"when \"a\": 1;"}, false},
		{"boolean", "type Subject = boolean;", []string{"when true: 1;", "when false: 2;"}, []string{"when true: 1;"}, false},
		{"option", "type Subject = Option.Option<number>;", []string{"when Option.Some(let value): value;", "when Option.None: 0;"}, []string{"when Option.None: 0;"}, false},
	}
}

// matchOpenSubjectProgram writes one match over the subject: full or partial
// arms, with or without default. The native control checks only that the
// subject's type and declarations are valid TypeScript.
func matchOpenSubjectProgram(subject matchOpenSubject, full, withDefault, native bool) string {
	prelude := ""
	if subject.name == "option" {
		prelude = "import { Option } from \"effect\";\n"
	}
	if native {
		return prelude + subject.declare + "\nexport function probe(s: Subject): number { void s; return 0 }\n"
	}
	arms := subject.partial
	if full {
		arms = subject.full
	}
	body := strings.Join(arms, " ")
	if withDefault {
		body += " default: 0;"
	}
	return prelude + subject.declare + "\nexport function probe(s: Subject): number { return match (s) { " + body + " } }\n"
}

// foldkit-71: an untagged object subject is outside the static exhaustiveness
// check. The oracle expects EK4701 exactly for a closed subject with a missing
// case and no default; every open subject compiles without it, whatever the
// arms cover. Run-time TypeError behaviour stays with the VIP-7 differential.
func FuzzMatchOpenSubject(f *testing.F) {
	startShortBudget(f)
	subjects := matchOpenSubjects()
	for _, subject := range subjects {
		for flags := range uint8(4) {
			f.Add(subject.name, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, name string, flags uint8) {
		TestMatchOpenSubjectQuoted(t)
		index := slices.IndexFunc(subjects, func(s matchOpenSubject) bool { return s.name == name })
		if index < 0 {
			if name == "" {
				return
			}
			index = int(name[0]) % len(subjects)
		}
		subject := subjects[index]
		flags %= 4
		full, withDefault := flags&1 != 0, flags&2 != 0
		key := fmt.Sprintf("%s:%d", subject.name, flags)
		expectGap := !subject.open && !full && !withDefault
		for _, native := range []bool{true, false} {
			source := matchOpenSubjectProgram(subject, full, withDefault, native)
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			var result *Result
			var err error
			within(t, "check match subject exhaustiveness", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			exhaustive, other := false, false
			for _, diagnostic := range result.Diagnostics {
				if IsEK(diagnostic) && diagnostic.Code() == 4701 {
					exhaustive = true
				} else if IsEK(diagnostic) || diagnostic.Category().Name() == "error" {
					other = true
				}
			}
			if native {
				if other || exhaustive {
					t.Fatalf("invalid native subject control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
				}
				continue
			}
			if exhaustive != expectGap || other {
				Gap(t, matchOpenSubjectTarget, key, "Chapter 4 subjects rule: open=%t full=%t default=%t expects EK4701=%t, got %v\n%s", subject.open, full, withDefault, expectGap, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
		}
		ExpectPending(t, matchOpenSubjectTarget, key)
		ExpectPending(t, matchOpenSubjectTarget, specCorpusKey(t))
	})
}
