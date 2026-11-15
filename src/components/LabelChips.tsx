import React from 'react';
import { Award, BookOpen, ChevronDown, Layers, Lightbulb, Library, Tag } from 'lucide-react';
import type { LabelGroup, LabelGroupName } from '../services/books/labelGroups';
import { PROVIDER_LABEL, isProvider } from '../services/books/providers';

/** One colour per kind of label, each with its own icon, in the same chip style as Awards &amp; honors. */
export const TONE = {
  green: 'bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880] border-[#2e5934]/20',
  blue: 'bg-[#e6eef7] dark:bg-[#1c2a3a] text-[#25507a] dark:text-[#8db8e8] border-[#25507a]/20',
  purple: 'bg-[#efe8f6] dark:bg-[#2c2238] text-[#5b3a82] dark:text-[#c3a3ea] border-[#5b3a82]/20',
  teal: 'bg-[#e3f2f1] dark:bg-[#1a2f2e] text-[#1f6b66] dark:text-[#7fd0c9] border-[#1f6b66]/20',
  gold: 'bg-[#fbf1d8] dark:bg-[#3a2f14] text-[#8a5a00] dark:text-[#f0c36a] border-[#8a5a00]/25',
  rose: 'bg-[#f8e8ea] dark:bg-[#3a2024] text-[#9a3346] dark:text-[#eba0ae] border-[#9a3346]/20',
} as const;
type Tone = keyof typeof TONE;

const STYLE: Record<LabelGroupName, { icon: React.ComponentType<{ className?: string }>; tone: Tone; iconColor: string }> = {
  'Genres': { icon: BookOpen, tone: 'green', iconColor: 'text-[#2e5934] dark:text-[#86b880]' },
  'Subgenres': { icon: Layers, tone: 'blue', iconColor: 'text-[#25507a] dark:text-[#8db8e8]' },
  'Subjects & themes': { icon: Lightbulb, tone: 'purple', iconColor: 'text-[#5b3a82] dark:text-[#c3a3ea]' },
  'Collections': { icon: Library, tone: 'teal', iconColor: 'text-[#1f6b66] dark:text-[#7fd0c9]' },
  'Keywords & tags': { icon: Tag, tone: 'rose', iconColor: 'text-[#9a3346] dark:text-[#eba0ae]' },
};
const GOLD_ICON = 'text-amber-500';

export function GroupTitle({ icon: Icon, title, tone, iconColor }: { icon: React.ComponentType<{ className?: string }>; title: string; tone: Tone; iconColor?: string }) {
  return (
    <h5 className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] mb-1.5 flex items-center gap-1.5">
      <Icon className={`w-3.5 h-3.5 ${iconColor || (tone === 'gold' ? GOLD_ICON : '')}`} />
      <span>{title}</span>
    </h5>
  );
}

export function ChipGroup({ group, hideTitle }: { group: LabelGroup; hideTitle?: boolean }) {
  const st = STYLE[group.name];
  const Icon = st.icon;
  return (
    <div className="mb-3 last:mb-0">
      {!hideTitle && <GroupTitle icon={Icon} title={group.name} tone={st.tone} iconColor={st.iconColor} />}
      <div className="flex flex-wrap gap-2">
        {group.chips.map(c => (
          <span key={c.label} title={`${c.main ? 'Main genre (the one used on shelves). ' : ''}${c.published ? '' : 'Not published yet (only you see this). '}${c.sources.map(x => (isProvider(x) ? PROVIDER_LABEL[x] : 'Your library')).join(', ')}`}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${TONE[st.tone]} ${c.published ? '' : 'border-dashed opacity-70'}`}>
            {c.main ? <span aria-label="main genre" className="text-amber-500 leading-none">★</span> : <Icon className={`w-3 h-3 ${st.iconColor}`} />}
            <span>{c.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** A section the reader can fold away (native details/summary: works without script, remembers nothing). */
export function Fold({ title, count, children, testId, defaultOpen = true }: { title: string; count?: number; children: React.ReactNode; testId?: string; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group px-6 py-4 border-b border-[#e3d7c3] dark:border-[#382f25]" data-testid={testId}>
      <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden mb-0 group-open:mb-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">{title}{count !== undefined ? ` · ${count}` : ''}</h4>
        <ChevronDown className="w-4 h-4 text-[#706256] dark:text-[#a89a8a] transition-transform group-open:rotate-180" />
      </summary>
      {children}
    </details>
  );
}
