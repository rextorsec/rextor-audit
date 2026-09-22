/** Receipt-link register — mono, primary, dotted underline on hover. One
 *  definition so landing surfaces can't drift (review 2026-09-22: the string
 *  was duplicated byte-identical in tour/faq/tracks + inline in hero). */
export const receiptLink =
  "font-mono text-sm no-underline whitespace-nowrap text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]";

/** Dense variant — matrix cells and other text-xs contexts. */
export const receiptLinkXs =
  "font-mono text-xs no-underline whitespace-nowrap text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]";
