export const isSafeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

// Placeholder origin used only to parse relative paths. It never appears in
// output and `.invalid` can never resolve, so nothing here can point at it.
const REDIRECT_PARSE_BASE = 'https://redirect-check.invalid';

/**
 * Turn an untrusted "where to go next" value (e.g. `?from=` on /login) into a
 * same-site path, or undefined when it isn't one.
 *
 * A prefix check like `startsWith('/') && !startsWith('//')` is NOT enough:
 * browsers treat `\` like `/` and silently drop tabs and newlines, so
 * `/\evil.com` and `/<TAB>/evil.com` both become `//evil.com` — another site.
 * The value is therefore parsed exactly like the browser will, and accepted
 * only if it stays on our origin; we then return just path + query + hash.
 */
export const getSafeRedirectPath = (value: string | null | undefined): string | undefined => {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return undefined;
  // Backslashes, control characters and whitespace have no place in an
  // internal path and are exactly what the bypasses rely on.
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return undefined;

  try {
    const url = new URL(value, REDIRECT_PARSE_BASE);
    if (url.origin !== REDIRECT_PARSE_BASE) return undefined;
    const path = `${url.pathname}${url.search}${url.hash}`;
    // Check the RESULT, not only the input: dot segments normalize away, so
    // '/..//evil.com' or '/%2e%2e//evil.com' come out as '//evil.com', which
    // the router would treat as another site. The path we return must itself
    // resolve back to our origin.
    if (path.startsWith('//') || new URL(path, REDIRECT_PARSE_BASE).origin !== REDIRECT_PARSE_BASE) {
      return undefined;
    }
    return path;
  } catch {
    return undefined;
  }
};

export const sanitizeString = (input: string): string => {
  return input
    .trim()
    .replace(/[<>&"']/g, (char) => {
      const entities: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[char] ?? char;
    })
    .slice(0, 1000);
};

export const sanitizeEmail = (email: string): string => {
  return email.toLowerCase().trim().slice(0, 255);
};

export const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
};
