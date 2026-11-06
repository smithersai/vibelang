// @vibe
declare global {
  namespace JSX {
    interface IntrinsicElements { p: { children?: unknown } }
  }
}
const h = (tag: string, _props: unknown, ...children: unknown[]): string => `${tag}:${children.join("")}`
const Fragment = "fragment"

export effect function main() {
  const n = 2
  return <p>{n}</p>
}
