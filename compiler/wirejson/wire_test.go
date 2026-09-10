package wirejson

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestLosslessUnicodeJSON(t *testing.T) {
	for _, vector := range []struct {
		name, raw string
		valid     bool
	}{
		{"ordinary", `{"text":"hello"}`, true},
		{"astral", `{"text":"🐱"}`, true},
		{"combining", `{"text":"é"}`, true},
		{"literal replacement", `{"text":"�"}`, true},
		{"BMP escapes", `{"text":"\u0041\uFFFF\ufffd"}`, true},
		{"lowercase pair", `{"text":"\ud83d\udc31"}`, true},
		{"uppercase pair", `{"text":"\uDBFF\uDFFF"}`, true},
		{"first pair", `{"text":"\ud800\udc00"}`, true},
		{"multiple pairs", `"\ud800\udc00\udbff\udfff"`, true},
		{"source escape", `{"text":"export const x = '\\ud800';"}`, true},
		{"escaped slash and quotes", `{"text":"\\\"\\ud800"}`, true},
		{"paired key", `{"\ud83d\udc31":1}`, true},
		{"lone high", `{"text":"\ud800"}`, false},
		{"lone last high", `"\udbff"`, false},
		{"lone low", `{"text":"\udc00"}`, false},
		{"lone last low", `"\uDFFF"`, false},
		{"reversed pair", `"\udc00\ud800"`, false},
		{"two highs", `"\ud800\ud800"`, false},
		{"high then BMP", `"\ud800\u0061"`, false},
		{"interrupted pair", `"\ud800x\udc00"`, false},
		{"high then escaped source text", `"\ud800\\udc00"`, false},
		{"pair then low", `"\ud800\udc00\udc00"`, false},
		{"unpaired key", `{"\ud800":1}`, false},
		{"literal invalid UTF8", "{\"text\":\"\xff\"}", false},
		{"WTF8", "\"\xed\xa0\x80\"", false},
		{"malformed escape", `"\ud80g"`, false},
		{"incomplete", `{"text":`, false},
		{"multiple values", `{} {}`, false},
	} {
		t.Run(vector.name, func(t *testing.T) {
			err := Validate([]byte(vector.raw))
			if (err == nil) != vector.valid {
				t.Fatalf("valid=%v, error=%v", vector.valid, err)
			}
		})
	}
}

func TestDecodePreservesOrRejectsBeforeRepair(t *testing.T) {
	type input struct {
		Text string `json:"text"`
	}
	for _, vector := range []struct{ raw, want string }{
		{`{"text":"\ud83d\udc31"}`, "🐱"},
		{`{"text":"\\ud800"}`, `\ud800`},
		{`{"text":"�"}`, "�"},
	} {
		t.Run(vector.raw, func(t *testing.T) {
			var value input
			if err := Decode(strings.NewReader(vector.raw), &value); err != nil || value.Text != vector.want {
				t.Fatalf("value=%q err=%v", value.Text, err)
			}
		})
	}
	for _, raw := range []string{`{"text":"\ud800"}`, "{\"text\":\"\xff\"}", `{"unknown":1}`, `{} {}`, `{} trailing`, ""} {
		t.Run("reject "+raw, func(t *testing.T) {
			var value input
			if err := Decode(strings.NewReader(raw), &value); err == nil {
				t.Fatalf("accepted lossy or invalid input: %q", raw)
			}
		})
	}
}

func TestUniqueIdentityJSON(t *testing.T) {
	for _, raw := range []string{`null`, `42`, `1e400`, `{"a":1,"b":[{"a":2},{"a":3}]}`, `{"😀":1,"�":2}`, `"\\ud800"`} {
		if err := ValidateUnique([]byte(raw)); err != nil {
			t.Fatalf("refused %q: %v", raw, err)
		}
	}
	for _, raw := range []string{
		`{"a":1,"a":2}`, `{"a":1,"\u0061":2}`, `{"x":[{"a":1,"a":2}]}`,
		`{"😀":1,"\ud83d\ude00":2}`, `{"__proto__":1,"__proto__":2}`,
		`"\ud800"`, `{} {}`, `{"a":`,
		strings.Repeat("[", 258) + "0" + strings.Repeat("]", 258),
		"[" + strings.Repeat("0,", 100_000) + "0]",
	} {
		if err := ValidateUnique([]byte(raw)); err == nil {
			t.Fatalf("accepted %q", raw[:min(100, len(raw))])
		}
	}
	// Source JSON and the existing generic transport do not acquire this policy.
	if err := Validate([]byte(`{"a":1,"a":2}`)); err != nil {
		t.Fatal(err)
	}
}

type namedText string

func TestMarshalCannotRepairGoStrings(t *testing.T) {
	for name, value := range map[string]any{
		"string":             "\xff",
		"named string":       namedText("\xed\xa0\x80"),
		"map value":          map[string]any{"text": "\xff"},
		"map key":            map[string]int{"\xff": 1},
		"slice":              []string{"valid", "\xff"},
		"array":              [1]string{"\xff"},
		"pointer and struct": &struct{ Text string }{"\xff"},
		"nested options":     map[string]any{"option": []any{map[string]any{"key": "\xff"}}},
		"raw JSON":           json.RawMessage(`{"text":"\ud800"}`),
	} {
		t.Run(name, func(t *testing.T) {
			if raw, err := Marshal(value); err == nil {
				t.Fatalf("silently repaired to %s", raw)
			}
		})
	}
	t.Run("valid data, ignored fields and binary bytes", func(t *testing.T) {
		value := struct {
			Text    string `json:"text"`
			Ignored string `json:"-"`
			Bytes   []byte `json:"bytes"`
			private string
		}{Text: "🐱�\\ud800", Ignored: "\xff", Bytes: []byte{0xff, 0xed}, private: "\xff"}
		raw, err := Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var decoded struct {
			Text  string
			Bytes []byte
		}
		if err := Decode(bytes.NewReader(raw), &decoded); err != nil {
			t.Fatal(err)
		}
		if decoded.Text != value.Text || !bytes.Equal(decoded.Bytes, value.Bytes) {
			t.Fatal("changed valid data")
		}
	})
	t.Run("cycles are bounded", func(t *testing.T) {
		cycle := map[string]any{}
		cycle["self"] = cycle
		if _, err := Marshal(cycle); err == nil {
			t.Fatal("accepted cycle")
		}
	})
	t.Run("encoder writes nothing on failure", func(t *testing.T) {
		var output bytes.Buffer
		if err := Encode(&output, "\xff"); err == nil || output.Len() != 0 {
			t.Fatal("wrote repaired data")
		}
		if err := Encode(&output, "🐱"); err != nil || !strings.HasSuffix(output.String(), "\n") {
			t.Fatal("missing encoded result")
		}
	})
	t.Run("short writes fail", func(t *testing.T) {
		if err := Encode(shortWriter{}, 1); err != io.ErrShortWrite {
			t.Fatal(err)
		}
	})
}

type shortWriter struct{}

func (shortWriter) Write(bytes []byte) (int, error) { return len(bytes) - 1, nil }
