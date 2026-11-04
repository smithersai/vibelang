export type VNode = { tag: string; children: unknown[] }
declare global {
  namespace JSX {
    type Element = VNode
    interface IntrinsicElements { span: { children?: unknown } }
  }
}
/** @throws {never} */
export function h(tag: string | ((props: any) => VNode), props: any, ...children: unknown[]): VNode {
  return typeof tag === "function" ? tag(props) : { tag, children }
}
