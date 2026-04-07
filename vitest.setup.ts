import { webcrypto } from "node:crypto";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

if (!globalThis.crypto) {
  vi.stubGlobal("crypto", webcrypto);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
