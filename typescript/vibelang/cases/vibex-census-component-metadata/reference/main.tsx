// VIP-39 A component s throws comes from its own body: docs/design/vips/0039-vibex.md#6665583467d4c353
// VIP-39 SaveButton s declaration carries throws never VIP-27 the element: docs/design/vips/0039-vibex.md#b1521edd1214e74b
import { Component } from "./component.js"
declare global { namespace JSX {
 type Element = {tag:string}
 interface IntrinsicElements { button: {} }
}}
declare function h(...args:any[]):JSX.Element
/** @throws {never} */
export function SaveButton() { return <button/> }
/** @throws {never} */
export function Wrapped() { return <Component/> }
