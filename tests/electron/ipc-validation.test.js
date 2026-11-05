'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const v = require('../../electron/ipc/ipc-validation.js');
const { MAX_DEVICE_NAME_LENGTH } = require('../../shared/device-limits.js');
test('device accepts only name and type, rejects invalid payloads', () => {
  assert.deepEqual(v.device({ name: '/dev/sda', type: 'nvme', shell: 'attack' }), {
    name: '/dev/sda',
    type: 'nvme',
  });
  for (const x of [
    null,
    [],
    {},
    { name: [], type: 'nvme' },
    { name: '/dev/sda', type: {} },
    { name: 'x'.repeat(MAX_DEVICE_NAME_LENGTH + 1), type: 'auto' },
  ])
    assert.throws(() => v.device(x));
});
test('settings whitelist and reject unknown enum values', () => {
  let good = { locale: 'de-DE', theme: 'dark', attributeMode: 'friendly' };
  assert.deepEqual(v.settings({ ...good, unused: 42 }), {
    ...good,
    backgroundDetails: false,
    autoSaveHistory: false,
    autoBackupHistory: false,
    companyName: '',
    companyAddress: '',
    companyContact: '',
    companyLogo: '',
  });
  for (const patch of [{ theme: 'other' }, { locale: 'fr' }, { attributeMode: 'broken' }])
    assert.throws(() => v.settings({ ...good, ...patch }));
});
test('export validates format, locale and device', () => {
  const r = v.exportRequest(
    { name: '/dev/sda', type: 'nvme', raw: { secret: 'unused' } },
    'json',
    'de-DE',
    '550e8400-e29b-41d4-a716-446655440000',
  );
  assert.equal(r.device.name, '/dev/sda');
  assert.equal(r.format, 'json');
  assert.equal(r.reportId, '550e8400-e29b-41d4-a716-446655440000');
  assert.throws(() => v.exportRequest({ name: 'x', type: 'auto' }, 'pdf', 'de-DE'));
  assert.throws(() => v.exportRequest({ name: 'x', type: 'auto' }, 'pdf', 'de-DE', 'bad'));
  assert.throws(() =>
    v.exportRequest(
      { name: 'x', type: 'auto' },
      'pdf',
      'de-DE',
      '550e8400-e29b-41d4-a716-446655440000'.repeat(100),
    ),
  );
  assert.throws(() => v.exportRequest({}, 'json', 'de-DE'));
  assert.throws(() => v.exportRequest({ name: 'x', type: 'auto' }, 'exe', 'de-DE'));
  assert.throws(() => v.exportRequest({ name: 'x', type: 'auto' }, 'pdf', 'es'));
});
test('test type only short or long', () => {
  assert.equal(v.testKind('short'), 'short');
  assert.throws(() => v.testKind('extended'));
});

test('report company fields and logo validated', () => {
  const good = {
    locale: 'de-DE',
    theme: 'dark',
    attributeMode: 'friendly',
    backgroundDetails: false,
    reportMode: 'technical',
    companyName: 'Werkstatt',
    companyAddress: 'Straße 1',
    companyContact: 'mail@example.org',
    companyLogo: 'data:image/png;base64,iVBORw0KGgo=',
  };
  assert.equal(Object.hasOwn(v.settings(good), 'reportMode'), false);
  for (const bad of [
    { companyName: 'X'.repeat(151) },
    { companyLogo: 'data:image/svg+xml;base64,AAAA' },
  ])
    assert.throws(() => v.settings({ ...good, ...bad }));
});

test('unrecognized executable settings are discarded during validation', () => {
  const clean = v.settings({
    locale: 'de-DE',
    theme: 'dark',
    attributeMode: 'friendly',
    smartctlMode: 'custom',
    customBinary: 'C:\\tmp\\evil.exe',
  });
  assert.equal(Object.hasOwn(clean, 'customBinary'), false);
  assert.equal(Object.hasOwn(clean, 'smartctlMode'), false);
});

test('self-test request must reference a valid displayed report snapshot', () => {
  const d = { name: '/dev/sda', type: 'auto' };
  assert.deepEqual(v.testRequest(d, 'short', '550e8400-e29b-41d4-a716-446655440000'), {
    device: d,
    kind: 'short',
    reportId: '550e8400-e29b-41d4-a716-446655440000',
  });
  assert.throws(() => v.testRequest(d, 'abort', '550e8400-e29b-41d4-a716-446655440000'));
  assert.throws(() => v.testRequest(d, 'short', 'invalid'));
});

test('company logo validates actual image bytes, MIME and decoded 1 MiB boundary', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const jpg = Buffer.from([255, 216, 255, 0, 42]);
  assert.equal(
    v.validatedLogo(`data:image/png;base64,${png.toString('base64')}`),
    `data:image/png;base64,${png.toString('base64')}`,
  );
  assert.equal(
    v.validatedLogo(`data:image/jpeg;base64,${jpg.toString('base64')}`),
    `data:image/jpeg;base64,${jpg.toString('base64')}`,
  );
  for (const value of [
    42,
    'data:image/png;base64,SGVsbG8=',
    `data:image/jpeg;base64,${png.toString('base64')}`,
    'data:image/png;base64,A',
    'data:image/png;base64,AA===',
    `data:image/png;base64,${Buffer.concat([png, Buffer.alloc(1024 * 1024 - png.length + 1)]).toString('base64')}`,
  ])
    assert.throws(() => v.validatedLogo(value), /[Ll]ogo/);
});

test('history saving requires a validated measurement ID', () => {
  const uuid = '12345678-1234-4234-9234-123456789abc';
  assert.equal(v.reportIdToken(uuid), uuid);
  for (const value of ['', 'stale', 123, null, '12345678-1234-1234-1234-123456789abc'])
    assert.throws(() => v.reportIdToken(value), /Messungskennung/);
});

test('bare language tags are not accepted in preferences or report exports', () => {
  const valid = {
    locale: 'de-DE',
    theme: 'dark',
    attributeMode: 'friendly',
  };
  assert.equal(v.settings(valid).locale, 'de-DE');
  assert.throws(() => v.settings({ ...valid, locale: 'de' }));
  assert.throws(() => v.settings({ ...valid, locale: 'en' }));
});
