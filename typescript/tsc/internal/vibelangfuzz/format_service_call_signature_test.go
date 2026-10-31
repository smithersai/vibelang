package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestFormatRecoveredServiceCallsQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"005-services.md": "a call signature `(x: number): string`",
		"007-tooling.md":  "An unparsable file is reported and left unchanged; formatting is idempotent.",
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

func TestFormatRecoveredServiceCalls(t *testing.T) {
	TestFormatRecoveredServiceCallsQuoted(t)
	for _, source := range []string{
		`service Call { static readonly key = "format/Call"; (x: number): string }`,
		`service Call { static readonly key = "format/Call"; <T>(x: T): T }`,
	} {
		if got := formatSyntaxError(source); !strings.Contains(got, "EK0902") {
			t.Errorf("forbidden recovered service call signature: want EK0902, got %q\n%s", got, source)
		}
	}
	for _, source := range []string{
		`interface Fn { (x: number): string }`,
		`type Fn = { <T>(x: T): T }`,
		`service Holder { static readonly key = "format/Holder"; call: (x: number) => string }`,
		`service Holder { static readonly key = "format/Holder"; call: { (x: number): string } }`,
		`service Callable: { (x: number): string } { static readonly key = "format/Callable" }`,
		`service Constructible { static readonly key = "format/Constructible"; new(): number }`,
	} {
		if got := formatSyntaxError(source); got != "" {
			t.Errorf("native signature or formatable recovery was excluded: %s\n%s", got, source)
		}
	}
}
