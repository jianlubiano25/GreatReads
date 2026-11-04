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
  assert.match(socket.url, /vsn=2\.0\.0/, 'array messages are serializer 2.0.0; 1.0.0 makes the server reject every join');
  socket.onopen?.();
  const join = JSON.parse(socket.sent[0]);
  assert.equal(join[0], '1', 'join_ref');
  assert.equal(join[3], 'phx_join');
  assert.equal(join[4].access_token, 'valid-token');
  assert.ok(join[4].config.postgres_changes.every((change: any) => change.filter === 'user_id=eq.user-a'));
  socket.onmessage?.({ data: JSON.stringify([null, '2', join[2], 'postgres_changes', { data: { table: 'user_library_books' } }]) });
  socket.onmessage?.({ data: JSON.stringify([null, '3', join[2], 'postgres_changes', { data: { table: 'catalog_works' } }]) });
  assert.deepEqual(changed, ['user_library_books']);
  stop();
});

test('Realtime forwards daily-page changes and asks for one catch-up pull after a reconnect, not on the first connect', async () => {
  const changed: string[] = [];
  const stop = subscribeLibraryRealtime('user-a', table => changed.push(table));
  await new Promise(resolve => setTimeout(resolve, 0));
  const first = FakeWebSocket.last!;
  first.onopen?.();
  assert.deepEqual(changed, [], 'no resync on the first connect (the app bootstraps itself)');
  const join = JSON.parse(first.sent[0]);
  assert.ok(join[4].config.postgres_changes.some((change: any) => change.table === 'user_daily_pages'));
  first.onmessage?.({ data: JSON.stringify([null, '2', join[2], 'postgres_changes', { data: { table: 'user_daily_pages' } }]) });
  assert.deepEqual(changed, ['user_daily_pages']);
  first.onclose?.(); // the connection drops (phone asleep, network gone) ...
  await new Promise(resolve => setTimeout(resolve, 1200));
  const second = FakeWebSocket.last!;
  assert.notEqual(second, first, 'it reconnects by itself');
  second.onopen?.();
  assert.deepEqual(changed, ['user_daily_pages', 'resync'], 'and pulls what it missed');
  stop();
});
