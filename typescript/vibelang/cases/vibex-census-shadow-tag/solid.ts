/** @throws {never} */
export function Match(): JSX.Element { return {tag:"match"} }
/** @throws {never} */
export function h(component:()=>JSX.Element): JSX.Element { return component() }
