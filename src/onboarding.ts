import { backend } from "./backend";

export type OnboardingState = {
  onboardingDone: boolean;
};

export async function loadOnboardingState(
  userId: string,
): Promise<OnboardingState> {
  if (!backend) return { onboardingDone: true };
  const { data, error } = await backend
    .from("profiles")
    .select("onboarding_done")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return { onboardingDone: data.onboarding_done === true };
}

export async function saveOnboardingDone(userId: string) {
  if (!backend) return;
  const { error } = await backend
    .from("profiles")
    .update({ onboarding_done: true })
    .eq("id", userId);
  if (error) throw error;
}
