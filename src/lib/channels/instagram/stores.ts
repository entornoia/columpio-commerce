import type { InstagramConversation, InstagramEventLog } from "./types";

const MAX_CHANNEL_MESSAGES = 12;

type Expiring<T> = { value: T; expiresAt: number };

export class IdempotencyStore {
  private readonly entries = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  constructor(ttlMs = 24 * 60 * 60_000, maxEntries = 5_000) { this.ttlMs = ttlMs; this.maxEntries = maxEntries; }
  claim(id: string, now = Date.now()) {
    this.sweep(now);
    if ((this.entries.get(id) ?? 0) > now) return false;
    this.entries.set(id, now + this.ttlMs);
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    return true;
  }
  release(id: string) { this.entries.delete(id); }
  private sweep(now: number) { for (const [key, expiresAt] of this.entries) if (expiresAt <= now) this.entries.delete(key); }
}

export class ConversationStore {
  private readonly entries = new Map<string, Expiring<InstagramConversation>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  constructor(ttlMs = 30 * 60_000, maxEntries = 500) { this.ttlMs = ttlMs; this.maxEntries = maxEntries; }
  get(userId: string, now = Date.now()): InstagramConversation {
    this.sweep(now);
    const current = this.entries.get(userId);
    return current ? structuredClone(current.value) : { messages: [], garmentAnalysis: null, needsHuman: false };
  }
  set(userId: string, conversation: InstagramConversation, now = Date.now()) {
    this.sweep(now);
    this.entries.set(userId, { value: { ...conversation, messages: conversation.messages.slice(-MAX_CHANNEL_MESSAGES) }, expiresAt: now + this.ttlMs });
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
  }
  private sweep(now: number) { for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key); }
}

class EventStore {
  private readonly events: InstagramEventLog[] = [];
  add(event: InstagramEventLog) { this.events.unshift(event); this.events.splice(100); }
  recent(limit = 25) { return this.events.slice(0, Math.min(limit, 100)); }
}

const globalStores = globalThis as typeof globalThis & { __instagramIdempotency?: IdempotencyStore; __instagramConversations?: ConversationStore; __instagramEvents?: EventStore };
export const instagramIdempotency = globalStores.__instagramIdempotency ??= new IdempotencyStore();
export const instagramConversations = globalStores.__instagramConversations ??= new ConversationStore();
export const instagramEvents = globalStores.__instagramEvents ??= new EventStore();
