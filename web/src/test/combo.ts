import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Pick an option from a SearchableSelect: open it, type to filter, click the match. */
export async function pickOption(user: UserEvent, input: HTMLElement, name: string | RegExp, query = typeof name === "string" ? name : "") {
  await user.click(input);
  if (query) await user.type(input, query);
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name }));
}
