// solve.js — a fast drop-in for csv-reader 1.0.0 (make.fun's own reference CSV reader).
//
// Replicates vendor/csv-reader/index.js exactly: for every input {text, header} it returns
// the same {columns, rows, errors}. The implementation is a single left-to-right pass
// over char codes, with bulk slice() extraction for fields instead of the reference's
// one-character-at-a-time string building. No state is kept between calls; output is
// deterministic. Dependency-free ES module.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Read an unquoted field starting at `start`, with `prefix` already in the value.
  // Returns [value, ended, newPos, newLine, added]; ended 0=comma, 1=line break, 2=end.
  // `added` counts the characters kept during this read (for the quote_junk check).
  // Pushes a stray_cr error for every CR not followed by LF, as met.
  const readUnquoted = (start, prefix, ln) => {
    let i = start;
    let value = prefix;
    let added = 0;
    let l = ln;
    for (;;) {
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 44 || c === 10 || c === 13) break;
        j++;
      }
      if (j >= n) {
        if (j > i) {
          value += text.slice(i, j);
          added += j - i;
        }
        return [value, 2, n, l, added];
      }
      const c = text.charCodeAt(j);
      if (c === 44) {
        if (j > i) {
          value += text.slice(i, j);
          added += j - i;
        }
        return [value, 0, j + 1, l, added];
      }
      if (c === 10) {
        if (j > i) {
          value += text.slice(i, j);
          added += j - i;
        }
        return [value, 1, j + 1, l + 1, added];
      }
      if (j + 1 < n && text.charCodeAt(j + 1) === 10) {
        if (j > i) {
          value += text.slice(i, j);
          added += j - i;
        }
        return [value, 1, j + 2, l + 1, added];
      }
      // A CR not followed by LF is dropped (stray_cr); the field goes on.
      if (j > i) {
        value += text.slice(i, j);
        added += j - i;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      i = j + 1;
    }
  };

  // Read a quoted field whose opening quote is at `start` (on line `ln`).
  // Returns [value, ended, newPos, newLine].
  const readQuoted = (start, ln) => {
    const open = start;
    const openLine = ln;
    let p = start + 1;
    let l = ln;
    let value = '';
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is
        // read again as unquoted (unterminated_quote).
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        const r = readUnquoted(open + 1, '"', openLine);
        return [r[0], r[1], r[2], r[3]];
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote; the field goes on.
        const seg = text.slice(p, q);
        if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
          value += seg;
        } else {
          const parts = seg.split(/\r\n?|\n/);
          l += parts.length - 1;
          value += parts.join('\n');
        }
        value += '"';
        p = q + 2;
        continue;
      }
      // The closing quote.
      const seg = text.slice(p, q);
      if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
        value += seg;
      } else {
        const parts = seg.split(/\r\n?|\n/);
        l += parts.length - 1;
        value += parts.join('\n');
      }
      const after = q + 1;
      if (after >= n) return [value, 2, n, l];
      const c = text.charCodeAt(after);
      if (c === 44) return [value, 0, after + 1, l];
      if (c === 10) return [value, 1, after + 1, l + 1];
      if (c === 13 && after + 1 < n && text.charCodeAt(after + 1) === 10) {
        return [value, 1, after + 2, l + 1];
      }
      // What follows the closing quote is appended as it stands, up to the next
      // comma or line break (quote_junk, when the field ends and anything was added).
      const r = readUnquoted(after, value, l);
      if (r[4] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return [r[0], r[1], r[2], r[3]];
    }
  };

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended = 0;
    do {
      let value;
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const r = readQuoted(pos, line);
        value = r[0];
        ended = r[1];
        pos = r[2];
        line = r[3];
      } else {
        quoted = false;
        // Unquoted field: scan to the next comma or line break, then slice it out.
        let j = pos;
        while (j < n) {
          const c = text.charCodeAt(j);
          if (c === 44 || c === 10 || c === 13) break;
          j++;
        }
        if (j >= n) {
          value = text.slice(pos, n);
          pos = n;
          ended = 2;
        } else {
          const c = text.charCodeAt(j);
          if (c === 44) {
            value = text.slice(pos, j);
            pos = j + 1;
            ended = 0;
          } else if (c === 10) {
            value = text.slice(pos, j);
            pos = j + 1;
            line++;
            ended = 1;
          } else if (j + 1 < n && text.charCodeAt(j + 1) === 10) {
            value = text.slice(pos, j);
            pos = j + 2;
            line++;
            ended = 1;
          } else {
            // A stray CR inside the field: drop it (stray_cr) and keep reading.
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            const r = readUnquoted(j + 1, text.slice(pos, j), line);
            value = r[0];
            ended = r[1];
            pos = r[2];
            line = r[3];
          }
        }
      }
      fields.push(value);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
