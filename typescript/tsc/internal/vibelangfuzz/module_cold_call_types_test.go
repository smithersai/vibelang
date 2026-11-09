package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const moduleColdCallsQuote = "Calling an `effect` function returns its Effect unrun, as calling an `async` function returns a Promise."
const moduleTopLevelQuote = "A module's top level is ordinary JavaScript (VIP-26)."
const moduleUnnamedServiceQuote = "A service in a file outside any package (or in one whose `package.json` has no string `name`), or declared inside a function or block, has no derived key: omitting `static readonly key` there is a compile error (`EK0903`); write an explicit key."

func TestModuleColdCallTypesQuoted(t *testing.T) {
	for chapter, quotes := range map[string][]string{
		"001-functions.md": {moduleColdCallsQuote, moduleTopLevelQuote},
		"005-services.md":  {moduleUnnamedServiceQuote},
	} {
		for _, quote := range quotes {
			if !strings.Contains(SpecText(chapter), quote) {
				t.Errorf("%s no longer says %q", chapter, quote)
			}
		}
	}
}

func FuzzModuleColdCallTypes(f *testing.F) {
	startShortBudget(f)
	keys := []string{"held", "array", "object", "field", "parameter", "identity", "arrow", "constructor", "getter", "static", "nested", "primitive"}
	for _, key := range keys {
		f.Add(key, uint8(7), uint8(0))
	}
	f.Add("key-fallback", uint8(13), uint8(3))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, number, variant uint8) {
		TestModuleColdCallTypesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		call := "work()"
		if variant&2 != 0 {
			call = "(/* keep cold-call comment */ work())"
		}
		var body string
		switch key {
		case "held":
			body = "export const held: number!! = " + call
		case "array":
			body = "export const held = [" + call + "]"
		case "object":
			body = "export const held = { program: " + call + " }"
		case "field":
			body = "export class Store { readonly held: number!! = " + call + " }"
		case "parameter":
			body = "export function read(held: number!! = " + call + ") { return held }; export const held=read()"
		case "identity":
			body = "function keep<T>(value: T): T { return value }; export const held=keep(" + call + ")"
		case "arrow":
			body = "export const held=(() => " + call + ")()"
		case "constructor":
			body = "export class Store { readonly held: number!!; constructor() { this.held = " + call + " } }"
		case "getter":
			body = "export class Store { get held() { return " + call + " } }"
		case "static":
			body = "export class Store { static readonly held: number!! = " + call + " }"
		case "nested":
			body = "export const held = ({ read() { return " + call + " } }).read()"
		case "primitive":
			body = "export const held: number = " + call
		}
		source := fmt.Sprintf("effect function work() { return %d }\n%s\n", int(number)%31+1, body)
		if variant&1 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		result := toolsCompile(t, w, "FuzzModuleColdCallTypes", map[string]string{"main.vibe": source})
		defer result.Remove()
		probeKey := fmt.Sprintf("feature:%s:%d", key, variant&3)
		found := false
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == 1001 {
				Gap(t, "FuzzModuleColdCallTypes", probeKey, "VIP-26: retired implicit execution diagnostic returned: %s", d.String())
			}
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if key == "primitive" && !IsEK(d) && d.Code() == 2322 {
				found = true
				continue
			}
			Gap(t, "FuzzModuleColdCallTypes", probeKey, "VIP-26: %q; unexpected diagnostic: %s\n%s", moduleColdCallsQuote, d.String(), source)
		}
		if key == "primitive" && !found {
			Gap(t, "FuzzModuleColdCallTypes", probeKey, "VIP-26: a cold Effect was accepted as its success value\n%s", source)
		}
		ExpectPending(t, "FuzzModuleColdCallTypes", probeKey)
	})
}
