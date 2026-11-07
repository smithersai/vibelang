package ls

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// A provider fixes a diagnostic under its own code and under a registered
// alias of that code from the same source, and sees the original code.
func TestProviderFixCodeFollowsAliases(t *testing.T) {
	const source = "alias-test"
	RegisterCodeFixAlias(source, 38999, 4999)
	t.Cleanup(func() { delete(codeFixAliases, source) })
	provider := &CodeFixProvider{Source: source, ErrorCodes: []int32{4999}}
	other := &CodeFixProvider{Source: source, ErrorCodes: []int32{4998}}
	diagnostic := func(source string, code int32) *lsproto.Diagnostic {
		return &lsproto.Diagnostic{Source: &source, Code: &lsproto.IntegerOrString{Integer: &code}}
	}
	for _, test := range []struct {
		name       string
		provider   *CodeFixProvider
		diagnostic *lsproto.Diagnostic
		code       int32
		ok         bool
	}{
		{"own code", provider, diagnostic(source, 4999), 4999, true},
		{"alias", provider, diagnostic(source, 38999), 4999, true},
		{"alias of another source", provider, diagnostic("ts", 38999), 0, false},
		{"alias of a code the provider does not fix", other, diagnostic(source, 38999), 0, false},
		{"unrelated code", provider, diagnostic(source, 38998), 0, false},
		{"no code", provider, &lsproto.Diagnostic{}, 0, false},
	} {
		code, ok := providerFixCode(test.provider, test.diagnostic)
		if code != test.code || ok != test.ok {
			t.Errorf("%s: got %d %v, want %d %v", test.name, code, ok, test.code, test.ok)
		}
		if matched := codeFixProviderMatchesLSPDiagnostic(test.provider, test.diagnostic); test.diagnostic.Source != nil && matched != test.ok {
			t.Errorf("%s: provider match %v, want %v", test.name, matched, test.ok)
		}
	}
}
