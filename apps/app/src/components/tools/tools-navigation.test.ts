import { describe, expect, it } from "vitest";
import { resolveToolsActivePage } from "./tools-navigation";

describe("resolveToolsActivePage", () => {
  it.each([
    ["/plugins", "", "plugins-browse"],
    ["/plugins", "?view=installed", "plugins-installed"],
    ["/plugins/github", "", "plugins-browse"],
    ["/plugins/github", "?view=installed", "plugins-installed"],
    ["/skills", "", "skills-library"],
    ["/skills", "?view=library", "skills-library"],
    ["/skills/library/my-skill", "", "skills-library"],
  ])("marks %s%s as %s", (pathname, search, expected) => {
    expect(resolveToolsActivePage(pathname, search)).toBe(expected);
  });
});
