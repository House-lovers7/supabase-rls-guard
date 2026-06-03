import type { OutputFormat, ScanResult } from '../core/types.js'
import { renderGithub } from './github.js'
import { renderJson } from './json.js'
import { renderSarif } from './sarif.js'
import { renderText } from './text.js'

export { renderGithub, renderJson, renderSarif, renderText }

export interface RenderOptions {
  color?: boolean
}

export function render(
  result: ScanResult,
  format: OutputFormat,
  options: RenderOptions = {},
): string {
  switch (format) {
    case 'json':
      return renderJson(result)
    case 'github':
      return renderGithub(result)
    case 'sarif':
      return renderSarif(result)
    default:
      return renderText(result, options.color ?? true)
  }
}
