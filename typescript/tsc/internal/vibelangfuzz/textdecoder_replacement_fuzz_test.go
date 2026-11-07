package vibelangfuzz

import (
	"maps"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const textDecoderTarget = "FuzzTextDecoderReplacement"

// Appendix E's row for decode, and the reason it gives: the Encoding
// standard throws only in a fatal decoder.
const textDecoderNeverQuote = "`@throws {never}` when the receiver is `new TextDecoder(…)`, or a `const` whose initializer is one, and its options argument is absent or an object literal with no spread and no computed key other than a string or number literal, whose `fatal` property, if any, is written `fatal: false`."
const textDecoderEncodingQuote = "The Encoding standard throws `TypeError` from `decode` only when the decoder's error mode is fatal, which `fatal: true` sets; any other decoder replaces malformed input with U+FFFD"

func TestTextDecoderReplacementQuoted(t *testing.T) { textDecoderQuoted(t) }

func textDecoderQuoted(t testing.TB) {
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{textDecoderNeverQuote, textDecoderEncodingQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("900-appendices.md no longer says %q", quote)
		}
	}
}

// textDecoderReceivers writes text(bytes), a plain function that decodes
// with a decoder made from ARGS, in each receiver form. Those named in
// textDecoderKnown are the forms the rule reads: new TextDecoder(…) itself
// or a const whose initializer is one.
var textDecoderReceivers = map[string]struct{ module, body string }{
	"inline":       {"", "return new TextDecoder(ARGS).decode(bytes)"},
	"paren":        {"", "return (new TextDecoder(ARGS)).decode(bytes)"},
	"const":        {"const decoder = new TextDecoder(ARGS)\n", "return decoder.decode(bytes)"},
	"local-const":  {"", "const decoder = new TextDecoder(ARGS)\n  return decoder.decode(bytes)"},
	"element":      {"const decoder = new TextDecoder(ARGS)\n", "return decoder[\"decode\"](bytes)"},
	"map-callback": {"const decoder = new TextDecoder(ARGS)\n", "return [bytes].map((chunk) => decoder.decode(chunk))[0]"},
	"let":          {"let decoder = new TextDecoder(ARGS)\n", "return decoder.decode(bytes)"},
	"const-alias":  {"const made = new TextDecoder(ARGS)\nconst decoder = made\n", "return decoder.decode(bytes)"},
	"parameter":    {"function read(decoder: TextDecoder, bytes: Uint8Array): string { return decoder.decode(bytes) }\n", "return read(new TextDecoder(ARGS), bytes)"},
}

var textDecoderKnown = []string{"inline", "paren", "const", "local-const", "element", "map-callback"}

// textDecoderOptions are the constructor's arguments; those in
// textDecoderReplacing write no fatal other than fatal: false.
var textDecoderOptions = map[string]string{
	"none":           "",
	"label":          `"utf-8"`,
	"empty":          `"utf-8", {}`,
	"bom":            `"utf-8", { ignoreBOM: true }`,
	"false":          `"utf-8", { fatal: false }`,
	"false-paren":    `"utf-8", { fatal: (false) }`,
	"quoted-false":   `"utf-8", { "fatal": false }`,
	"computed-false": `"utf-8", { ["fatal"]: false }`,
	"true":           `"utf-8", { fatal: true }`,
	"quoted-true":    `"utf-8", { "fatal": true }`,
	"computed-true":  `"utf-8", { ["fatal"]: true }`,
	"computed-name":  `"utf-8", { [fatalName]: true }`,
	"flag":           `"utf-8", { fatal: flag }`,
	"shorthand":      `"utf-8", { fatal }`,
	"getter":         `"utf-8", { get fatal() { return true } }`,
	"spread":         `"utf-8", { ...fatalOptions }`,
	"variable":       `"utf-8", fatalOptions`,
	"undefined":      `"utf-8", undefined`,
}

var textDecoderReplacing = []string{"none", "label", "empty", "bom", "false", "false-paren", "quoted-false", "computed-false"}

