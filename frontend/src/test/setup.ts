import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// React Testing Library auto-cleanup relies on Vitest globals, which are
// disabled here, so unmount explicitly between tests.
afterEach(() => {
  cleanup();
});
