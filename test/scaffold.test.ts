import { describe, expect, it } from 'vitest'

describe('scaffold', () => {
  it('runs TypeScript under vitest with strict types', () => {
    const n: number = 41
    expect(n + 1).toBe(42)
  })

  it('targets Node 22 or newer', () => {
    const major = Number(process.versions.node.split('.')[0])
    expect(major).toBeGreaterThanOrEqual(22)
  })
})
