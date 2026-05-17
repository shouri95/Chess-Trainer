export type StoredProfile = {
  username?: string;
  months?: number;
  gameLimit?: number;
  timeClass?: "all" | "rapid" | "blitz" | "bullet" | "daily";
};

export function isPlaceholderUsername(value: string) {
  return ["you", "sample", "coach"].includes(value.trim().toLowerCase());
}

export function normalizeStoredProfile(profile: StoredProfile | null | undefined): StoredProfile {
  if (!profile) return {};
  return {
    username: profile.username && !isPlaceholderUsername(profile.username) ? profile.username : undefined,
    months: profile.months ? Math.min(Math.max(profile.months, 1), 12) : undefined,
    gameLimit: profile.gameLimit ? Math.min(Math.max(profile.gameLimit, 25), 500) : undefined,
    timeClass: profile.timeClass,
  };
}

export function shouldAutoSyncProfile(username: string, loading: boolean) {
  return Boolean(username.trim()) && !isPlaceholderUsername(username) && !loading;
}
