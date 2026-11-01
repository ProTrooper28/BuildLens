import type { User } from "@supabase/supabase-js";

import { getSupabase } from "@/lib/supabase";
import type { AccountType, Profile, ProfileInsert, ProfileUpdate } from "@/types/database";
import { toAuthMessage } from "@/utils/errors";

/** Build a `profiles` insert from a freshly-created Supabase user. */
export function buildProfileInsert(user: User): ProfileInsert {
  const meta: Record<string, unknown> = user.user_metadata ?? {};
  const str = (key: string): string | null =>
    typeof meta[key] === "string" ? (meta[key] as string) : null;

  // Defensive rebuild: only include fields present in auth metadata so we never
  // assume a specific profiles schema beyond the columns we intend to seed.
  const insert: ProfileInsert = {
    id: user.id,
    full_name: str("full_name"),
    username: str("username"),
    organization: str("organization"),
    avatar_url: str("avatar_url"),
  };

  // `profiles.account_type` is the role source the judging policies read
  // (`public.is_buildlens_judge`), so the role chosen at sign-up has to land
  // here as well as in the auth metadata — otherwise no account could ever pass
  // a judge-only policy.
  insert.account_type = accountTypeFor(user);

  return insert;
}

/** The `profiles.account_type` a user's chosen role implies. */
function accountTypeFor(user: User): AccountType {
  return user.user_metadata?.["role"] === "manager" ? "Judge" : "Developer";
}

/**
 * Raise an existing profile to Judge when the account signed up as a manager.
 *
 * Only ever upgrades: a role picked in the UI must not demote an account an
 * organizer promoted in the database.
 */
async function syncAccountType(profile: Profile, user: User): Promise<Profile> {
  if (accountTypeFor(user) !== "Judge" || profile.account_type === "Judge") return profile;
  try {
    return await updateProfile(profile.id, { account_type: "Judge" });
  } catch {
    // The row is still usable; the judging policies will simply keep refusing.
    return profile;
  }
}

/** Fetch a profile row by user id, or `null` when missing. */
export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(toAuthMessage(error));
  return data;
}

/**
 * Ensure a profile row exists for the user, creating it from auth metadata when
 * missing.
 *
 * A DB trigger (`handle_new_user`) normally creates the row at signup; this is a
 * client-side fallback that also tolerates the race where the trigger wins first
 * (a unique violation just re-fetches the existing row).
 */
export async function ensureProfile(user: User): Promise<Profile | null> {
  const existing = await getProfile(user.id);
  if (existing) return syncAccountType(existing, user);

  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from("profiles")
      .insert(buildProfileInsert(user))
      .select("*")
      .maybeSingle();

    if (error) {
      // If the insert failed because the row now exists (e.g. trigger won the
      // race), re-fetch. Otherwise surface the error.
      if (error.code === "23505" || error.message?.toLowerCase().includes("duplicate")) {
        return getProfile(user.id);
      }
      throw error;
    }

    const created = data ?? (await getProfile(user.id));
    return created ? syncAccountType(created, user) : null;
  } catch (error) {
    // Be conservative: if anything goes wrong during the defensive upsert, fall
    // back to a normal fetch so the app can still render the profile when it
    // already exists.
    return getProfile(user.id);
  }
}

/** Update a profile row and return the updated record. */
export async function updateProfile(userId: string, patch: ProfileUpdate): Promise<Profile> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(toAuthMessage(error));
  if (!data) throw new Error("Profile not found.");
  return data;
}
