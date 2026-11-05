// @ts-check
'use strict';

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {unknown} error @returns {string | undefined} */
function errorCode(error) {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    return typeof error.code === 'string' ? error.code : undefined;
  }
  return undefined;
}

module.exports = { errorMessage, errorCode };
