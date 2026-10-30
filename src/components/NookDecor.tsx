import React, { useSyncExternalStore } from 'react';
import type { WeatherData } from '../services/weather';
import { ART_TEXT_MAX, cycleClockTheme, getClockTheme, getNookDecor, subscribeClockTheme, subscribeNookDecor, type DecorId, type NookDecor } from '../services/nookPrefs';
import { CLOCK_LOOKS, NookClock, useMinuteTick } from './NookClock';

/** Things that hang on the nook's wall or sit on its garden shelf: a mug, a clock and two framed pictures. What is up, where, and which
 *  version of each is chosen in Achievements & garden and kept in the nook's saved look (see nookPrefs). */

export const useNookDecor = (): NookDecor => useSyncExternalStore(subscribeNookDecor, getNookDecor, getNookDecor);

export const DECOR_LABEL: Record<DecorId, string> = { 'frame-thanks': 'Thank You God frame', clock: 'Clock', 'frame-art': 'Framed artwork', mug: 'Mug' };

/* ---------------- Mug (a few drinks; the steam only moves while the scene is live) ---------------- */
export function Mug({ kind, live }: { kind: NookDecor['mug']; live: boolean }) {
  const drink = kind === 'tea' ? '#c98a3d' : kind === 'cocoa' ? '#6b3f2a' : '#523724';
  const cup = kind === 'tea' ? { body: '#eaf1ea', edge: '#9fb89f' } : kind === 'cocoa' ? { body: '#f6e3e3', edge: '#c9a0a0' } : { body: '#fbf7ee', edge: '#cfbe9f' };
  return (
    <div className="flex flex-col items-center shrink-0 cursor-default select-none" title={kind === 'tea' ? 'A cup of tea' : kind === 'cocoa' ? 'Hot chocolate' : 'A warm cup of coffee'} style={{ marginRight: 4 }}>
      <svg width={30} height={18} viewBox="0 0 30 18" aria-hidden="true">
        {[6, 13, 20].map((x, i) => (
          <path key={i} d={`M${x} 16 q-3 -5 0 -9 q3 -4 0 -7`} stroke="#a89a8a" strokeWidth={1.4} fill="none" strokeLinecap="round" opacity={live ? 0.7 : 0.35} className={live ? `steam-${i}` : undefined} />
        ))}
      </svg>
      <div style={{ width: 30, height: 22, background: cup.body, border: `2px solid ${cup.edge}`, borderRadius: kind === 'tea' ? '2px 2px 14px 14px' : '2px 2px 12px 12px', position: 'relative' }}>
        <div style={{ position: 'absolute', right: -9, top: 3, width: 9, height: 11, border: `2px solid ${cup.edge}`, borderLeft: 0, borderRadius: '0 8px 8px 0' }} />
        <div style={{ margin: '2px 3px', height: 4, background: drink, borderRadius: 4 }} />
        {kind === 'cocoa' && <div style={{ position: 'absolute', left: 6, top: -1, width: 5, height: 4, background: '#fff', borderRadius: 2, boxShadow: '7px 1px 0 #fff' }} />}
      </div>
      {kind === 'tea' && <div style={{ width: 36, height: 3, background: cup.edge, borderRadius: 2, marginTop: -1 }} />}
    </div>
  );
}
/* ---------------- Round clock (the other clock look; the digital one is NookClock) ---------------- */
export function AnalogClock({ weather, large, live }: { weather: WeatherData; large: boolean; live: boolean }) {
  const look = CLOCK_LOOKS[useSyncExternalStore(subscribeClockTheme, getClockTheme, getClockTheme)] ?? CLOCK_LOOKS[0];
  const now = useMinuteTick(live);
  const m = now.getMinutes(), h = (now.getHours() % 12) + m / 60;
  const hand = (deg: number, len: number, w: number) => <line x1={0} y1={0} x2={0} y2={-len} stroke={look.led} strokeWidth={w} strokeLinecap="round" transform={`rotate(${deg})`} />;
  const spoken = `${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}, ${weather.description}`;
  return (
    <button
      type="button"
      onClick={cycleClockTheme}
      className="self-center shrink-0 block p-0 border-0 bg-transparent cursor-pointer"
      style={{ width: large ? 64 : 50, marginTop: 2, marginBottom: 5, filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.35))' }}
      aria-label={`${spoken}. Tap to change the clock colours (${look.name})`}
      title={weather.description}
    >
      <svg viewBox="-24 -24 48 48" width="100%" style={{ display: 'block' }} aria-hidden="true">
        <circle r={23} fill={look.casing} stroke={look.edge} strokeWidth={1.2} />
        <circle r={19.5} fill={look.screen} stroke="#000" strokeOpacity={0.5} />
        {Array.from({ length: 12 }, (_, i) => <line key={i} x1={0} y1={-17} x2={0} y2={i % 3 ? -15.6 : -14.2} stroke={look.led} strokeOpacity={i % 3 ? 0.5 : 0.9} strokeWidth={i % 3 ? 0.8 : 1.3} transform={`rotate(${i * 30})`} />)}
        {hand(h * 30, 9.5, 2)}
        {hand(m * 6, 14, 1.3)}
        <circle r={1.5} fill={look.led} />
      </svg>
    </button>
  );
}

