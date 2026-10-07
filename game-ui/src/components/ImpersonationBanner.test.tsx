import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ImpersonationBanner } from "./ImpersonationBanner";

describe("ImpersonationBanner", () => {
  it("names the player being viewed and says it is read-only", () => {
    render(<ImpersonationBanner email="ada@example.test" onExit={() => {}} />);

    expect(screen.getByText("ada@example.test")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/read-only/i);
  });

  it("calls onExit when Exit is clicked", () => {
    const onExit = vi.fn();
    render(<ImpersonationBanner email="ada@example.test" onExit={onExit} />);

    fireEvent.click(screen.getByRole("button", { name: "Exit" }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
