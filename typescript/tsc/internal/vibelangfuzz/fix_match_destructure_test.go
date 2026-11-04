package vibelangfuzz

import (
	"fmt"
	"strconv"
	"strings"
	"testing"
)

// VIP-34, 007-tooling: "A quick fix is offered only when it preserves
// evaluation order, coldness, types, comments, and declaration output".
// "Use `match`, or a function returning `match` for `Match.type`, only for
// patterns and handlers whose tests and results are preserved."
// These keyed inputs expand into programs for FuzzFix's existing before/after
// result and contract oracle. Fuzz bytes vary predicate, binding and fallback;
// all subjects (absent, undefined, present, inherited and nonmatching) run.
func TestMatchHandlerDestructureQuoted(t *testing.T) {
	for _, quote := range []string{
		"A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output",
		"only for patterns and handlers whose tests and results are preserved.",
	} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("missing VIP-34 quote: %s", quote)
		}
	}
}

func matchDestructureArchive(input string) string {
	const prefix = "match-handler-destructure:"
	if !strings.HasPrefix(input, prefix) {
		return input
	}
	fields := strings.SplitN(strings.TrimPrefix(input, prefix), ":", 3)
	mode := fields[0]
	binding, result := "{payload}", "payload ?? fallback"
	switch mode {
	case "assign":
		binding, result = "{payload = fallback}", "payload"
	case "ordered":
		binding, result = "{[payloadKey()]:payload = fallbackValue(fallback)}", "payload"
	case "computed":
		binding, result = "{[\"payload\"]:payload = fallback}", "payload"
	case "default":
		binding, result = "{payload = fallback}", "payload"
	case "nested":
		binding, result = "{box:{payload = fallback} = {}}", "payload"
	case "rest":
		binding, result = "{kind, ...rest}", "rest.payload ?? kind"
	case "rename":
		binding, result = "{payload: renamed = fallback}", "renamed"
	case "scope":
		binding, result = "{payload = fallback}", "payload + fallback"
	}
	tag := len(fields) > 1 && fields[1] == "tag"
	pattern := "Match.when({kind:'hit'}, "
	typ := "{kind:string; payload?:string; box?:{payload?:string}}"
	discriminator := "kind"
	if tag {
		pattern, typ, discriminator = "Match.tag('hit', ", "{_tag:'hit'; payload?:string; box?:{payload?:string}} | {_tag:'miss'}", "_tag"
		if mode == "rest" {
			binding, result = "{_tag, ...rest}", "rest.payload ?? _tag"
		}
	}
	fallback := "empty"
	if len(fields) > 2 {
		fallback = fields[2]
		if len(fallback) > 40 {
			fallback = fallback[:40]
		}
	}
	body := "{ selected.push(\"hit\"); return " + result + " }"
	if mode == "assign" {
		body = "{ selected.push(\"hit\"); payload = fallback + payload; return payload }"
	}
	if mode == "scope" {
		body = "{ selected.push(\"hit\"); const fallback = 'inner'; return " + result + " }"
	}
	source := fmt.Sprintf(`import { Match } from "effect"
type Input = %s
let selected: string[] = []
function payloadKey(): "payload" { selected.push("key"); return "payload" }
function fallbackValue(value:string):string { selected.push("default"); return value }
export function choose(value:Input):string {
 const fallback = %s
 const $matchHandler = "outer"
 return Match.value(value).pipe(%s(%s):string => %s), Match.orElse(():string => { selected.push("miss"); return "miss" }))
}
export effect function main() {
 selected = []
 const inherited = (try Effect.try(() => Object.create({payload:"inherited",box:{payload:"inherited"}}))) as Input
 inherited.%s = "hit"
 let reads = 0
 const getter = {%s:"hit" as const, get payload() { reads++; return "getter" }, get box() { reads++; return {payload:"getter"} }}
 const values:Input[] = [{%s:"hit"}, {%s:"hit",payload:undefined}, {%s:"hit",payload:"present",box:{payload:"present"}}, {%s:"miss"}, inherited, getter]
 const results = try Effect.try(() => values.map(choose))
 return {selected, results, reads}
}
`, typ, strconv.Quote(fallback), pattern, binding, body, discriminator, discriminator, discriminator, discriminator, discriminator, discriminator)
	if mode == "exhaustive" && tag {
		old := "Match.value(value).pipe(" + pattern + "(" + binding + "):string => " + body + "), Match.orElse(():string => { selected.push(\"miss\"); return \"miss\" }))"
		replacement := "Match.value(value).pipe(Match.withReturnType<string>(), Match.tagsExhaustive({ hit: (" + binding + "):string => " + body + ", miss: ():string => { selected.push(\"miss\"); return \"miss\" } }))"
		if strings.Count(source, old) != 1 {
			panic("exhaustive Match generator shape changed")
		}
		source = strings.Replace(source, old, replacement, 1)
	}
	return Archive(map[string]string{"main.vibe": source})
}

// Every keyed template must reach the runtime oracle. An invalid source or a
// missing Effect entry would otherwise make a before/after check vacuous.
func TestMatchHandlerDestructureProjects(t *testing.T) {
	w := NewWorkspace(t)
	for _, mode := range []string{"missing", "default", "nested", "rest", "rename", "scope", "assign", "computed", "ordered", "exhaustive"} {
		for _, predicate := range []string{"when", "tag"} {
			t.Run(mode+"-"+predicate, func(t *testing.T) {
				source := matchDestructureArchive("match-handler-destructure:" + mode + ":" + predicate + ":empty")
				r := toolsCompile(t, w, "FuzzFix", toolsUnarchive(source))
				defer r.Remove()
				if !toolsErrorFree(r) {
					var notes []string
					for _, d := range r.Diagnostics {
						notes = append(notes, d.String())
					}
					t.Fatalf("invalid generated project (emit skipped=%v):\n%s\n%s", r.EmitSkipped, strings.Join(notes, "\n"), source)
				}
				entries := toolsRunnableExports(r)
				if len(entries) != 1 || entries[0].name != "main" {
					t.Fatalf("generated project has no unique runnable main: %+v", entries)
				}
			})
		}
	}
}

// Both focused targets run the complete converter oracle; separate workers and
// budgets keep each predicate family below the short-target seed budget.
func FuzzMatchWhenDestructure(f *testing.F) {
	startShortBudget(f)
	fuzzFixProjects(f, "FuzzMatchWhenDestructure")
}
func FuzzMatchTagDestructure(f *testing.F) {
	startShortBudget(f)
	fuzzFixProjects(f, "FuzzMatchTagDestructure")
}
