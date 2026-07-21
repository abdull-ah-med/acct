/**
 * Git credential helper protocol.
 * Spec: https://git-scm.com/docs/git-credential
 */

export type CredentialAttrs = Record<string, string>;

export function parseCredentialInput(text: string): CredentialAttrs {
  const attrs: CredentialAttrs = {};
  for (const line of text.split(/\r?\n/)) {
    if (line === "") break;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    attrs[key] = value;
  }
  if (attrs.url && !attrs.protocol) {
    try {
      const u = new URL(attrs.url);
      attrs.protocol = u.protocol.replace(/:$/, "");
      attrs.host = u.host;
      if (u.pathname && u.pathname !== "/") {
        attrs.path = u.pathname.replace(/^\//, "");
      }
      if (u.username) attrs.username = decodeURIComponent(u.username);
    } catch {
      // ignore malformed url attr
    }
  }
  return attrs;
}

export function formatCredentialOutput(attrs: CredentialAttrs): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}=${v}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "") + "\n";
}

/** Reject empty/malicious hosts (CVE-2020-11008 class). */
export function isSafeHost(host: string | undefined): boolean {
  if (!host || !host.trim()) return false;
  if (/[\r\n\0]/.test(host)) return false;
  if (/%0[ad]/i.test(host)) return false; // encoded CR/LF
  if (host.includes("@")) return false;
  if (/\s/.test(host)) return false;
  return true;
}

export function hostAllowed(
  requestedHost: string,
  profileHost: string,
): boolean {
  const a = requestedHost.toLowerCase();
  const b = profileHost.toLowerCase();
  if (a === b) return true;
  // strip port for comparison if profile has none
  const aHost = a.split(":")[0]!;
  const bHost = b.split(":")[0]!;
  return aHost === bHost;
}
