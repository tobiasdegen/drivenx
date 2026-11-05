'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readCompanyLogo } = require('../../electron/reports/company-logo.js');

function fakeFile(bytes, initialSize = bytes.length, openedSize = bytes.length) {
  const stat = (size) => ({ isFile: () => true, size });
  let closed = false;
  let cursor = 0;
  return {
    stat: async () => stat(initialSize),
    open: async () => ({
      stat: async () => stat(openedSize),
      read: async (buffer, offset, length, position) => {
        const start = position === null ? cursor : position;
        const slice = bytes.subarray(start, start + length);
        slice.copy(buffer, offset);
        if (position === null) cursor += slice.length;
        return { bytesRead: slice.length, buffer };
      },
      close: async () => {
        closed = true;
      },
    }),
    get closed() {
      return closed;
    },
  };
}

test('company logos accept binary PNG/JPEG signatures only', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 99]);
  const jpeg = Buffer.from([255, 216, 255, 99]);
  assert.match(await readCompanyLogo(fakeFile(png), 'logo.png'), /^data:image\/png;base64,/);
  assert.match(await readCompanyLogo(fakeFile(jpeg), 'logo.jpg'), /^data:image\/jpeg;base64,/);
  await assert.rejects(readCompanyLogo(fakeFile(Buffer.from('text')), 'logo.jpg'), /echte PNG/);
});

test('company logos check both file size and reopened file size', async () => {
  await assert.rejects(
    readCompanyLogo(fakeFile(Buffer.from([255, 216, 255]), 1024 * 1024 + 1), 'logo.jpg'),
    /maximal 1 MB/,
  );
  await assert.rejects(
    readCompanyLogo(fakeFile(Buffer.alloc(1024 * 1024 + 1, 255), 1), 'logo.jpg'),
    /maximal 1 MB/,
  );
});

test('company logo bounded reader rejects a growing file and closes the handle', async () => {
  const file = fakeFile(Buffer.alloc(1024 * 1024 + 1, 255), 1, 1);
  await assert.rejects(readCompanyLogo(file, 'logo.png'), /maximal 1 MB/);
  assert.equal(file.closed, true);
});

test('company logo bounded reader supports short partial reads', async () => {
  const bytes = Buffer.from([255, 216, 255, 101, 102, 103, 104]);
  let position = 0;
  const file = {
    stat: async () => ({ isFile: () => true, size: bytes.length }),
    open: async () => ({
      stat: async () => ({ isFile: () => true, size: bytes.length }),
      read: async (buffer, offset, length) => {
        const count = Math.min(2, length, bytes.length - position);
        bytes.copy(buffer, offset, position, position + count);
        position += count;
        return { bytesRead: count, buffer };
      },
      close: async () => {},
    }),
  };
  assert.equal(
    await readCompanyLogo(file, 'logo.jpg'),
    `data:image/jpeg;base64,${bytes.toString('base64')}`,
  );
});
