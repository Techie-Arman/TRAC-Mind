// ─── Shared Session Storage for Chat & Voice Consistency ─────────────────────
// Keeps the conversation synchronized across /checkin and /buddy-voice

export interface SharedChatMessage {
  id: string;
  role: "user" | "buddy";
  text: string;
  timestamp: string;
  isCrisis?: boolean;
}

const STORAGE_KEY = "trac_buddy_shared_history";

export function loadBuddySession(): SharedChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBuddySession(messages: SharedChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    // Keep last 20 messages to prevent excessive memory usage
    const slice = messages.slice(-20);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(slice));
  } catch (err) {
    console.warn("[BuddySession] Failed to persist session:", err);
  }
}

export function clearBuddySession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}
