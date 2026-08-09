/**
 * Escape a path for embedding in a Windows .cmd script under double quotes.
 * `%` → `%%` (prevents env expansion); `"` → `""`.
 * Cite: https://ss64.com/nt/syntax-esc.html
 */
export function cmdEscapePath(s: string): string {
  return s.replace(/%/g, "%%").replace(/"/g, '""');
}

/**
 * Render `node "path" %*` style .cmd body with safe path quoting.
 */
export function renderCmdNodeInvoke(nodePath: string, scriptPath: string, extraArgs = "%*"): string {
  const node = cmdEscapePath(nodePath);
  const script = cmdEscapePath(scriptPath);
  return `@echo off\r\n"${node}" "${script}" ${extraArgs}\r\n`;
}
