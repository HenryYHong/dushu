// vi.waitFor gives up after 1 s by default. Shared CI machines are several times slower than a laptop, so popup and
// reader tests that wait on real async work get 5 s unless a test asks for something else.
import { vi } from 'vitest';

const waitFor = vi.waitFor;
vi.waitFor = ((callback, options) =>
  waitFor(callback, typeof options === 'number' ? options : { timeout: 5000, ...options })) as typeof vi.waitFor;
