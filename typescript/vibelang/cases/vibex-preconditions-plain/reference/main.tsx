import { h } from "./ui.js"
export function Component(props: { label: string }) {
  return <span>{props.label}</span>
}
export const rendered = <Component label="plain" />
