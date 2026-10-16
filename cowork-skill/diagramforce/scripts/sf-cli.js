// sf-cli.js - run the Salesforce CLI from the skill's scripts the same way on every OS, say why it failed, and read
// the scripts' input files whatever encoding Windows saved them in.
//
// Skill-only (no app twin). runSf is shared by flow-, mappings-, roles- and datagraph-to-diagramforce.mjs, readText by
// every CLI that reads a user's file. A .js file, not .mjs, because skill-cli-paths.test.js runs every .mjs as a CLI.
//
// WINDOWS. `sf` there is `sf.cmd`, a batch file. execFileSync('sf') cannot start it: libuv's PATH search tries only
// .com and .exe (ENOENT), and since the CVE-2024-27980 fix Node refuses a .cmd without a shell (EINVAL). Every
// `--org` enrichment was lost, and the flow script told the user to re-authenticate. So on win32 the command runs
// through cmd.exe with each argument double-quoted: the arguments are SOQL, REST paths and aliases, whose spaces,
// single quotes, parentheses, `&` and `=` are all literal inside double quotes. Elsewhere it stays execFileSync,
// with no shell at all.
//   Double quotes do not protect two things from cmd.exe. A `"` inside an argument: cmd ignores the backslash in
// `\"` and toggles its quote state, so `&`, `|`, `<` and `>` after it run as operators. winCommand() refuses such an
// argument, and a line break, rather than trust the escape. And `%NAME%`: cmd expands it, quoted or not, when a
// variable NAME exists, and has no escape for `%` inside quotes. No argument should hit that: SOQL here has no
// LIKE, and a percent-encoded REST path (`%2F`) matches only a variable named like `2Fx`.
//
// THE REASON. `sf ... --json` and `sf api request rest` write their error to STDOUT (`{"message": ...}` or
// `[{"errorCode": ..., "message": ...}]`), and stderr holds the update banner, so the thrown message alone lost
// it. sfError() prefers the API's own words, then sf's stderr without the banner.
//
// THE FILES. Every CLI reads its input through readText(): a file saved by Notepad or PowerShell 5.1's Out-File
// starts with a UTF-8 BOM, and PowerShell 5.1's `>` writes UTF-16LE with a BOM. Read as 'utf8', JSON.parse failed on
// both, while the app's File route (Blob.text()) opened the same file (review 2026-10-15, S7-7).
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** A text file (or fd 0) as a string: UTF-16 LE or BE when it opens with that byte-order mark, else UTF-8, with any
 *  leading U+FEFF removed. */
export function readText(path) {
  const buf = readFileSync(path);
  let text;
  if (buf[0] === 0xFF && buf[1] === 0xFE) text = buf.subarray(2).toString('utf16le');
  else if (buf[0] === 0xFE && buf[1] === 0xFF) text = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1))).swap16().toString('utf16le');
  else text = buf.toString('utf8');
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/** One argument for cmd.exe and the argv parser node.exe uses: double quotes, with backslashes before a quote
 *  doubled and the quote escaped. */
export const winQuote = (a) => `"${String(a).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;

/** The cmd.exe line for `sf <args>`. Throws for an argument holding a double quote or a line break, which cmd.exe
 *  does not keep inside the quotes (see the header). */
export function winCommand(args) {
  const bad = args.find((a) => /["\r\n]/.test(String(a)));
  if (bad !== undefined) {
    throw new Error(`cannot run sf on Windows with an argument that holds a double quote or a line break: ${JSON.stringify(String(bad))}`);
  }
  return `sf ${args.map(winQuote).join(' ')}`;
}

/** The one line worth relaying when an `sf` call fails. */
export function sfError(e) {
  // ENOENT: no `sf` on PATH. 9009: cmd.exe's "is not recognized as an internal or external command".
  if (e?.code === 'ENOENT' || e?.status === 9009) return 'the Salesforce CLI (sf) is not on PATH';
  let api = null;
  try { api = [].concat(JSON.parse(String(e?.stdout || '')))[0]; } catch { /* not JSON */ }
  if (api?.message) return api.errorCode ? `${api.errorCode}: ${api.message}` : api.message;
  const err = String(e?.stderr || '').split('\n').filter((l) => l.trim() && !/update available/i.test(l)).join(' ').trim();
  return err || e?.message || String(e);
}

/** Run `sf <args>` and return its stdout. Throws an Error whose message is sfError()'s line. stderr is piped, never
 *  inherited, so the CLI's update banner stays out of the caller's report. */
export function runSf(args, { maxBuffer = 32 * 1024 * 1024 } = {}) {
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer };
  const line = process.platform === 'win32' ? winCommand(args) : null;   // throws before anything runs
  try {
    return line ? execSync(line, opts) : execFileSync('sf', args, opts);
  } catch (e) {
    throw new Error(sfError(e));
  }
}
