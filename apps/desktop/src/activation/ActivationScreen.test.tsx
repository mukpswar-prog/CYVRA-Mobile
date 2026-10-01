import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ActivationScreen } from "./ActivationScreen";

type Props = ComponentProps<typeof ActivationScreen>;

/** The six verdicts, exactly as `FailureKind::as_str()` holds them. */
const SIX = [
  "invalid user",
  "invalid licence",
  "licence not active",
  "licence expired",
  "already bound to another computer",
  "network error",
] as const;

function mount(overrides: Partial<Props> = {}) {
  const onSubmit = vi.fn();
  render(
    <ActivationScreen
      message={null}
      termsVersion="V1.0-DRAFT"
      busy={false}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit };
}

function activate() {
  return screen.getByRole("button", { name: "ACTIVATE" });
}

function type(email: string, licenceKey: string) {
  fireEvent.change(screen.getByLabelText("Registered User ID (email)"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Licence Key"), { target: { value: licenceKey } });
}

function tickTerms() {
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("ActivationScreen", () => {
  describe("the front door", () => {
    it("presents the brand before it asks for anything", () => {
      mount();

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CYVRA MOBILE");
      expect(screen.getByText("Mobile Device Evidence Platform")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        "Sign in & Activate",
      );
      expect(screen.getByLabelText("Registered User ID (email)")).toBeInTheDocument();
      expect(screen.getByLabelText("Licence Key")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Need help? Contact CYVORIQ Support" }),
      ).toBeInTheDocument();
    });
  });

  describe("terms gating", () => {
    it("starts with the terms unchecked, every single time", () => {
      mount();
      expect(screen.getByRole("checkbox")).not.toBeChecked();
    });

    it("stays unchecked when there is already a verdict on screen", () => {
      // A refusal must not be able to bootstrap acceptance: the operator still
      // has to tick the box themselves before ACTIVATE becomes available.
      mount({ message: "licence expired" });
      expect(screen.getByRole("checkbox")).not.toBeChecked();
      expect(activate()).toBeDisabled();
    });

    it("does not let a submission through with the box still unticked", () => {
      const { onSubmit } = mount();
      type("operator@example.com", "CYVRA-0000-0000");

      expect(activate()).toBeDisabled();

      fireEvent.click(activate());
      fireEvent.submit(activate().closest("form")!);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("accepts the box only when the operator clicks it", () => {
      mount();
      const box = screen.getByRole("checkbox");

      fireEvent.click(box);
      expect(box).toBeChecked();

      fireEvent.click(box);
      expect(box).not.toBeChecked();
    });
  });

  describe("ACTIVATE availability", () => {
    it("is disabled while the form is empty", () => {
      mount();
      expect(activate()).toBeDisabled();
    });

    it("is disabled on whitespace that is not actually an entry", () => {
      mount();
      type("   ", "\t");
      expect(activate()).toBeDisabled();
    });

    it("is disabled with credentials but no accepted terms", () => {
      mount();
      type("operator@example.com", "CYVRA-0000-0000");
      expect(activate()).toBeDisabled();
    });

    it("is disabled with accepted terms but no credentials", () => {
      mount();
      tickTerms();
      expect(activate()).toBeDisabled();
    });

    it("is enabled only when every condition holds", () => {
      mount();
      type("operator@example.com", "CYVRA-0000-0000");
      expect(activate()).toBeDisabled();

      tickTerms();
      expect(activate()).toBeEnabled();
    });

    it("is disabled while a submission is in flight", () => {
      mount({ busy: true });
      expect(activate()).toBeDisabled();
      expect(screen.getByLabelText("Registered User ID (email)")).toBeDisabled();
      expect(screen.getByLabelText("Licence Key")).toBeDisabled();
      expect(screen.getByRole("checkbox")).toBeDisabled();
    });
  });

  describe("what is sent", () => {
    it("submits the trimmed credentials and nothing else", () => {
      const { onSubmit } = mount();
      type("  operator@example.com  ", "  CYVRA-0000-0000  ");
      tickTerms();

      fireEvent.click(activate());

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        email: "operator@example.com",
        licenceKey: "CYVRA-0000-0000",
      });
    });

    it("never sends a terms version of its own", () => {
      // The binary owns the terms version; the screen must not be able to
      // submit one, or a modified build could claim any document was accepted.
      const { onSubmit } = mount({ termsVersion: "SOMETHING-ELSE" });
      type("operator@example.com", "CYVRA-0000-0000");
      tickTerms();

      fireEvent.click(activate());

      expect(Object.keys(onSubmit.mock.calls[0][0])).toEqual(["email", "licenceKey"]);
    });
  });

  describe("the verdict banner", () => {
    for (const verdict of SIX) {
      it(`renders "${verdict}" verbatim with nothing added`, () => {
        mount({ message: verdict });

        const banner = screen.getByRole("alert");
        expect(banner.textContent).toBe(verdict);
      });
    }

    it("shows no banner when there is nothing to report", () => {
      mount({ message: null });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows no banner for an empty message rather than an empty box", () => {
      mount({ message: "" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("the bundled terms", () => {
    it("reveals the bundled document and names the version on offer", () => {
      mount({ termsVersion: "V1.0-DRAFT" });
      expect(screen.queryByRole("region")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "View Software Licence Terms" }));

      const sheet = screen.getByRole("region", { name: "Software Licence Terms" });
      expect(sheet).toHaveTextContent("Version: V1.0-DRAFT");
      // Not a stub: the actual document, down to its governing-law clause.
      expect(sheet.textContent).toContain("Governing Law");
      expect(sheet.textContent).toContain("Entire Agreement");
    });

    it("closes again when asked", () => {
      mount();
      const toggle = screen.getByRole("button", { name: "View Software Licence Terms" });

      fireEvent.click(toggle);
      expect(screen.getByRole("region")).toBeInTheDocument();

      fireEvent.click(toggle);
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
    });
  });

  describe("the help affordance", () => {
    it("keeps support detail behind the link", () => {
      mount();
      expect(screen.queryByText(/cyvoriq\.co\.in/i)).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Need help? Contact CYVORIQ Support" }),
      );

      expect(screen.getByText(/cyvoriq\.co\.in/i)).toBeInTheDocument();
    });
  });
});
