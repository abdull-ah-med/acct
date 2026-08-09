/**
 * Validate profile fields before they are written into gitconfig includes.
 * Newlines / quotes / backslashes enable INI section breakout (credential.helper, core.sshCommand).
 */

const MAX_LEN = 256;
const UNSAFE_CHARS = /[\r\n\0\\"]/;

const HOST_RE =
  /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/;
const USER_RE = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;
const EMAIL_RE = /^[^\s@\r\n\0\\"]+@[^\s@\r\n\0\\"]+\.[^\s@\r\n\0\\"]+$/;

function assertNoUnsafeChars(label: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`Invalid ${label}: must not be empty`);
  }
  if (value.length > MAX_LEN) {
    throw new Error(`Invalid ${label}: exceeds ${MAX_LEN} characters`);
  }
  if (UNSAFE_CHARS.test(value)) {
    throw new Error(
      `Invalid ${label}: must not contain CR, LF, NUL, backslash, or double-quote`,
    );
  }
}

export function assertSafeProfileName(name: string): void {
  assertNoUnsafeChars("name", name);
}

export function assertSafeProfileEmail(email: string): void {
  assertNoUnsafeChars("email", email);
  if (!EMAIL_RE.test(email)) {
    throw new Error(`Invalid email: ${JSON.stringify(email)}`);
  }
}

export function assertSafeProfileHost(host: string): void {
  assertNoUnsafeChars("host", host);
  if (!HOST_RE.test(host)) {
    throw new Error(
      `Invalid host: ${JSON.stringify(host)} (expected hostname or hostname:port)`,
    );
  }
}

export function assertSafeGithubUser(user: string): void {
  assertNoUnsafeChars("user", user);
  if (!USER_RE.test(user) || user.length > 39) {
    throw new Error(
      `Invalid GitHub username: ${JSON.stringify(user)} (letters, digits, hyphens; max 39)`,
    );
  }
}

export function assertSafeProfileFields(opts: {
  name: string;
  email: string;
  host: string;
  user: string;
}): void {
  assertSafeProfileName(opts.name);
  assertSafeProfileEmail(opts.email);
  assertSafeProfileHost(opts.host);
  assertSafeGithubUser(opts.user);
}
