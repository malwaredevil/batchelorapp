/**
 * Helpers for detecting ephemeral location state from user messages.
 * Extracted so they can be unit-tested without importing the full index.ts.
 */

/**
 * Returns the place name the user stated they are currently at, or null when
 * no location statement is found. Used to persist ephemeral session-level
 * location state so the user doesn't have to repeat themselves across turns.
 */
export function detectStatedLocation(message: string): string | null {
  // Patterns: verb phrase + preposition + place name.
  // Captures everything after the preposition up to punctuation or end-of-string.
  const patterns = [
    // "I'm in/at X", "I am in/at X"
    /\b(?:i['\u2019]?m|i\s+am)\s+(?:in|at)\s+(.+?)(?:[.!?,]|$)/i,
    // "we're in/at X", "we are in/at X"
    /\b(?:we['\u2019]?re|we\s+are)\s+(?:in|at)\s+(.+?)(?:[.!?,]|$)/i,
    // "just arrived in/at X"
    /\bjust\s+arrived\s+(?:in|at)\s+(.+?)(?:[.!?,]|$)/i,
    // "just got to X"
    /\bjust\s+got\s+to\s+(.+?)(?:[.!?,]|$)/i,
    // "currently in/at X"
    /\bcurrently\s+(?:in|at)\s+(.+?)(?:[.!?,]|$)/i,
    // "visiting X"
    /\bvisiting\s+(.+?)(?:[.!?,]|$)/i,
    // "staying in/at X"
    /\bstaying\s+(?:in|at)\s+(.+?)(?:[.!?,]|$)/i,
    // "I've arrived in/at X"
    /\bi['\u2019]?ve\s+arrived\s+(?:in|at)\s+(.+?)(?:[.!?,]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const place = match[1].trim().slice(0, 120);
      // Reject matches that are suspiciously short (< 2 chars) or contain
      // placeholder-like tokens — they're unlikely to be real place names.
      if (place.length >= 2 && !/^\s*$/.test(place)) return place;
    }
  }
  return null;
}

/**
 * Returns true when the user's message signals they want to clear (forget)
 * their current stated location — e.g. "I've left Gion", "I left Gion",
 * "I'm back home", "never mind the location", or "forget my location".
 * A clear takes priority over any incidental location phrase in the same message.
 */
export function detectLocationClear(message: string): boolean {
  const patterns = [
    // "I've left [place]", "I left [place]"
    /\bi(?:['\u2019]?ve)?\s+left\b/i,
    // "I'm back home", "we're back home"
    /\b(?:i['\u2019]?m|we['\u2019]?re|i\s+am|we\s+are)\s+back\s+home\b/i,
    // "never mind the location", "never mind my location"
    /\bnever\s+mind\s+(?:the|my)\s+location\b/i,
    // "forget my location", "forget the location"
    /\bforget\s+(?:my|the)\s+location\b/i,
    // "clear my location", "clear the location"
    /\bclear\s+(?:my|the)\s+location\b/i,
    // "ignore my location", "ignore the location"
    /\bignore\s+(?:my|the)\s+location\b/i,
    // "I'm not in [place] anymore", "I'm no longer in [place]"
    /\bi['\u2019]?m\s+(?:not\s+in|no\s+longer\s+in)\b/i,
    // "we're not in [place] anymore", "we're no longer in [place]"
    /\bwe['\u2019]?re\s+(?:not\s+in|no\s+longer\s+in)\b/i,
    // "I'm not there anymore", "not there anymore"
    /\bnot\s+there\s+anymore\b/i,
    // "heading home", "on my way home", "going home"
    /\b(?:heading|going|on\s+my\s+way)\s+home\b/i,
  ];
  return patterns.some((p) => p.test(message));
}
