import { describe, expect, it, vi } from 'vitest';
import SmartTabs from '../../src/components/SmartTabs';
import AttributesPanel from '../../src/components/tabs/AttributesPanel';
import type { SmartTabsProps } from '../../src/components/SmartTabs';

const mocks = vi.hoisted(() => ({
  countDriveErrors: vi.fn(() => 7),
}));

vi.mock('../../src/drive-display', () => ({ countDriveErrors: mocks.countDriveErrors }));
vi.mock('../../src/components/ConnectionChain', () => ({ connectionChain: () => null }));
vi.mock('../../src/components/DeviceInformation', () => ({ default: () => null }));
vi.mock('../../src/components/DriveOverview', () => ({ default: () => null }));
vi.mock('../../src/components/tabs/HistoryPanel', () => ({ default: () => null }));
vi.mock('../../src/components/tabs/AttributesPanel', () => ({ default: () => null }));
vi.mock('../../src/components/tabs/SelfTestsPanel', () => ({ default: () => null }));
vi.mock('../../src/components/tabs/ErrorLogPanel', () => ({ default: () => null }));
vi.mock('../../src/components/tabs/AtaHardwareDetails', () => ({ default: () => null }));
vi.mock('../../src/components/tabs/HostIoPanel', () => ({ default: () => null }));

function findElement(
  root: unknown,
  type: unknown,
): { key: string | null; props: Record<string, unknown> } | null {
  if (!root || typeof root !== 'object') return null;
  const element = root as {
    type?: unknown;
    key?: string | null;
    props?: Record<string, unknown>;
  };
  if (element.type === type)
    return element as { key: string | null; props: Record<string, unknown> };
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

function props(tab: SmartTabsProps['tab'], reportId: string, name = '/dev/sda'): SmartTabsProps {
  return {
    tab,
    setTab: () => {},
    locale: 'de-DE',
    active: { name, type: 'auto' } as SmartTabsProps['active'],
    detail: {
      reportId,
      raw: { model_name: 'Testlaufwerk' },
      capturedAt: '2026-10-26T12:00:00Z',
    } as SmartTabsProps['detail'],
    env: null,
    attributeMode: 'friendly',
    setAttributeMode: () => {},
    query: '',
    setQuery: () => {},
    loading: false,
    onStartTest: () => {},
  };
}

describe('SMART tab navigation', () => {
  it('avoids error aggregation in unrelated tabs', () => {
    mocks.countDriveErrors.mockClear();
    for (const tab of ['overview', 'history', 'hardware', 'tests', 'attributes'] as const) {
      SmartTabs(props(tab, 'report-1'));
    }
    expect(mocks.countDriveErrors).not.toHaveBeenCalled();
    SmartTabs(props('errors', 'report-1'));
    expect(mocks.countDriveErrors).toHaveBeenCalledOnce();
  });

  it('remounts the attribute view on report or device identity changes', () => {
    const extract = (reportId: string, name = '/dev/sda') =>
      findElement(SmartTabs(props('attributes', reportId, name)), AttributesPanel);
    const initial = extract('report-1');
    const refreshed = extract('report-2');
    const switched = extract('report-1', '/dev/sdb');
    expect(initial).not.toBeNull();
    expect(refreshed).not.toBeNull();
    expect(switched).not.toBeNull();
    expect(initial?.key).not.toBe(refreshed?.key);
    expect(initial?.key).not.toBe(switched?.key);
    expect(initial?.key).toContain('report-1');
    expect(initial?.props.attrs).toBeUndefined();
    expect(initial?.props.visible).toBeUndefined();
  });
});
