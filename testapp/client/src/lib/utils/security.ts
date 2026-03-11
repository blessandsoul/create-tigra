export const isSafeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
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
