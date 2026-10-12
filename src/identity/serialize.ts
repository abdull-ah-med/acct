/** Git's outer config syntax, independent of any inner shell quoting.
 * https://git-scm.com/docs/git-config#_syntax
 */
export function gitConfigValue(value: string): string {
  if(/[\n\r\0]/.test(value)) throw new Error("Git config value contains LF, CR or NUL");
  return '"' + value.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\t/g,"\\t") + '"';
}
export function gitConfigSubsection(value: string): string {
  if(/[\n\0]/.test(value)) throw new Error("Git config subsection contains LF or NUL");
  return '"' + value.replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"';
}
