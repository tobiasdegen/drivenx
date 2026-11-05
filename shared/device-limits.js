// Shared identifier limits across discovery and untrusted IPC input.
// The IPC handler still authorizes the identifier against the latest scan.
'use strict';
const MAX_DEVICE_NAME_LENGTH = 400;
const MAX_DEVICE_TYPE_LENGTH = 80;
module.exports = { MAX_DEVICE_NAME_LENGTH, MAX_DEVICE_TYPE_LENGTH };