// The witnesses -short runs: Smithers' three shapes, every options form on
// an inline receiver, and every receiver form with a fatal and a plain
// decoder.
func textDecoderShortKeys() []string {
	keys := []string{"const/bom", "map-callback/none"}
	for _, options := range slices.Sorted(maps.Keys(textDecoderOptions)) {
		keys = append(keys, "inline/"+options)
	}
	for _, receiver := range slices.Sorted(maps.Keys(textDecoderReceivers)) {
		if receiver != "inline" {
			keys = append(keys, receiver+"/none", receiver+"/true")
		}
	}
	return keys
}

// Each receiver form crossed with each options form: EK0401 appears exactly
// when Appendix E keeps TypeError, and a decode the compiler accepts as
// throwing never does not throw on malformed input when its .ts twin runs.
// The first is a static-rule oracle; the second checks the rule against
// Node's Encoding implementation.
func FuzzTextDecoderReplacement(f *testing.F) {
	startShortBudget(f)
	textDecoderQuoted(f)
	var keys []string
	for _, receiver := range slices.Sorted(maps.Keys(textDecoderReceivers)) {
		for _, options := range slices.Sorted(maps.Keys(textDecoderOptions)) {
			keys = append(keys, receiver+"/"+options)
		}
	}
	seeds := keys
	if testing.Short() {
		seeds = textDecoderShortKeys()
	}
	for _, key := range seeds {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		key := strings.TrimPrefix(string(data), "key:")
		if !slices.Contains(keys, key) {
			if len(data) == 0 {
				return
			}
			key = keys[int(data[0])%len(keys)]
		}
		receiverName, optionsName, _ := strings.Cut(key, "/")
		receiver := textDecoderReceivers[receiverName]
		args := textDecoderOptions[optionsName]
		source := "const flag: boolean = Math.random() < 2\nconst fatal: boolean = true\nconst fatalName: string = \"fatal\"\nconst fatalOptions: TextDecoderOptions = { fatal: true }\n" +
			strings.ReplaceAll(receiver.module, "ARGS", args) +
			"export function text(bytes: Uint8Array): string {\n  " + strings.ReplaceAll(receiver.body, "ARGS", args) + "\n}\n" +
			"export function probe(): string { return text(new Uint8Array([0x61, 0xff, 0x62])) }\n" +
			"export const unused = [flag, fatal, fatalName, fatalOptions]\n"
		stock := toolsCompile(t, w, textDecoderTarget, map[string]string{"main.ts": source})
		defer stock.Remove()
		if !toolsErrorFree(stock) {
			t.Fatalf("invalid .ts control: %v\n%s", SortedKeys(Keys(stock.Dir, stock.Diagnostics)), source)
		}
		native := toolsCompile(t, w, textDecoderTarget, map[string]string{"main.vibe": source})
		defer native.Remove()
		throws := false
		for _, d := range native.Diagnostics {
			switch {
			case IsEK(d) && d.Code() == 401:
				throws = true
			case d.Category() == diagnostics.CategoryError:
				t.Fatalf("an error other than EK0401: %s\n%s", d.String(), source)
			}
		}
		never := slices.Contains(textDecoderKnown, receiverName) && slices.Contains(textDecoderReplacing, optionsName)
		if throws == never {
			Gap(t, textDecoderTarget, key, "Appendix E: %q; EK0401=%t\n%s", textDecoderNeverQuote, throws, source)
		}
		if !throws {
			if ran := node.Run(stock, "out/main.js", "probe"); ran.Kind != "plain" {
				Gap(t, textDecoderTarget, "runtime:"+key, "Appendix E: %q; accepted as throwing never, but the .ts twin gives %s %s %s\n%s", textDecoderEncodingQuote, ran.Kind, ran.Tag, ran.Log, source)
			}
		}
		ExpectPending(t, textDecoderTarget, key)
		ExpectPending(t, textDecoderTarget, "runtime:"+key)
	})
}
