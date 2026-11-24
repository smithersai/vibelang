package vibelangestree

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

// obj is one ESTree node or plain object, with its keys in insertion order
// so the JSON reads like typescript-estree's. A value is nil (null), bool,
// string, int, float64, *obj, []any, or span, a position pair the writer
// converts to UTF-16.
type obj struct {
	keys []string
	vals []any
}

// span is a [start, end) range in UTF-8 byte offsets of the source text.
type span struct{ start, end int }

func (o *obj) set(key string, value any) *obj {
	for i, k := range o.keys {
		if k == key {
			o.vals[i] = value
			return o
		}
	}
	o.keys = append(o.keys, key)
	o.vals = append(o.vals, value)
	return o
}

func (o *obj) get(key string) any {
	for i, k := range o.keys {
		if k == key {
			return o.vals[i]
		}
	}
	return nil
}

// typ returns the node's ESTree type, or "" for a plain object.
func (o *obj) typ() string {
	if o == nil {
		return ""
	}
	t, _ := o.get("type").(string)
	return t
}

// rng returns the node's range.
func (o *obj) rng() span {
	r, _ := o.get("range").(span)
	return r
}

func (o *obj) setRange(r span) { o.set("range", r) }

func (o *obj) isSynthesized() bool {
	if o == nil {
		return false
	}
	b, _ := o.get("synthesized").(bool)
	return b
}

// positions converts byte offsets of text to UTF-16 offsets, which is what
// JavaScript strings, and so ESLint, count.
type positions struct {
	ascii  bool
	offset []int
}

func newPositions(text string) positions {
	ascii := true
	for i := 0; i < len(text); i++ {
		if text[i] >= utf8.RuneSelf {
			ascii = false
			break
		}
	}
	if ascii {
		return positions{ascii: true}
	}
	offset := make([]int, len(text)+1)
	u := 0
	for i := 0; i < len(text); {
		r, size := utf8.DecodeRuneInString(text[i:])
		for j := 0; j < size; j++ {
			offset[i+j] = u
		}
		if r >= 0x10000 {
			u += 2
		} else {
			u++
		}
		i += size
	}
	offset[len(text)] = u
	return positions{offset: offset}
}

func (p positions) utf16(pos int) int {
	if p.ascii || pos < 0 {
		return pos
	}
	if pos >= len(p.offset) {
		return p.offset[len(p.offset)-1]
	}
	return p.offset[pos]
}

// write appends value as JSON to b.
func write(b *strings.Builder, value any, p positions) {
	switch v := value.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if v {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		writeString(b, v)
	case int:
		b.WriteString(strconv.Itoa(v))
	case float64:
		b.WriteString(strconv.FormatFloat(v, 'g', -1, 64))
	case span:
		b.WriteByte('[')
		b.WriteString(strconv.Itoa(p.utf16(v.start)))
		b.WriteByte(',')
		b.WriteString(strconv.Itoa(p.utf16(v.end)))
		b.WriteByte(']')
	case *obj:
		if v == nil {
			b.WriteString("null")
			return
		}
		b.WriteByte('{')
		for i, k := range v.keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeString(b, k)
			b.WriteByte(':')
			write(b, v.vals[i], p)
		}
		b.WriteByte('}')
	case []any:
		b.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				b.WriteByte(',')
			}
			write(b, item, p)
		}
		b.WriteByte(']')
	case []*obj:
		b.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				b.WriteByte(',')
			}
			write(b, item, p)
		}
		b.WriteByte(']')
	default:
		panic("vibelangestree: cannot write a value of this type")
	}
}

// writeString writes s as a JSON string. Invalid UTF-8, which a lone
// surrogate escape in a string literal decodes to, is written as U+FFFD.
func writeString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			switch c {
			case '"':
				b.WriteString(`\"`)
			case '\\':
				b.WriteString(`\\`)
			case '\n':
				b.WriteString(`\n`)
			case '\r':
				b.WriteString(`\r`)
			case '\t':
				b.WriteString(`\t`)
			default:
				if c < 0x20 {
					b.WriteString(`\u00`)
					b.WriteByte("0123456789abcdef"[c>>4])
					b.WriteByte("0123456789abcdef"[c&0xf])
				} else {
					b.WriteByte(c)
				}
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 && c == 0xed && i+2 < len(s) && s[i+1] >= 0xa0 && s[i+1] <= 0xbf && s[i+2] >= 0x80 && s[i+2] <= 0xbf {
			// A lone surrogate, which the scanner decodes as WTF-8: JSON carries it as an escape.
			code := rune(c&0x0f)<<12 | rune(s[i+1]&0x3f)<<6 | rune(s[i+2]&0x3f)
			b.WriteString(`\u`)
			for shift := 12; shift >= 0; shift -= 4 {
				b.WriteByte("0123456789abcdef"[(code>>shift)&0xf])
			}
			i += 3
			continue
		} else if r == utf8.RuneError && size == 1 {
			b.WriteString(`�`)
		} else if r == '\u2028' || r == '\u2029' {
			b.WriteString(`\u202`)
			b.WriteByte("0123456789abcdef"[r&0xf])
		} else {
			b.WriteString(s[i : i+size])
		}
		i += size
	}
	b.WriteByte('"')
}
