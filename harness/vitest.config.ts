import { defineConfig } from "vitest/config";

// Several agents and the model server share the development Mac, so a test that spawns a process or opens a socket
// can take far longer than on an idle machine. Vitest's defaults (5 s per test, 10 s per hook) made those tests fail
// under load without anything being wrong. A real hang still fails, just later.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
