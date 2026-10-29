import type { ReactNode } from 'react'

/**
 * The subset of a React root that the bootstrap needs. Declared in its own
 * module so the failure-path renderer can be split out of the bootstrap module
 * without importing the bootstrap module back, which would be a cycle.
 */
export interface RenderRoot {
  render(children: ReactNode): void
}
