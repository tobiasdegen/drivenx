import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AttributesPanel from '../../src/components/tabs/AttributesPanel';
import AttributeDetailsDialog from '../../src/components/tabs/AttributeDetailsDialog';
import { attributeInfo } from '../../src/attribute-info';
import { formatSmartInteger } from '../../src/smart-metrics';
import type { SmartctlReport } from '../../src/smartctl-types';
import type { Health } from '../../src/types';

vi.mock('../../src/attribute-evidence-text', () => ({
  attributeFindingReason: (evidence: { ruleId: string }) => evidence.ruleId,
}));
vi.mock('../../src/components/tabs/AtaStatisticsPanel', () => ({ default: () => null }));

function markup(
  raw: SmartctlReport,
  locale: 'de-DE' | 'en-US' = 'de-DE',
  diagnosis: Health['diagnosis'] = { assessment: 'complete', evidence: [] } as Health['diagnosis'],
) {
  return renderToStaticMarkup(
    React.createElement(AttributesPanel, {
      raw,
      locale,
      health: { diagnosis } as Health,
      attributeMode: 'friendly',
      setAttributeMode: () => {},
      query: '',
      setQuery: () => {},
    }),
  );
}

function details(attribute: {
  id: number | string;
  name: string;
  raw: string;
  current?: number;
  worst?: number;
  threshold?: number;
}) {
  return renderToStaticMarkup(
    React.createElement(AttributeDetailsDialog, {
      attribute,
      evidence: [],
      severity: null,
      locale: 'de-DE',
      onClose: () => {},
    }),
  );
}

describe('SMART attribute presentation', () => {
  it('NVMe SMART table has three columns and the same explanation as its dialog', () => {
    const html = markup({
      model_name: 'APPLE SSD',
      nvme_smart_health_information_log: {
        critical_warning: 0,
        available_spare: 100,
        host_reads: 2430143222,
      },
    } as SmartctlReport);
    expect(html.match(/scope="col"/g) || []).toHaveLength(3);
    expect(html).toMatch(/2\.430\.143\.222/);
    expect(html).not.toMatch(/>Kein Einzelbefund</);
    expect(html).not.toMatch(/Bitfeld für aktuelle kritische Bedingungen/);
    expect(html).not.toMatch(/Bitmaske für kritische NVMe-Zustände/);
    expect(details({ id: '–', name: 'critical_warning', raw: '0' })).toContain(
      'Bitfeld für aktuelle kritische Bedingungen',
    );
  });

  it('ATA SMART table keeps raw values and ID but moves normalized fields to details', () => {
    const html = markup(
      {
        model_name: 'Test SATA',
        ata_smart_attributes: {
          table: [
            {
              id: 197,
              name: 'Current_Pending_Sector',
              value: 100,
              worst: 99,
              thresh: 20,
              raw: { string: '12345' },
            },
          ],
        },
      } as SmartctlReport,
      'de-DE',
      {
        assessment: 'complete',
        evidence: [{ ruleId: 'pending', severity: 'critical', source: 'ata_smart_attributes.197' }],
      } as Health['diagnosis'],
    );
    expect(html.match(/scope="col"/g) || []).toHaveLength(3);
    expect(html).toMatch(/ID 197/);
    expect(html).toMatch(/Schwebende Sektoren/);
    expect(html).toMatch(/12\.345/);
    expect(html).toMatch(/pending/);
    expect(html).not.toMatch(/Herstellergrenze/);
    const dialogHtml = details({
      id: 197,
      name: 'Current_Pending_Sector',
      raw: '12345',
      current: 100,
      worst: 99,
      threshold: 20,
    });
    expect(dialogHtml).toMatch(/Herstellergrenze/);
    expect(dialogHtml).toMatch(/12345/);
  });

  it('preserves packed ATA strings, leading zeros and large integers', () => {
    expect(formatSmartInteger('2430143222', 'de-DE')).toBe('2.430.143.222');
    expect(formatSmartInteger('2430143222', 'en-US')).toBe('2,430,143,222');
    expect(formatSmartInteger('900719925474099312345', 'de-DE')).toBe(
      '900.719.925.474.099.312.345',
    );
    for (const raw of ['00001234', '0/214539416', '12598 (41936 1)', '0x10']) {
      expect(formatSmartInteger(raw, 'de-DE')).toBe(raw);
    }
  });

  it('SCSI counters have a protocol-specific explanation in both views', () => {
    const scsi = attributeInfo('–', 'read / total_uncorrected_errors', 'de-DE');
    expect(scsi.label).toMatch(/Lesefehler/);
    expect(scsi.interpretation).toMatch(/kumulativ/);
    const html = markup({
      scsi_error_counter_log: { read: { total_uncorrected_errors: 0 } },
    } as SmartctlReport);
    expect(html.match(/scope="col"/g) || []).toHaveLength(3);
    expect(html).toMatch(/Nicht korrigierte Lesefehler/i);
  });
});
