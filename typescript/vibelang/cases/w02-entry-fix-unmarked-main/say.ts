// A TypeScript helper that writes to stdout, so the test can see whether main ran.
export function say(text: string): void {
  console.log(text)
}
