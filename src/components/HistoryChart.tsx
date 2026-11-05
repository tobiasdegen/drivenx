import { useMemo, useState } from 'react';
import type { HistoryRecord } from '../types';
import { translate, translateNested, type Locale } from '../i18n.mts';
import { METRICS, historyVolumeBytes } from '../../shared/diagnostic-metrics.mjs';
import { historyChartKeys, historyChartPoints } from '../history-trends.mjs';

export default function HistoryChart({
  records,
  locale,
}: {
  records: HistoryRecord[];
  locale: Locale;
}) {
  const available = useMemo(() => historyChartKeys(records), [records]);
  const [selected, setSelected] = useState<string>('');
  const key = available.find((option) => option === selected) ?? available[0];
  const points = useMemo(() => historyChartPoints(records, key), [records, key]);
  if (!key || points.length < 2) return null;
  const baseUnit = METRICS[key].unit;
  const dataVolume = baseUnit === '512000B' || baseUnit === 'B';
  const maximumBytes = dataVolume
    ? points.reduce((max, r) => {
        const bytes = historyVolumeBytes(key, r.metrics[key]);
        return bytes !== null && bytes > max ? bytes : max;
      }, 0n)
    : 0n;
  const unit = dataVolume
    ? maximumBytes >= 1_000_000_000_000n
      ? 'TB'
      : 'GB'
    : baseUnit === 'count'
      ? ''
      : baseUnit;
  const divisor = unit === 'TB' ? 1e12 : 1e9;
  const values = points.map((r) =>
    dataVolume
      ? Number(historyVolumeBytes(key, r.metrics[key]) ?? 0n) / divisor
      : (r.metrics[key] as number),
  );
  const min = Math.min(...values),
    max = Math.max(...values),
    span = Math.max(1, max - min);
  const W = 800,
    H = 230,
    L = 67,
    R = 18,
    T = 23,
    B = 45;
  const time = points.map((r) => Date.parse(r.capturedAt));
  const first = time[0],
    duration = Math.max(1, time[time.length - 1] - first);
  const x = (i: number) => L + ((time[i] - first) / duration) * (W - L - R);
  const y = (v: number) => T + ((max - v) / span) * (H - T - B);
  const plotted = points.map((_, i) => `${x(i)},${y(values[i])}`).join(' ');
  const format = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 2 });
  return (
    <section
      className="history-chart"
      aria-label={translate(locale, 'smartView', 'historyChartAria')}
    >
      <div className="history-chart-toolbar">
        <h4>{translate(locale, 'smartView', 'historyChartTitle')}</h4>
        <label>
          {translate(locale, 'smartView', 'historyChartMetric')}{' '}
          <select value={key} onChange={(e) => setSelected(e.target.value)}>
            {available.map((id) => (
              <option key={id} value={id}>
                {translateNested(locale, 'historyMetrics', id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${translateNested(locale, 'historyMetrics', key)}: ${values.map(format).join(' → ')}`}
      >
        {[0, 0.5, 1].map((f) => {
          const yy = T + f * (H - T - B);
          return (
            <g key={f}>
              <line className="history-chart-grid" x1={L} x2={W - R} y1={yy} y2={yy} />
              <text className="history-chart-axis" x={L - 10} y={yy + 4} textAnchor="end">
                {format(max - f * span)}
              </text>
            </g>
          );
        })}
        <polyline className="history-chart-line" points={plotted} />
        {points.map((r, i) => (
          <circle
            key={`${r.capturedAt}-${i}`}
            className="history-chart-point"
            cx={x(i)}
            cy={y(values[i])}
            r="4"
          >
            <title>
              {new Date(r.capturedAt).toLocaleString(locale)}: {format(values[i])} {unit}
            </title>
          </circle>
        ))}
        {[0, points.length - 1].map((i) => (
          <text
            key={i}
            className="history-chart-axis"
            x={x(i)}
            y={H - 13}
            textAnchor={i === 0 ? 'start' : 'end'}
          >
            {new Date(points[i].capturedAt).toLocaleString(locale, {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </text>
        ))}
      </svg>
      <p className="history-note">{translate(locale, 'smartView', 'historyChartSamplingNote')}</p>
    </section>
  );
}
