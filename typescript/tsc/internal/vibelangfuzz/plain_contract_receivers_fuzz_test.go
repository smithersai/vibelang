package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const plainReceiverKindQuote = "A function's kind is decided by a keyword on the function, never by its body or by a type."
const plainReceiverResultQuote = "| plain | `function f() { }`, `() => …` | its result, as in TypeScript | TypeScript |"

func TestPlainContractReceiversQuoted(t *testing.T) {
	text := SpecText("001-functions.md")
	for _, quote := range []string{plainReceiverKindQuote, plainReceiverResultQuote} {
		if !strings.Contains(text, quote) {
			t.Fatal(quote)
		}
	}
}

// Ordinary synchronous calls return their TypeScript values. A capitalized
// lexical receiver does not turn that call into a service access.
func FuzzPlainContractReceivers(f *testing.F) {
	startShortBudget(f)
	keys := []string{"object-method", "arrow-property", "receiver-this", "static-method", "arrow-call", "function-call", "parameter-shadow", "block-local", "service-shadow", "nested-shadow"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(31))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestPlainContractReceiversQuoted(t)
		i := slices.Index(keys, key)
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(keys)
		}
		key = keys[i]
		name := []string{"Box", "box", "Box_2", "Thing"}[mode&3]
		source := ""
		switch key {
		case "object-method":
			source = "const N={key():\"field\"{return \"field\"}};export function f():string{return N.key()}"
		case "arrow-property":
			source = "const N={key:():string=>\"field\"};export function f():string{return N.key()}"
		case "receiver-this":
			source = "const N={value:\"field\",key():string{return this.value}};export function f():string{return N.key()}"
		case "static-method":
			source = "class N {static key():string{return \"field\"}};export function f():string{return N.key()}"
		case "arrow-call":
			source = "const N=():string=>\"field\";export function f():string{return N()}"
		case "function-call":
			source = "function N():string{return \"field\"};export function f():string{return N()}"
		case "parameter-shadow":
			source = "export function f(N:{key():string}):string{return N.key()}"
		case "block-local":
			source = "export function f():string{const N={key():string{return \"field\"}};return N.key()}"
		case "service-shadow":
			source = "service N {read():string};export function f(N:{key():string}):string{return N.key()}"
		case "nested-shadow":
			source = "const N={key():string{return \"outer\"}};export function f():string{const N={key():string{return \"inner\"}};return N.key()}"
		}
		source = strings.ReplaceAll(source, "N", name)
		if mode&16 != 0 {
			source = "// café λ🧪\n" + source
		}
		if mode&8 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		filename := "main.vibe"
		if mode&32 != 0 {
			filename = "main.vibex"
		}
		ctx := vibelangmapper.FileContext{FileName: filename, ModuleKey: "receiver"}
		for _, projection := range []vibelangmapper.Projection{vibelangmapper.Project(source, ctx), vibelangmapper.Executable(source, ctx)} {
			if len(projection.Diagnostics) != 0 {
				Gap(t, "FuzzPlainContractReceivers", key, "chapter 001 %q and %q: ordinary TypeScript call must not receive mapper diagnostics; mode=%d, got=%s; source=%s", plainReceiverKindQuote, plainReceiverResultQuote, mode, fmt.Sprint(projection.Diagnostics), source)
			}
		}
	})
}
