package vibelangfuzz

var effectMarkerTrivia = []struct{ key, text string }{
	{"block-keyword", "/* function */ "},
	{"line-keyword", "// function\n"},
	{"multiline-keyword", "/*\nfunction\n*/ "},
	{"block-substring", "/* functionally */ "},
	{"identifier-suffix", "/* malfunction */ "},
	{"two-comments", "/* first */ /* function */ "},
	{"unicode-keyword", "/* 🦊 function café */ "},
}
