package vibelang

import "testing"

func TestMutableErrorCompatibilityMatcherIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		reject       bool
	}{
		{"runtime factory", "import {TaggedError as make} from 'vibelang-runtime'; class E extends make('E')<{value:number}> {} ", false},
		{"native factory", "import {Data} from 'effect'; class E extends Data.TaggedError('E')<{value:number}> {} ", true},
		{"ordinary subclass", "import {TaggedError as make} from 'vibelang-runtime'; class Base extends make('E')<{value:number}> {} class E extends Base {} ", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ds := errorsOf(t, tc.source+"export function probe(x:unknown){return match(x){when E(let value):value;default:undefined;}}")
			found := false
			for _, d := range ds {
				if d.Code() == EK0704.Code {
					found = true
				} else {
					t.Fatalf("unexpected diagnostic: %s", d.String())
				}
			}
			if found != tc.reject {
				t.Fatalf("ordinary extractor rejection=%v want=%v", found, tc.reject)
			}
		})
	}
}
