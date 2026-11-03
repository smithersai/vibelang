package vibelangfuzz

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 3, "Plain code never throws", PREVIEW-5 (rev-preview pass 18): a
// function literal passed where throws are admitted, Effect.try's thunk or
// the Promise executor, may hold calls known to throw in its own body; a
// function nested in it, whether returned, stored, passed on or called in
// place, is its own plain code and keeps the check, since a returned
// callback runs after the call has finished. The generator places one
// JSON.parse call in an admitted literal, directly or under depth functions
// that escape in one of several ways. The oracle: no EK0401 for the direct
// call, exactly one for any nested call. The quotes are read from the chapter
// at test time.
var nothrowEscapeQuotes = []string{
	"may contain calls known to throw: they belong to the enclosing call, which is checked where it sits.",
	"A function nested in such a literal, whether it is returned, stored, passed on or called in place, is its own plain code and keeps this check",
}

func nothrowEscapeChapter(tb testing.TB) {
	chapter := SpecText("003-failures.md")
	for _, quote := range nothrowEscapeQuotes {
		if !strings.Contains(chapter, quote) {
			tb.Fatalf("chapter 3 no longer says %q", quote)
		}
	}
}

func TestNothrowAdmittedEscapeQuoted(t *testing.T) { nothrowEscapeChapter(t) }

// nothrowWrappers write the admitted literal around body, a block of
// statements that returns.
var nothrowWrappers = []struct {
	key  string
	wrap func(body string) string
}{
	{"effect-try", func(b string) string {
		return "export effect function f() {\n  return try Effect.try(() => {\n    " + b + "\n  })\n}\n"
	}},
	{"effect-try-object", func(b string) string {
		return "export effect function f() {\n  return try Effect.try({ try: () => {\n    " + b + "\n  }, catch: (cause) => new Bad({ cause }) })\n}\n"
	}},
	{"promise-executor", func(b string) string {
		// the executor's return value is ignored; resolve stays unused
		return "export function f(): unknown {\n  return new Promise((resolve) => {\n    " + b + "\n  })\n}\n"
	}},
}

// nothrowEscapes write the statements that return expr from the literal,
// expr running inside a function of the escape's kind; direct runs it in the
// literal itself.
var nothrowEscapes = []struct {
	key  string
	body func(expr string) string
}{
	{"direct", func(e string) string { return "return " + e }},
	{"returned-arrow", func(e string) string { return "return (): unknown => " + e }},
	{"named-function", func(e string) string { return "function read(): unknown { return " + e + " }\n    return read" }},
	{"object-method", func(e string) string { return "return { read(): unknown { return " + e + " } }" }},
	{"class-method", func(e string) string { return "return class { read(): unknown { return " + e + " } }" }},
	{"stored-callback", func(e string) string { return "sink.read = (): unknown => " + e + "\n    return sink" }},
	{"called-in-place", func(e string) string { return "return ((): unknown => " + e + ")()" }},
	{"passed-on", func(e string) string { return "return [1].map((): unknown => " + e + ")" }},
}

// nothrowEscapeShape reads a keyed input ("effect-try/returned-arrow/2") or,
// for other bytes, picks the wrapper, escape and depth by byte. Depth is the
// number of functions between the literal and the call: 0 only for direct,
// 1 to 3 otherwise, the extra levels arrows that return the next.
func nothrowEscapeShape(data []byte) (wrapper, escape, depth int) {
	parts := strings.Split(string(data), "/")
	if len(parts) == 3 {
		w := slices.IndexFunc(nothrowWrappers, func(w struct {
			key  string
			wrap func(string) string
		}) bool {
			return w.key == parts[0]
		})
		e := slices.IndexFunc(nothrowEscapes, func(e struct {
			key  string
			body func(string) string
		}) bool {
			return e.key == parts[1]
		})
		d, err := strconv.Atoi(parts[2])
		if w >= 0 && e >= 0 && err == nil {
			wrapper, escape, depth = w, e, d
		}
	} else {
		for len(data) < 3 {
			data = append(data, 0)
		}
		wrapper, escape, depth = int(data[0])%len(nothrowWrappers), int(data[1])%len(nothrowEscapes), int(data[2])%3+1
	}
	if escape == 0 {
		depth = 0
	} else {
		depth = max(1, min(depth, 3))
	}
	return wrapper, escape, depth
}

func FuzzNothrowAdmittedEscape(f *testing.F) {
	startShortBudget(f)
	nothrowEscapeChapter(f)
	for _, w := range nothrowWrappers {
		for _, e := range nothrowEscapes {
			f.Add([]byte(w.key + "/" + e.key + "/1"))
		}
	}
	for _, seed := range []string{"effect-try/returned-arrow/3", "effect-try/object-method/2", "effect-try-object/stored-callback/2", "promise-executor/called-in-place/3", "promise-executor/named-function/2"} {
		f.Add([]byte(seed))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		wrapper, escape, depth := nothrowEscapeShape(data)
		shape := nothrowWrappers[wrapper].key + "/" + nothrowEscapes[escape].key + "/" + strconv.Itoa(depth)
		expr := "JSON.parse(\"{\")"
		for range max(depth-1, 0) {
			expr = "(): unknown => " + expr
		}
		code := nothrowWrappers[wrapper].wrap(nothrowEscapes[escape].body(expr))
		source := "error Bad { cause: unknown }\ndeclare const sink: { read?: () => unknown }\n" + code
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		reported := 0
		var errs []string
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 401 {
				reported++
				continue
			}
			errs = append(errs, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
		}
		if len(errs) > 0 {
			Gap(t, "FuzzNothrowAdmittedEscape", "compile:"+shape, "%s should have no error but EK0401:\n%s\n%s", shape, source, strings.Join(errs, "\n"))
			return
		}
		want, quote := 1, nothrowEscapeQuotes[1]
		if depth == 0 {
			want, quote = 0, nothrowEscapeQuotes[0]
		}
		if reported != want {
			Gap(t, "FuzzNothrowAdmittedEscape", fmt.Sprintf("EK0401:%d:%s", want, shape), "chapter 3: %q; want %d EK0401, got %d for %s:\n%s", quote, want, reported, shape, source)
			return
		}
		ExpectPending(t, "FuzzNothrowAdmittedEscape", fmt.Sprintf("EK0401:%d:%s", want, shape))
	})
}
