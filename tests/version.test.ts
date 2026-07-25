import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/version.js'

describe('VERSION', () => {
  // The constant is not derived from package.json (it is bundled into dist and
  // into every SARIF report as tool.driver.version), so a release bump that
  // touches only package.json ships a build that misreports its own version.
  it('matches the version in package.json', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
    expect(VERSION).toBe(pkg.version)
  })
})
