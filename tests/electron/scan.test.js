const test = require('node:test');
const assert = require('node:assert/strict');
// electron mock: smart.js imports app at module level
const Module = require('node:module');
const original = Module._load;
Module._load = function (id, ...args) {
  if (id === 'electron') return { app: { isPackaged: false } };
  return original.call(this, id, ...args);
};
const { parseDiskutilList } = require('../../electron/devices/smart.js');
Module._load = original;
test('diskutil detects physical whole disks and ignores synthetic images', () => {
  const output = `/dev/disk0 (internal, physical):
   0: GUID_partition_scheme *1.0 TB disk0
/dev/disk1 (synthesized):
/dev/disk3 (external, physical):
/dev/disk4 (disk image):
`;
  assert.deepEqual(
    parseDiskutilList(output).map((d) => d.name),
    ['/dev/disk0', '/dev/disk3'],
  );
});
const { parseDiskutilInfo } = require('../../electron/devices/smart.js');
test('diskutil plist reads actual disk capacity for devices without smartctl user_capacity', () => {
  const xml =
    '<dict><key>TotalSize</key><integer>500277790720</integer><key>BusProtocol</key><string>PCI-Express</string></dict>';
  assert.equal(parseDiskutilInfo(xml).capacityBytes, 500277790720);
  assert.equal(
    parseDiskutilInfo('<dict><key>TotalSize</key><integer>unknown</integer></dict>').capacityBytes,
    undefined,
  );
});
test('diskutil plist separates USB transport from ATA command protocol', () => {
  const xml =
    '<?xml version="1.0"?><plist><dict><key>BusProtocol</key><string>USB</string><key>Internal</key><false/></dict></plist>';
  assert.deepEqual(parseDiskutilInfo(xml), { transport: 'USB', internal: false, physical: null });
});
test('unknown transport is not fabricated as USB', () => {
  assert.deepEqual(parseDiskutilInfo('<dict><key>Internal</key><true/></dict>'), {
    transport: null,
    internal: true,
    physical: null,
  });
});

test('diskutil exposes independently verified operating system metadata', () => {
  const xml =
    '<dict><key>TotalSize</key><integer>500277792768</integer><key>DeviceBlockSize</key><integer>4096</integer><key>DeviceIdentifier</key><string>disk0</string><key>SolidState</key><true/><key>Internal</key><true/><key>Removable</key><false/><key>Ejectable</key><false/></dict>';
  const info = parseDiskutilInfo(xml);
  assert.equal(info.capacityBytes, 500277792768);
  assert.equal(info.osMetadata.logicalBlockSize, 4096);
  assert.equal(info.osMetadata.identifier, 'disk0');
  assert.equal(info.osMetadata.solidState, true);
  assert.equal(info.osMetadata.removable, false);
  assert.equal(info.internal, true);
});

const { parseDiskutilPhysicalList } = require('../../electron/devices/smart.js');
test('macOS physical plist listing uses whole disks and rejects partition identifiers', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>AllDisksAndPartitions</key><array>
      <dict><key>DeviceIdentifier</key><string>disk0</string><key>Partitions</key><array>
        <dict><key>DeviceIdentifier</key><string>disk0s1</string></dict></array></dict>
      <dict><key>DeviceIdentifier</key><string>disk4</string></dict>
    </array>
    <key>AllDisks</key><array><string>disk0</string><string>disk0s1</string><string>disk4</string></array>
  </dict></plist>`;
  assert.deepEqual(
    parseDiskutilPhysicalList(xml).map((disk) => disk.name),
    ['/dev/disk0', '/dev/disk4'],
  );
});
test('macOS physical plist supports WholeDisks on older macOS versions', () => {
  const xml =
    '<plist><dict><key>WholeDisks</key><array><string>disk4</string><string>disk0</string><string>disk4</string><string>disk4s1</string></array></dict></plist>';
  assert.deepEqual(
    parseDiskutilPhysicalList(xml).map((disk) => disk.name),
    ['/dev/disk4', '/dev/disk0'],
  );
  assert.throws(
    () => parseDiskutilPhysicalList('<dict><key>Unrelated</key><array/></dict>'),
    /ganzen Geräte/,
  );
});
test('nested metadata and XML entities do not override diskutil whole disk fields', () => {
  const info = parseDiskutilInfo(`<plist><dict>
    <key>Nested</key><dict><key>TotalSize</key><integer>1</integer><key>BusProtocol</key><string>USB</string></dict>
    <key>TotalSize</key><integer>500277792768</integer>
    <key>BusProtocol</key><string>Apple Fabric</string>
    <key>MediaName</key><string>Apple SSD &amp; Controller</string>
    <key>PhysicalBlockSize</key><integer>4096</integer>
    <key>SolidState</key><true/>
  </dict></plist>`);
  assert.equal(info.capacityBytes, 500277792768);
  assert.equal(info.transport, 'Apple Fabric');
  assert.equal(info.osMetadata.mediaName, 'Apple SSD & Controller');
  assert.equal(info.osMetadata.physicalBlockSize, 4096);
});
