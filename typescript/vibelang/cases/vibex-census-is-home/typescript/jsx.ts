export type VNode = { tag: string; props: Record<string, unknown> | null; children: unknown[] }
/** @throws {never} */
export function h(tag: string | ((props: any) => VNode), props: Record<string, unknown> | null, ...children: unknown[]): VNode {
 return typeof tag === "function" ? tag(props) : { tag, props, children }
}
