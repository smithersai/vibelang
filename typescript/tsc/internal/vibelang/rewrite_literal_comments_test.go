package vibelang

import "testing"

func TestRewriteLiteralComments(t *testing.T) {
	for _, test := range []struct {
		name, before, after string
		want                bool
	}{
		{"url", `consume("https://example.test");`, `return consume("https://example.test").host;`, true},
		{"single quoted", `consume('// literal');`, `return consume('// literal').length;`, true},
		{"block-looking string", `consume("/* literal */");`, `return consume("/* changed literal */");`, true},
		{"template", "consume(`https://example.test`);", "return consume(`https://example.test`).length;", true},
		{"template substitution", "consume(`https://${/* keep */ host}/path`);", "return consume(`https://${/* keep */ host}/path`).length;", true},
		{"template comment dropped", "consume(`https://${/* keep */ host}/path`);", "return consume(`https://${host}/path`);", false},
		{"regexp", `consume(/https:\/\//);`, `return consume(/https:\/\//);`, true},
		{"line comment retained", "consume('https://example.test'); // keep\n", "return consume('https://example.test'); // keep\n", true},
		{"line comment dropped", "consume('https://example.test'); // keep\n", "return consume('https://example.test');\n", false},
		{"block comment retained", `consume('https://example.test' /* keep */);`, `return consume('https://example.test' /* keep */);`, true},
		{"block comment changed", `consume('https://example.test' /* keep */);`, `return consume('https://example.test' /* changed */);`, false},
		{"duplicate comment dropped", `consume('https://example.test' /* keep */ /* keep */);`, `return consume('https://example.test' /* keep */);`, false},
		{"incomplete string", `consume("https://example.test`, `return consume("https://changed.test`, false},
		{"incomplete expression", `consume("https://example.test", x`, `return consume("https://example.test", y`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := editsPreserveComments(test.before, []sourceEdit{{0, len(test.before), test.after}})
			if got != test.want {
				t.Fatalf("comment guard = %v, want %v\nbefore: %s\nafter: %s", got, test.want, test.before, test.after)
			}
		})
	}
}
