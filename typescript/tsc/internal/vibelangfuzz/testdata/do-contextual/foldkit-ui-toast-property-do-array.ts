import { Option } from 'effect'
type Link = Readonly<{ href: string; text: string }>
export const render = (maybeLink: Option.Option<Link>): Readonly<{ content: ReadonlyArray<string> }> => ({content: Option.match(maybeLink, { onNone: () => [], onSome: ({href, text}) => [href, text] })})
