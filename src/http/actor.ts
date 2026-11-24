import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is really acting in this request. A secretary works in a doctor's dashboard as that doctor
 * (so every existing permission check and query stays scoped to the doctor), but the audit log
 * records the secretary as the actor, with the doctor alongside.
 */
interface ActorStore {
  assistantId?: string;
  doctorId?: string;
}

const store = new AsyncLocalStorage<ActorStore>();

export function runWithActorStore<T>(fn: () => T): T {
  return store.run({}, fn);
}

export function markActingAssistant(assistantId: string, doctorId: string): void {
  const s = store.getStore();
  if (s) {
    s.assistantId = assistantId;
    s.doctorId = doctorId;
  }
}

/** The real actor for an audit entry written "as" the doctor. */
export function realActor(actorId: string | null): { actorId: string | null; onBehalfOf?: string } {
  const s = store.getStore();
  if (s?.assistantId && actorId && actorId === s.doctorId) return { actorId: s.assistantId, onBehalfOf: s.doctorId };
  return { actorId };
}
