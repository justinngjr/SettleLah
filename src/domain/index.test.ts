import { describe, expect, it } from "vitest";

import { DOMAIN_VERSION } from "./index";

describe("domain", () => {
  it("exposes a version string", () => {
    expect(DOMAIN_VERSION).toBe("0.0.0");
  });
});
