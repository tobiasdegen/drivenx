'use strict';
const ELECTRON_SOURCE_DIR = require('node:path').resolve(__dirname, '../../electron');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(ELECTRON_SOURCE_DIR, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('connection view renders one continuous route, speed links, and a technical details popup', () => {
  const ui = read('src/components/ConnectionChain.tsx');
  const css = read('src/styles/connection-flow.css');
  assert.match(ui, /usb-flow-path/);
  assert.match(ui, /stage\.link\?\.label/);
  assert.match(ui, /usb-flow-details-trigger/);
  assert.match(ui, /role="dialog"\s+aria-modal="true"/);
  assert.match(ui, /event.key === 'Escape'/);
  assert.match(css, /usb-flow-dialog-overlay/);
  assert.doesNotMatch(ui, /<details className="usb-flow-technical"/);
  assert.match(ui, /raw\?\.interface_speed\?\.current/);
  assert.doesNotMatch(
    ui,
    /connection-id-details|connection-steps--chain|Mögliche Zusatzbezeichnung/,
  );
  assert.match(css, /container:\s*usb-flow\s*\/\s*inline-size/);
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@container usb-flow \(max-width:\s*1150px\)/);
  assert.match(css, /@container usb-flow \(max-width:\s*670px\)/);
  assert.match(css, /\.usb-flow-link-line::before/);
});

test('USB ID lookup remains presentation-only, not an unverified access mode', () => {
  const { enrichUsbNames } = require('../../electron/devices/usb-id-lookup.js');
  const device = {
    name: '/dev/disk4',
    type: 'sat',
    transport: 'USB',
    connection: {
      verified: false,
      chain: [{ name: 'USB-Bridge', vendorId: '0x174c', productId: '0x55aa' }],
    },
  };
  const result = enrichUsbNames(device);
  assert.strictEqual(result, device);
  assert.equal(result.type, 'sat');
});

test('USB path uses container-aware, readable station cards rather than narrow flex columns', () => {
  const ui = read('src/components/ConnectionChain.tsx');
  const css = read('src/styles/connection-flow.css');
  const hardware = read('src/styles/drive-views.css');
  assert.match(ui, /className="usb-flow-node-body"/);
  assert.match(css, /\.usb-flow-unit\s*\{[^}]*display:\s*flex/);
  assert.match(css, /@container usb-flow \(max-width:\s*670px\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(hardware, /\.hardware-view\s+\.connection-panel\s*\{\s*width:\s*100%/);
  assert.doesNotMatch(
    hardware,
    /\.hardware-view\s+\.connection-panel\s*\{\s*width:\s*min\(100%,\s*1180px\)/,
  );
});
