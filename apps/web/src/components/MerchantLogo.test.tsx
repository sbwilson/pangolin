// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MerchantLogo } from "./MerchantLogo.tsx";

afterEach(() => {
  cleanup();
});

describe("MerchantLogo", () => {
  it("shows the same-host logo image when the payee has one", () => {
    render(
      <MerchantLogo payeeId="payee 1" logoAttachmentId="att1" name="Woolworths" description="x" />,
    );
    const img = screen.getByTestId("merchant-logo-img");
    expect(img.getAttribute("src")).toBe("/api/payees/payee%201/logo");
    expect(img.getAttribute("alt")).toBe("");
  });

  it("falls back to the payee initial when the image fails to load", () => {
    render(<MerchantLogo payeeId="p1" logoAttachmentId="att1" name="woolworths" />);
    fireEvent.error(screen.getByTestId("merchant-logo-img"));
    expect(screen.queryByTestId("merchant-logo-img")).toBeNull();
    expect(screen.getByTestId("merchant-logo-initial").textContent).toBe("W");
  });

  it("shows the payee initial with no logo, and the description when there is no name", () => {
    const { rerender } = render(<MerchantLogo payeeId="p1" logoAttachmentId={null} name="Cafe" />);
    expect(screen.getByTestId("merchant-logo-initial").textContent).toBe("C");
    rerender(
      <MerchantLogo payeeId={null} logoAttachmentId={null} name={null} description="coff" />,
    );
    expect(screen.getByTestId("merchant-logo-initial").textContent).toBe("C");
  });

  it("renders nothing but an empty box without any label", () => {
    render(<MerchantLogo payeeId={null} logoAttachmentId={null} name={null} />);
    expect(screen.getByTestId("merchant-logo-initial").textContent).toBe("");
  });
});
