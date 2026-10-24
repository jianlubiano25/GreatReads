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
  constructor(public url: string) { FakeWebSocket.last = this; FakeWebSocket.all.push(this); }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  static last?: FakeWebSocket;
  static all: FakeWebSocket[] = [];
}
(globalThis as any).window = new EventTarget();
(globalThis as any).document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { onLine: true } });
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

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const joinOf = (socket: FakeWebSocket) => JSON.parse(socket.sent[0]);
const reply = (socket: FakeWebSocket, status: string) => socket.onmessage?.({ data: JSON.stringify([null, '1', joinOf(socket)[2], 'phx_reply', { status, response: {} }]) });

test('the cloud confirming the subscription is announced (so missed changes are read); a refusal reconnects instead of staying silent', async () => {
  FakeWebSocket.all.length = 0; let connected = 0;
  const stop = subscribeLibraryRealtime('user-a', () => {}, () => { connected++; }, { retryBaseMs: 5 });
  await wait(5); const first = FakeWebSocket.all[0]; first.onopen?.();
  reply(first, 'ok'); assert.equal(connected, 1);
  const before = FakeWebSocket.all.length;
  reply(first, 'error'); // refused: the socket is dropped and a new one is made after a short gap
  await wait(40);
  assert.equal(FakeWebSocket.all.length, before + 1, 'one new socket');
  const second = FakeWebSocket.all[before]; second.onopen?.(); reply(second, 'ok'); assert.equal(connected, 2, 'announced again after reconnecting');
  stop();
});

test('one failed socket reports both an error and a close, and still makes exactly one new socket', async () => {
  FakeWebSocket.all.length = 0;
  const stop = subscribeLibraryRealtime('user-a', () => {}, undefined, { retryBaseMs: 5 });
  await wait(5); const first = FakeWebSocket.all[0]; first.onopen?.();
  first.readyState = 3; first.onerror?.(); first.onclose?.();
  await wait(60);
  assert.equal(FakeWebSocket.all.length, 2, `sockets made: ${FakeWebSocket.all.length}`);
  stop();
});

test('nothing reconnects while offline; coming back online reconnects at once, and a live socket is never doubled', async () => {
  FakeWebSocket.all.length = 0;
  const stop = subscribeLibraryRealtime('user-a', () => {}, undefined, { retryBaseMs: 5 });
  await wait(5); const first = FakeWebSocket.all[0]; first.onopen?.();
  (globalThis as any).navigator.onLine = false; first.readyState = 3; first.onclose?.();
  await wait(60); assert.equal(FakeWebSocket.all.length, 1, 'no attempt while offline');
  (globalThis as any).navigator.onLine = true; (globalThis as any).window.dispatchEvent(new Event('online'));
  await wait(5); assert.equal(FakeWebSocket.all.length, 2);
  (globalThis as any).window.dispatchEvent(new Event('online')); (globalThis as any).document.dispatchEvent(new Event('visibilitychange'));
  await wait(20); assert.equal(FakeWebSocket.all.length, 2, 'the live socket is left alone');
  stop();
});

test('a "could not subscribe" system message drops the socket so it is retried, not left half-working', async () => {
  FakeWebSocket.all.length = 0;
  const stop = subscribeLibraryRealtime('user-a', () => {}, undefined, { retryBaseMs: 5 });
  await wait(5); const first = FakeWebSocket.all[0]; first.onopen?.();
  first.onmessage?.({ data: JSON.stringify([null, null, joinOf(first)[2], 'system', { status: 'error', message: 'Unable to subscribe to changes' }]) });
  await wait(40); assert.equal(FakeWebSocket.all.length, 2);
  stop();
});
