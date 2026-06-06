"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const react_1 = require("@testing-library/react");
require("@testing-library/jest-dom/vitest");
const vitest_1 = require("vitest");
if (!globalThis.crypto) {
    vitest_1.vi.stubGlobal("crypto", node_crypto_1.webcrypto);
}
(0, vitest_1.afterEach)(() => {
    (0, react_1.cleanup)();
    vitest_1.vi.clearAllMocks();
});
