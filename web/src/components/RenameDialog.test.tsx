/** The rename dialog (Phase 5c amendment 3): focus, counter, Enter and Esc. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenameDialog } from "./RenameDialog";

afterEach(cleanup);

function open(name: string | null = "Coast run", onSave = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<RenameDialog name={name} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose, input: screen.getByLabelText("Route name") as HTMLInputElement };
}

const submit = (input: HTMLInputElement) => act(async () => void fireEvent.submit(input.form!));

describe("RenameDialog", () => {
  it("opens on the field, labelled, with the name in it", () => {
    const { input } = open();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Coast run");
  });

  it("keeps the focus inside, both ways round", () => {
    const { input } = open();
    const save = screen.getByRole("button", { name: "Save", hidden: true });
    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it("counts trimmed characters, an emoji as one, and will not save 81", async () => {
    const { input, onSave } = open("");
    const count = () => screen.getByTestId("rename-count").textContent;
    expect(count()).toBe("0/80");
    fireEvent.change(input, { target: { value: "  Coast \u{1F45F}  " } });
    expect(count()).toBe("7/80");
    fireEvent.change(input, { target: { value: "x".repeat(81) } });
    expect(count()).toBe("81/80");
    expect((screen.getByTestId("rename-save") as HTMLButtonElement).disabled).toBe(true);
    await submit(input);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Enter submits: the field and Save share one form, and the name is trimmed", async () => {
    const { input, onSave, onClose } = open();
    const save = screen.getByTestId("rename-save") as HTMLButtonElement;
    expect([save.type, save.form]).toEqual(["submit", input.form]);     // so Enter in the field submits
    fireEvent.change(input, { target: { value: "  Morning coast " } });
    await submit(input);
    expect(onSave).toHaveBeenCalledWith("Morning coast");
    expect(onClose).toHaveBeenCalled();
  });

  it("an empty name is no name", async () => {
    const { input, onSave } = open();
    fireEvent.change(input, { target: { value: "   " } });
    await submit(input);
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("Esc cancels", () => {
    const { input, onSave, onClose } = open();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a failure says so and stays open", async () => {
    const { input, onClose } = open("A", vi.fn().mockRejectedValue(new Error("offline")));
    await submit(input);
    expect(screen.getByText("Could not rename. Try again.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
