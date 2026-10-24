import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) };
values.set('readlife.sb1', JSON.stringify({ access: 'valid-token', refresh: 'refresh-token', exp: Date.now() + 60_000_000, user: { id: 'user-a' } }));

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  sent: string[] = [];
  constructor(public url: string) { FakeWebSocket.last = this; }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  static last?: FakeWebSocket;
}
(globalThis as any).WebSocket = FakeWebSocket;
const { subscribeLibraryRealtime } = await import('./supabase');

test('Realtime subscribes only to this user’s personal tables and forwards table changes', async () => {
  const changed: string[] = [];
  const stop = subscribeLibraryRealtime('user-a', table => changed.push(table));
  await new Promise(resolve => setTimeout(resolve, 0));
  const socket = FakeWebSocket.last!;
  assert.match(socket.url, /realtime\/v1\/websocket/);
  socket.onopen?.();
  const join = JSON.parse(socket.sent[0]);
  assert.equal(join[4].access_token, 'valid-token');
  assert.ok(join[4].config.postgres_changes.every((change: any) => change.filter === 'user_id=eq.user-a'));
  socket.onmessage?.({ data: JSON.stringify([null, '2', join[2], 'postgres_changes', { data: { table: 'user_library_books' } }]) });
  socket.onmessage?.({ data: JSON.stringify([null, '3', join[2], 'postgres_changes', { data: { table: 'catalog_works' } }]) });
  assert.deepEqual(changed, ['user_library_books']);
  stop();
});
