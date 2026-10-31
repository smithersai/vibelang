package vibelangfmt

import "testing"

func TestFoldkitNativeOptionLowering(t *testing.T) {
	source := "export function read(input: Option<number>): number {if (true) {if (input is Option.Some(let value)) return (match (input) { when Option.None: 0; when Option.Some(let value): value; }); else return 0;} else {return 0;}}"
	enc, err := encode("read.vibe", source)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("projection: %s\nholders: %+v", enc.text, enc.placeholders)
	host := dprintFormatter(t)
	formatted, err := host(enc.text)
	if err != nil {
		t.Fatal(err)
	}
	after, err := enc.decode(formatted)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("host: %s\nafter: %s", formatted, after)
	if err := SameProgram(source, after); err != nil {
		t.Fatal(err)
	}
}
