import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// jsdom doesn't implement window.confirm — tests can override per-case
if (typeof window !== 'undefined' && !window.confirm) {
  Object.defineProperty(window, 'confirm', { value: () => true, writable: true })
}
