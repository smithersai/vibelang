package vibelang

import (
	"strings"
	"testing"
)

func TestForHeadConstDestructuringFix(t *testing.T) {
	for _, source := range []string{
		"export function f(){for(const {n}={n:1};(1 is let cell);){n=2;return n}}\n",
		"export function f(){for(const [n]=[1];true;(1 is let cell)){n++;return n}}\n",
		"export function f(){for(const {a:{n}}={a:{n:1}},ready=(1 is let cell);ready;){n+=2;return n}}\n",
		"export function f(){for(/* keep */ const {...rest}={n:1};(1 is let cell);){rest={n:2};return rest}}\n",
		"export function f(){for(const {n}={n:1},[m]=[2];(1 is let cell);){n=2;m=3;n=4;return n+m}}\n",
		"export function f(){const out:(()=>number)[]=[];for(const {n}={n:0};n<3&&(1 is let cell);n++){out.push(()=>n)}return out.map(f=>f())}\n",
	} {
		result, name := fixSourceOptions(t, source, FixOptions{})
		fixed := result.Files[name]
		wanted := strings.Replace(source, "const {", "let {", 1)
		if strings.Contains(source, "const [") {
			wanted = strings.Replace(source, "const [", "let [", 1)
		}
		if result.Err != nil || fixed == nil || fixed.Text != wanted {
			t.Fatalf("const repair: err=%v refused=%+v fixed=%+v want=%s", result.Err, result.Refused, fixed, wanted)
		}
		if ds := errorsOf(t, fixed.Text); len(ds) != 0 {
			t.Fatalf("repaired source: %v\\n%s", ds, fixed.Text)
		}
		again, _ := fixSourceOptions(t, fixed.Text, FixOptions{})
		if again.Err != nil || len(again.Files) != 0 {
			t.Fatalf("repair is not idempotent: %+v", again)
		}
	}
}

func TestForHeadConstDestructuringFixBoundaries(t *testing.T) {
	for _, source := range []string{
		"export function f(){const {n}={n:1};n=2;return n}\n",
		"export function f(){for(const n=1;(1 is let cell);){n=2;return n}}\n",
		"export function f(){if(1 is const n){n=2;return n}}\n",
	} {
		result, _ := fixSourceOptions(t, source, FixOptions{})
		for _, fixed := range result.Files {
			if fixed.Text != source {
				t.Fatalf("unrelated const changed: %s", fixed.Text)
			}
		}
	}
}
