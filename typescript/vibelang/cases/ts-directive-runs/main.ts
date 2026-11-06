// @vibe
// expect-result: "hello nobody"
// VIP-42: a .ts source whose first line is the directive is VibeLang, with no option, and runs as a .vibe file does.
error Empty

effect function greet(name: string) {
  if (name === "") throw new Empty()
  return `hello ${name}`
}

export effect function main() {
  const who = greet("") catch () => "nobody"
  return try greet(who)
}
