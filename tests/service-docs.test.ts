import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const OFFER = 'docs/service/README.md'
const ORDER = 'docs/service/templates/order-and-intake.md'
const REPORT = 'docs/service/templates/audit-report.md'
const SAMPLE = 'docs/service/samples/synthetic-audit-report.md'
const RUNBOOK = 'docs/service/operator-runbook.md'
const ADR = 'docs/03_adrs/ADR-0001-rls-spot-audit-service-boundary.md'

async function text(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

describe('RLS spot-audit service contract', () => {
  it('keeps the single offer, scope, price cap, and CTA consistent', async () => {
    const [offer, order] = await Promise.all([text(OFFER), text(ORDER)])
    for (const document of [offer, order]) {
      expect(document).toContain('Supabase Migration SQL・RLSスポット監査')
      expect(document).toContain('最大50')
      expect(document).toContain('10,000円/時間（税別）')
      expect(document).toContain('最大5時間')
      expect(document).toContain('50,000円')
      expect(document).toContain('修正実装')
    }
    expect(offer).toContain('有償監査実績は0件')
    expect(offer).toContain('15分の適合確認')
  })

  it('marks the sample as synthetic, non-customer, and non-evidence', async () => {
    const sampleLead = (await text(SAMPLE)).slice(0, 500)
    expect(sampleLead).toContain('合成サンプル')
    expect(sampleLead).toContain('顧客案件ではありません')
    expect(sampleLead).toContain('有償監査実績を示すものではありません')
  })

  it('separates tool output, human judgment, warnings, and recheck evidence', async () => {
    const report = await text(REPORT)
    expect(report).toContain('CLIルールID')
    expect(report).toContain('人手判定')
    expect(report).toContain('解析警告数')
    expect(report).toContain('監査未完了')
    expect(report).toContain('再確認結果')
  })

  it('fixes the bounded lifecycle and keeps customer material outside the repo', async () => {
    const [runbook, adr, gitignore] = await Promise.all([
      text(RUNBOOK),
      text(ADR),
      text('.gitignore'),
    ])
    for (const state of [
      'FIT',
      'ORDERED',
      'RECEIVED',
      'ACCEPTED',
      'REJECTED',
      'SCANNED',
      'MANUAL_REVIEW',
      'DELIVERED',
      'RECHECKED',
      'EXPIRED',
      'DELETED',
    ]) {
      expect(runbook).toContain(state)
    }
    expect(runbook).toContain('初回納品から30日')
    expect(runbook).toContain('初回納品から37日')
    expect(adr).toContain('リポジトリ外')
    expect(gitignore).toContain('.audit-work/')
    expect(gitignore).toContain('*.zip')
  })

  it('does not use claims that overstate a limited static audit', async () => {
    const customerFacing = await Promise.all([text(OFFER), text(ORDER), text(REPORT), text(SAMPLE)])
    const forbidden = [/安全を保証/u, /脆弱性(?:は|が)ありません/u, /★/u, /最も人気/u, /実績豊富/u]
    for (const document of customerFacing) {
      for (const pattern of forbidden) expect(document).not.toMatch(pattern)
    }
  })
})
