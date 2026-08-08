/**
 * Recovery questions, in their own module so client components can import them
 * without pulling in `server/auth.ts` — which imports `next/headers` and cannot
 * run in the browser.
 *
 * Chosen for answers that stay stable over decades and are unlikely to sit on a
 * public profile: "first school" and "favourite teacher" beat "mother's maiden
 * name", which is often a matter of public record.
 */
export const RECOVERY_QUESTIONS = [
  "What was the name of your first pet?",
  "What was the name of your first school?",
  "What is your favourite book?",
  "What street did you live on as a child?",
  "What was your favourite teacher's name?",
  "What is a food you disliked as a child?",
] as const;

export type RecoveryQuestion = (typeof RECOVERY_QUESTIONS)[number];
