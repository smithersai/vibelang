package vibelang

import "testing"

func TestSchemaFlagFreshNameUnicode(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"const $cod\\u0065cs0 = 1", "$codecs0_2"},
		{"const \\u0024codecs0 = 1", "$codecs0_2"},
		{"const $cod\\u{65}cs0 = 1", "$codecs0_2"},
		{"const $cod\\u{000065}cs0 = 1", "$codecs0_2"},
		{"const $cod\\u0065cs0 = 1; const $codecs0_\\u0032 = 2", "$codecs0_3"},
		{"const x=`before ${1} after`; const $cod\\u0065cs0 = 1", "$codecs0_2"},
	} {
		if got := freshSchemaFlagName(tc.source, "$codecs0"); got != tc.want {
			t.Errorf("fresh name=%q, want%q in %s", got, tc.want, tc.source)
		}
	}
}
