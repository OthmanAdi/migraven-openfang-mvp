import { UpdateTodosIn, UpdateTodosOut } from "../schema.js";

export async function updateTodos(rawInput: unknown): Promise<unknown> {
  const input = UpdateTodosIn.parse(rawInput);
  return UpdateTodosOut.parse({ ok: true, todos: input.todos });
}
