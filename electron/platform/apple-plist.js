'use strict';

// Minimal, dependency-free parser for the XML property lists emitted by diskutil.
// Never resolves external entities, expands DTDs or interprets XML as executable data.
const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_TOKENS = 50000;
const MAX_DEPTH = 32;

function decodeXml(value) {
  return value.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);|&/g, (entity, name) => {
    if (!name) throw new Error('Ungültige XML-Entität');
    const builtins = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(builtins, name)) return builtins[name];
    const number = name.startsWith('#x')
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
    if (
      !Number.isInteger(number) ||
      number === 0 ||
      number > 0x10ffff ||
      (number >= 0xd800 && number <= 0xdfff)
    )
      throw new Error('Ungültiges XML-Zeichen');
    return String.fromCodePoint(number);
  });
}

function parseApplePlist(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES)
    throw new Error('PLIST-Ausgabe zu groß oder ungültig');
  if (/<!ENTITY\b|<!\[CDATA\[/i.test(xml)) throw new Error('Nicht unterstütztes XML-Konstrukt');
  const tokens = [];
  const expression = /<!--[\s\S]*?-->|<\?[^>]*\?>|<!DOCTYPE[^>]*>|<[^>]*>|[^<]+/g;
  let previous = 0;
  for (const match of xml.matchAll(expression)) {
    if (match.index !== previous) throw new Error('Ungültiges PLIST-XML');
    previous = match.index + match[0].length;
    const token = match[0];
    if (/^<!--|^<\?|^<!DOCTYPE/.test(token)) continue;
    tokens.push(token);
    if (tokens.length > MAX_TOKENS) throw new Error('PLIST zu komplex');
  }
  if (previous !== xml.length) throw new Error('Ungültiges PLIST-XML');
  let pos = 0;
  const skipSpace = () => {
    while (pos < tokens.length && !tokens[pos].startsWith('<') && !tokens[pos].trim()) pos++;
  };
  const consume = (tag) => {
    skipSpace();
    if (tokens[pos] !== tag) throw new Error(`Ungültige PLIST-Struktur (${tag})`);
    pos++;
  };
  function read(depth = 0) {
    if (depth > MAX_DEPTH) throw new Error('PLIST zu tief verschachtelt');
    skipSpace();
    const open = tokens[pos++];
    if (!open) throw new Error('Unvollständige PLIST-Struktur');
    if (open === '<true/>' || open === '<true />') return true;
    if (open === '<false/>' || open === '<false />') return false;
    if (open === '<dict/>' || open === '<dict />') return {};
    if (open === '<array/>' || open === '<array />') return [];
    const tag = /^<([a-z]+)>$/.exec(open)?.[1];
    if (!tag) {
      const emptyTag = /^<(string|key|data)\s*\/>$/.exec(open)?.[1];
      if (emptyTag) return '';
      throw new Error('Unbekannter PLIST-Datentyp');
    }
    if (tag === 'dict') {
      const object = {};
      while (true) {
        skipSpace();
        if (tokens[pos] === '</dict>') {
          pos++;
          break;
        }
        if (pos >= tokens.length) throw new Error('Unvollständiges PLIST-Dictionary');
        const key = read(depth + 1);
        if (typeof key !== 'string') throw new Error('Ungültiger PLIST-Schlüssel');
        const value = read(depth + 1);
        // Defend against prototype pollution from malformed/untrusted output.
        Object.defineProperty(object, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return object;
    }
    if (tag === 'array') {
      const array = [];
      while (true) {
        skipSpace();
        if (tokens[pos] === '</array>') {
          pos++;
          break;
        }
        if (pos >= tokens.length) throw new Error('Unvollständiges PLIST-Array');
        array.push(read(depth + 1));
      }
      return array;
    }
    if (!['plist', 'key', 'string', 'integer', 'real', 'data', 'date'].includes(tag))
      throw new Error('Nicht unterstützter PLIST-Datentyp');
    if (tag === 'plist') {
      const result = read(depth + 1);
      consume('</plist>');
      return result;
    }
    let content = '';
    while (pos < tokens.length && tokens[pos] !== `</${tag}>`) {
      if (tokens[pos].startsWith('<')) throw new Error('Ungültiger Text im PLIST');
      content += tokens[pos++];
    }
    consume(`</${tag}>`);
    const value = decodeXml(content);
    if (tag === 'integer') return /^[-+]?\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
    if (tag === 'real') return Number(value.trim());
    return value;
  }
  skipSpace();
  if (/^<plist\b/.test(tokens[pos] || '')) {
    pos++;
    const result = read(0);
    consume('</plist>');
    skipSpace();
    if (pos !== tokens.length) throw new Error('Zusätzliche PLIST-Daten');
    return result;
  }
  // Accept a dict fragment in addition to a complete XML plist (test fixtures).
  const result = read(0);
  skipSpace();
  if (pos !== tokens.length) throw new Error('Zusätzliche PLIST-Daten');
  return result;
}

module.exports = { parseApplePlist };
