import { Atom, useAtomSet, useAtomValue, emptyTodo, type Todo } from "./ui.js"
type Filter = "All" | "Active" | "Done"
export const filterAtom = Atom.make<Filter>("All")
export const todosAtom = Atom.make<readonly Todo[]>([])
export const AddTodoButton = () => {
  const setTodos = useAtomSet(todosAtom)
  return <button onClick={() => setTodos(todos => [...todos, emptyTodo()])}>Add</button>
}
export const ClearDoneButton = () => {
  const setTodos = useAtomSet(todosAtom)
  return <button onClick={() => setTodos(todos => todos.filter(todo => !todo.done))}>Clear done</button>
}
export const FilterTabs = () => {
  const filter = useAtomValue(filterAtom)
  const setFilter = useAtomSet(filterAtom)
}
