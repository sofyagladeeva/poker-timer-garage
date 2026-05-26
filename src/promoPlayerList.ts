// Usernames (lowercase, without @) of players who always get a 50% promo discount.
// When a player from this list is imported from the bot with arrivalStatus 'absent',
// their status is automatically set to 'promo'.
// Manual changes made by the admin during a tournament always take priority.
//
// To update: add or remove usernames below, then redeploy.
const PROMO_USERNAMES_RAW: string[] = [
  // Example: 'username1', 'username2',
];

const PROMO_USERNAMES = new Set(PROMO_USERNAMES_RAW.map(u => u.toLowerCase().replace(/^@/, '')));

export function isPromoUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  return PROMO_USERNAMES.has(username.toLowerCase().replace(/^@/, ''));
}
