const PROFILE_REFRESH_MS = 7 * 24 * 60 * 60_000;

export type InstagramProfileState = { username: string | null; profileCheckedAt: string | null };
export type InstagramProfileRepository = {
  get: (externalUserId: string) => Promise<InstagramProfileState>;
  saveUsername: (externalUserId: string, username: string, checkedAt: string) => Promise<void>;
  markChecked: (externalUserId: string, checkedAt: string) => Promise<void>;
};

export function profileNeedsRefresh(profile: InstagramProfileState, now = Date.now()) {
  if (!profile.username) return true;
  const checkedAt = profile.profileCheckedAt ? Date.parse(profile.profileCheckedAt) : Number.NaN;
  return !Number.isFinite(checkedAt) || now - checkedAt > PROFILE_REFRESH_MS;
}

export async function refreshInstagramUsername({ repository, externalUserId, fetchUsername, now = new Date() }: {
  repository: InstagramProfileRepository;
  externalUserId: string;
  fetchUsername: (externalUserId: string) => Promise<string>;
  now?: Date;
}) {
  const profile = await repository.get(externalUserId);
  if (!profileNeedsRefresh(profile, now.getTime())) return { status: "fresh" as const, username: profile.username };
  const checkedAt = now.toISOString();
  try {
    const username = await fetchUsername(externalUserId);
    await repository.saveUsername(externalUserId, username, checkedAt);
    return { status: "updated" as const, username };
  } catch (error) {
    let checkedAtPersisted = true;
    try { await repository.markChecked(externalUserId, checkedAt); } catch { checkedAtPersisted = false; }
    return { status: "failed" as const, username: profile.username, error, checkedAtPersisted };
  }
}
