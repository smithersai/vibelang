package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 2 (decided detail 239, loop round 1 ASTRA-9): "A plain handler with
// an explicit `throw` that can complete it gets a VIP-38 lint warning
// (`EK0511`)", and "A `throw` caught inside the handler, or written in a
// nested function, does not warn." The quotes are read from the chapter at
// test time. The generator wraps one `throw e` in up to three statements and
// function boundaries; the oracle is the chapter's rule: the throw can complete
// the handler exactly when no enclosing `try` block catches it and no nested
// function owns it, and then the plain handler, and only it, warns.
var plainHandlerThrowQuotes = []string{
	"A plain handler with an explicit `throw` that can complete it gets a VIP-38 lint warning (`EK0511`)",
	"A `throw` caught inside the handler, or written in a nested function, does not warn.",
}

type plainHandlerWrapper struct {
	key, open, close string
	catches, boundary, plainOnly bool
}

var plainHandlerWrappers = []plainHandlerWrapper{
	{key: "block", open: "{ ", close: " }"},
	{key: "if", open: "if (e.length > 0) { ", close: " }"},
	{key: "label", open: "out: { ", close: " }"},
	{key: "switch", open: "switch (e) { case \"x\": { ", close: " } }"},
	{key: "loop", open: "for (const c of e) { ", close: " }"},
	{key: "try", open: "try { ", close: " } catch { }", catches: true, plainOnly: true},
	{key: "catch", open: "try { } catch { ", close: " }", plainOnly: true},
	{key: "finally", open: "try { } finally { ", close: " }", plainOnly: true},
	{key: "arrow", open: "const g = () => { ", close: " }", boundary: true},
	{key: "function", open: "function g() { ", close: " }", boundary: true},
	{key: "method", open: "const o = { m() { ", close: " } }", boundary: true},
}

func plainHandlerThrowChapter(tb testing.TB) {
	chapter := SpecText("002-running.md")
	for _, quote := range plainHandlerThrowQuotes {
		if !strings.Contains(chapter, quote) {
			tb.Fatalf("chapter 2 no longer says %q", quote)
		}
	}
}

func TestPlainHandlerThrowQuoted(t *testing.T) { plainHandlerThrowChapter(t) }

// plainHandlerShape reads a keyed input ("effect/if.try") or, for other bytes,
// picks the handler kind and up to three wrappers from them.
func plainHandlerShape(data []byte) (effect bool, wrappers []plainHandlerWrapper) {
	text := string(data)
	keyed := true
	kind, path, found := strings.Cut(text, "/")
	if !found {
		kind, path = "plain", text
	}
	if kind != "plain" && kind != "effect" {
		keyed = false
	}
	if keyed && path != "" && path != "direct" {
		for _, name := range strings.Split(path, ".") {
			at := slices.IndexFunc(plainHandlerWrappers, func(w plainHandlerWrapper) bool { return w.key == name })
			if at < 0 {
				keyed = false
				break
			}
			wrappers = append(wrappers, plainHandlerWrappers[at])
		}
	}
	if keyed {
		return kind == "effect", wrappers
	}
	wrappers = nil
	if len(data) > 0 {
		effect = data[0]&0x80 != 0
		for _, b := range data[1:min(len(data), 4)] {
			wrappers = append(wrappers, plainHandlerWrappers[int(b)%len(plainHandlerWrappers)])
		}
	}
	return effect, wrappers
}

func FuzzPlainHandlerThrow(f *testing.F) {
	startShortBudget(f)
	plainHandlerThrowChapter(f)
	f.Add([]byte("plain/direct"))
	f.Add([]byte("effect/direct"))
	for _, w := range plainHandlerWrappers {
		f.Add([]byte("plain/" + w.key))
	}
	for _, seed := range []string{"plain/if.try", "plain/try.if", "plain/catch.if", "plain/arrow.try", "plain/try.arrow", "plain/label.finally", "plain/loop.switch", "effect/if.label", "effect/arrow"} {
		f.Add([]byte(seed))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		effect, wrappers := plainHandlerShape(data)
		if effect && slices.ContainsFunc(wrappers, func(w plainHandlerWrapper) bool { return w.plainOnly }) {
			// A try statement in effect code is EK0503, outside this rule.
			effect = false
		}
		escapes := !slices.ContainsFunc(wrappers, func(w plainHandlerWrapper) bool { return w.catches || w.boundary })
		var names []string
		body := "throw e"
		for i := len(wrappers) - 1; i >= 0; i-- {
			body = wrappers[i].open + body + wrappers[i].close
		}
		for _, w := range wrappers {
			names = append(names, w.key)
		}
		handler := "(e) => { " + body + "; return 1 }"
		if len(wrappers) == 0 {
			handler = "(e) => { throw e }"
		}
		kind := "catch"
		if effect {
			kind = "catch effect"
		}
		shape := "plain/" + strings.Join(names, ".")
		if effect {
			shape = "effect/" + strings.Join(names, ".")
		}
		source := "declare const load: Effect.Effect<number, string>\nexport effect function main() {\n  return try (load " + kind + " " + handler + ")\n}\n"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		warned := false
		var errs []string
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 511 {
				warned = true
			}
			if d.Category() == diagnostics.CategoryError {
				errs = append(errs, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
			}
		}
		if len(errs) > 0 {
			Gap(t, "FuzzPlainHandlerThrow", "compile:"+shape, "the handler %s should compile:\n%s\n%s", shape, source, strings.Join(errs, "\n"))
			return
		}
		want := escapes && !effect
		switch {
		case want && !warned:
			Gap(t, "FuzzPlainHandlerThrow", "missing:EK0511", "chapter 2: %s; no EK0511 for %s:\n%s", plainHandlerThrowQuotes[0], shape, source)
			return
		case warned && !want:
			Gap(t, "FuzzPlainHandlerThrow", "spurious:EK0511", "chapter 2: %s; EK0511 for %s:\n%s", plainHandlerThrowQuotes[1], shape, source)
			return
		}
		if want {
			ExpectPending(t, "FuzzPlainHandlerThrow", "missing:EK0511")
		} else {
			ExpectPending(t, "FuzzPlainHandlerThrow", "spurious:EK0511")
		}
	})
}
