/**
 * Git credential helper protocol.
 * Spec: https://git-scm.com/docs/git-credential
 *
 * Port / conflict policy cites:
 * docs/research/host-port-local-acct-cites-2026-08-08.md
 */

export type CredentialAttrs = Record<string, string>;

/** HTTPS default port — only non-pinned profiles may accept this explicit port. */
export const DEFAULT_HTTPS_PORT = "443";

const SINGULAR_KEYS = new Set(["protocol", "host", "path", "username", "password"]);

/**
 * Split `host` / `host:port` / `[ipv6]:port` per git-credential host attribute.
 * Cite: https://git-scm.com/docs/git-credential — host includes port when specified.
 */
export function splitHostPort(host: string): {
  hostname: string;
  port?: string;
} {
  const trimmed = host.trim();
  if (!trimmed) return { hostname: "" };

  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end > 0) {
      const hostname = trimmed.slice(0, end + 1);
      const rest = trimmed.slice(end + 1);
      if (rest.startsWith(":") && /^\d+$/.test(rest.slice(1))) {
        return { hostname, port: rest.slice(1) };
      }
      return { hostname };
    }
  }

  const idx = trimmed.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(trimmed.slice(idx + 1))) {
    return {
      hostname: trimmed.slice(0, idx),
      port: trimmed.slice(idx + 1),
    };
  }
  return { hostname: trimmed };
}

export function parseCredentialInput(text: string): CredentialAttrs {
  const attrs: CredentialAttrs = {};
  let conflict = false;

  for (const line of text.split(/\r?\n/)) {
    if (line === "") break;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);

    // Values must not contain NUL; treat bare CR as unsafe (CVE-2020-11008 class).
    // Cite: https://git-scm.com/docs/git-credential (no newline/NUL in values)
    if (/[\0\r]/.test(value) || /[\0\r]/.test(key)) {
      conflict = true;
      continue;
    }

    if (
      SINGULAR_KEYS.has(key) &&
      attrs[key] !== undefined &&
      attrs[key] !== value
    ) {
      // Last-wins would let host=evil\\nhost=github.com steal tokens.
      conflict = true;
      continue;
    }

    // Multi-valued keys (capability[], wwwauth[], state[]) append; we keep last
    // for unrecognized keys — sufficient for acct's HTTPS get path.
    attrs[key] = value;
  }

  if (attrs.url) {
    try {
      const u = new URL(attrs.url);
      const urlProtocol = u.protocol.replace(/:$/, "");
      // URL.host includes port when specified (same shape as credential host).
      const urlHost = u.host;

      if (attrs.protocol && attrs.protocol !== urlProtocol) {
        conflict = true;
      }
      if (
        attrs.host &&
        attrs.host.toLowerCase() !== urlHost.toLowerCase()
      ) {
        conflict = true;
      }

      if (!conflict) {
        if (!attrs.protocol) attrs.protocol = urlProtocol;
        if (!attrs.host) attrs.host = urlHost;
        if (u.pathname && u.pathname !== "/" && !attrs.path) {
          attrs.path = u.pathname.replace(/^\//, "");
        }
        if (u.username && !attrs.username) {
          attrs.username = decodeURIComponent(u.username);
        }
      }
    } catch {
      // ignore malformed url attr
    }
  }

  if (conflict) {
    // Force isSafeHost / hostAllowed failure — never return a token.
    attrs.host = "";
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

/**
 * Whether the requested credential host may receive this profile's token.
 *
 * - Hostname must match (case-insensitive).
 * - If profile.host pins a port (GHE), request must use that exact port.
 * - If profile.host is hostname-only, allow bare host or `:443` only.
 *
 * Cite: https://git-scm.com/docs/git-credential (host may include port);
 * docs/research/host-port-local-acct-cites-2026-08-08.md
 */
export function hostAllowed(
  requestedHost: string,
  profileHost: string,
): boolean {
  const req = splitHostPort(requestedHost);
  const prof = splitHostPort(profileHost);
  if (!req.hostname || !prof.hostname) return false;
  if (req.hostname.toLowerCase() !== prof.hostname.toLowerCase()) return false;

  if (prof.port !== undefined) {
    return req.port === prof.port;
  }
  // Hostname-only profile (e.g. github.com): default HTTPS port only.
  return req.port === undefined || req.port === DEFAULT_HTTPS_PORT;
}
