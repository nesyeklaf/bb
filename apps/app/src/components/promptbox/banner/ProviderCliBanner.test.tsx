import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderCliBanner } from "./ProviderCliBanner";

function renderBanner(props: ComponentProps<typeof ProviderCliBanner>) {
  const markup = renderToStaticMarkup(<ProviderCliBanner {...props} />);
  return {
    markup,
    text: markup.replace(/<[^>]+>/g, ""),
  };
}

describe("ProviderCliBanner", () => {
  it("uses the selected provider's identity and update requirement", () => {
    const { markup, text } = renderBanner({
      displayName: "Example Agent",
      installed: true,
      currentVersion: "0.135.0",
      minimumSupportedVersion: "0.136.0",
    });

    expect(markup).toContain('aria-label="Example Agent update required"');
    expect(text).toContain(
      "Update Example Agent before starting a thread. Installed 0.135.0; version 0.136.0 or newer is required.",
    );
    expect(markup).not.toContain("<button");
  });

  it("does not repeat an ambiguous version fallback", () => {
    const { text } = renderBanner({
      displayName: "Codex",
      installed: true,
      currentVersion: "0.135.0",
      minimumSupportedVersion: null,
    });

    expect(text).toContain("Installed 0.135.0; a newer version is required.");
  });

  it("asks for an install instead of a version when the CLI is missing", () => {
    const { markup, text } = renderBanner({
      displayName: "Claude Code",
      installed: false,
      currentVersion: null,
      minimumSupportedVersion: "2.1.0",
    });

    expect(markup).toContain('aria-label="Claude Code not installed"');
    expect(text).toContain("Install Claude Code before starting a thread.");
    expect(text).not.toContain("2.1.0");
  });
});
