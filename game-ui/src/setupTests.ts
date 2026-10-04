import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import { createElement } from 'react'

// @iconify/react's real Icon component polls a remote API for icon data and schedules retry
// timers that can fire after a test file's jsdom environment is torn down, causing
// "ReferenceError: window is not defined" as an unhandled error that fails the whole run even
// though every test passed. No test depends on its actual rendered markup (per-file EventLog
// test even has its own note that iconify resolves no icon in jsdom anyway) - stub it with a
// static, timer-free placeholder instead.
vi.mock('@iconify/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@iconify/react')>()),
  Icon: ({ icon }: { icon?: string }) => createElement('span', { 'data-icon': icon }),
}))

// lottie-web calls canvas.getContext('2d') at import time, which is null in jsdom, so merely
// importing it (e.g. via EmotionEmoji from any component's import chain) fails the whole suite.
vi.mock('lottie-web', () => ({
  default: { loadAnimation: () => ({ destroy: () => {} }) },
}))