/* ---------------- Frames ---------------- */
function Frame({ large, children, label }: { large: boolean; children: React.ReactNode; label: string }) {
  return (
    <div className="self-center shrink-0 select-none" role="img" aria-label={label} title={label} style={{ width: large ? 58 : 44, marginTop: 2, marginBottom: 5, filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.35))' }}>
      <svg viewBox="0 0 44 54" width="100%" style={{ display: 'block' }} aria-hidden="true">
        <rect x={0.5} y={0.5} width={43} height={53} rx={2} fill="#8a5a3b" stroke="#6b4329" />
        <rect x={4} y={4} width={36} height={46} fill="#fbf7ee" stroke="#cfbe9f" strokeWidth={0.6} />
        {children}
      </svg>
    </div>
  );
}

/** Words wrapped onto at most three short lines, shrunk to fit the mat */
export function wrapWords(text: string, per = 9): string[] {
  const lines: string[] = [];
  for (const w of text.split(' ').filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + w).length <= per) lines[lines.length - 1] = last + ' ' + w;
    else lines.push(w.slice(0, ART_TEXT_MAX));
  }
  return lines.slice(0, 4);
}
const SERIF = "Georgia, 'Times New Roman', serif";

export function ThanksFrame({ large }: { large: boolean }) {
  return (
    <Frame large={large} label="Framed sign: Thank You God">
      <text x={22} y={21} textAnchor="middle" fontFamily={SERIF} fontStyle="italic" fontSize={7.4} fill="#5c4a35">Thank You</text>
      <text x={22} y={32} textAnchor="middle" fontFamily={SERIF} fontStyle="italic" fontWeight={700} fontSize={10.5} fill="#2e5934">God</text>
      <path d="M22 40.6 c-2.4 -1.9 -3.8 -3 -3.8 -4.5 a2 2 0 0 1 3.8 -0.9 a2 2 0 0 1 3.8 0.9 c0 1.5 -1.4 2.6 -3.8 4.5z" fill="#c0576b" />
    </Frame>
  );
}

export function ArtFrame({ art, text, large }: { art: NookDecor['art']; text: string; large: boolean }) {
  const lines = wrapWords(text);
  const size = Math.max(4.2, Math.min(6.4, 34 / Math.max(...lines.map(l => l.length), 1) * 1.15));
  return (
    <Frame large={large} label={art === 'words' ? `Framed words: ${text}` : `Framed artwork: ${art}`}>
      {art === 'books' && (<>
        <rect x={10} y={32} width={24} height={6} fill="#925838" /><rect x={12} y={26} width={21} height={6} fill="#2e5934" /><rect x={9} y={20} width={22} height={6} fill="#b8892e" />
        <path d="M14 20 v6 M24 32 v6" stroke="#fbf7ee" strokeWidth={0.6} />
      </>)}
      {art === 'moon' && (<>
        <rect x={4} y={4} width={36} height={46} fill="#232a4a" />
        <path d="M27 14 a10 10 0 1 0 6 17 a8 8 0 1 1 -6 -17z" fill="#f6e7a8" />
        {[[11, 14], [17, 38], [31, 40], [12, 28]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.9} fill="#fff" />)}
      </>)}
      {art === 'sunflower' && (<>
        <path d="M22 46 V30" stroke="#4d8c56" strokeWidth={1.6} /><path d="M22 40 q-6 -1 -7 -6 q6 0 7 6z" fill="#4d8c56" />
        {Array.from({ length: 10 }, (_, i) => <ellipse key={i} cx={22} cy={15.5} rx={2.2} ry={5} fill="#f5b722" transform={`rotate(${i * 36} 22 24)`} />)}
        <circle cx={22} cy={24} r={4.2} fill="#6b4a33" />
      </>)}
      {art === 'hills' && (<>
        <rect x={4} y={4} width={36} height={46} fill="#f6d9b4" />
        <circle cx={29} cy={19} r={5} fill="#f4a261" />
        <path d="M4 38 q10 -10 20 -2 q8 -6 16 2 V50 H4z" fill="#6aa171" /><path d="M4 44 q12 -8 22 -1 q8 -3 14 1 V50 H4z" fill="#3f7348" />
      </>)}
      {art === 'heart' && <path d="M22 38 c-9 -7 -13 -11 -13 -17 a7 7 0 0 1 13 -3 a7 7 0 0 1 13 3 c0 6 -4 10 -13 17z" fill="#d9577a" />}
      {art === 'words' && lines.map((l, i) => (
        <text key={i} x={22} y={27 - ((lines.length - 1) * (size + 1.6)) / 2 + i * (size + 1.6)} textAnchor="middle" fontFamily={SERIF} fontStyle="italic" fontSize={size} fill="#5c4a35">{l}</text>
      ))}
    </Frame>
  );
}

/** One decoration, drawn for its area. `live` is false when the scene is not on screen (no timers, no motion). */
export function DecorItem({ id, decor, weather, dark, large, live }: { id: DecorId; decor: NookDecor; weather: WeatherData; dark: boolean; large: boolean; live: boolean }) {
  switch (id) {
    case 'mug': return <Mug kind={decor.mug} live={live} />;
    case 'clock': return decor.clock === 'analog' ? <AnalogClock weather={weather} large={large} live={live} /> : <NookClock weather={weather} dark={dark} large={large} live={live} />;
    case 'frame-thanks': return <ThanksFrame large={large} />;
    case 'frame-art': return <ArtFrame art={decor.art} text={decor.artText} large={large} />;
  }
}
