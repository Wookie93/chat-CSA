import { afterEach, vi } from 'vitest';
vi.mock('server-only', () => ({}));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
