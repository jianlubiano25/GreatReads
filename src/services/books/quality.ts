/**
 * Content eligibility for discovery shelves (Store, Trending, the collated Top 15 fallback, discovery shelves).
 *
 * One shared judgement, used by every discovery path, about whether a book belongs in a GENERAL feed that anyone may scroll past.
 * It looks at every reliable signal a source gives us (categories, description, publisher, Google's maturity rating, Apple's content
 * advisory) and adds them up; the title is only ever a supporting signal. Two lines are drawn:
 *
 *   score >= EXPLICIT_FILTER_AT   left out of discovery shelves (explicit erotica, pornography, explicit sex manuals)
 *   score >= EXPLICIT_PENALTY_AT  allowed, but ranked well down, and not shown until a closer look has confirmed it (see collate.ts)
 *
 * What stays eligible: romance without explicit-content markers, LGBTQ+ books (identity words are never a signal), literary fiction
 * with mature themes, and sexual-health EDUCATION (a sex-instruction category alone is below both lines, and health / education
 * wording lowers the manual signals further). Search, the Library and Book Info are not affected: this only keeps explicit books
 * out of what the app recommends on its own.
 *
 * Covers are not analysed (no image model on the device), so a cover is kept out of the feed by keeping its BOOK out.
 */

export interface ContentFlags {
  subjects?: string[];
  description?: string;
  publisher?: string;
  googleMaturity?: string; // Google Books "MATURE" / "NOT_MATURE"
  appleAdvisory?: string; // Apple's content advisory text, when present
}

export const EXPLICIT_FILTER_AT = 40; // at or above: left out of discovery shelves
export const EXPLICIT_PENALTY_AT = 18; // at or above: allowed, but ranked well down (and held back until looked at closely)

/** Explicit-content vocabulary. In a title or category it is decisive; in a description it is strong but not decisive. */
const STRONG = /\b(erotic|erotica|erotics|bdsm|smut|smutty|porn|porno|pornographic|nsfw|hentai|xxx|sexually explicit|explicit sex|explicit sexual)\b/i;
/** "Pornography" as a CATEGORY. Library headings such as "Pornography -- Social aspects" or "Pornography -- Law" are about the subject, not the thing. */
const PORN_SUBJECT = /\bpornograph(?:y|ic)\b/i;
const PORN_SCHOLARSHIP = /\b(aspects?|law|laws|legal|history|censorship|criticism|psychology|psychological|sociolog\w*|social|moral|ethics|religious|political|economic|addiction|health|therapy|feminis\w*)\b/i;
const MEDIUM = /\b(steamy|spicy romance|dark romance|reverse harem|why choose|sex scenes?|sexual content|mature content|kink|kinky|taboo romance|naughty)\b/gi;

/** Library / store categories for sex-instruction books. On their own they are ALSO the category of ordinary sexual-health education, so they stay under both lines. */
const SEX_INSTRUCTION_SUBJECT = /\b(sex instruction|sex manuals?|sexual techniques?|sex techniques?|sex positions?|sexual positions?|sexual intercourse|sexual excitement|sexual practices|sex customs|kama ?sutra|sex toys?|erotic arts?)\b/i;
/** The shape of a sex-manual title ("... Sex Guide", "Guide to Great Sex", "... Kama Sutra"). Only ever supporting: alone it is a penalty, never an exclusion. */
const SEX_MANUAL_TITLE = /\b(sex (guide|manual|book|bible|secrets|positions|techniques|tips|games|toys)|guide to (?:\w+ )?sex(?!\s+(?:education|ed\b|health|therapy))|kama ?sutra|lovemaking|joy of sex)\b/i;
/** Wording that describes explicit how-to content (title, categories, description). Each distinct term counts once. */
const PRACTICE = /\b(sex positions?|sexual positions?|orgasm\w*|foreplay|erogenous|oral sex|masturbat\w+|erotic (?:massage|pleasure|arousal|games|photograph\w*|exercises?)|sensual (?:massage|photograph\w*)|explicit (?:photograph\w*|illustration\w*|image\w*|detail\w*))\b/gi;
/** Wording that marks health / science / education framing: it lowers the soft sex-manual signals (never the hard ones). Identity words (LGBTQ+, gender, queer) are NOT here: they never count for or against a book. */
const EDUCATION = /\b(sexual health|reproductive|contracepti\w*|birth control|puberty|sexually transmitted|sti|stis|std|stds|hiv|consent|anatomy|clinical|medical|medicine|gynecolog\w*|urolog\w*|pelvic|fertility|pregnan\w*|sex education|health education|adolescen\w*|teen\w*|science of|neuroscience|research)\b/gi;
/** Publisher / imprint names of adult-fiction houses. A short list, supporting only. */
const ADULT_PUBLISHER = /\b(erotic\w*|erotica|penthouse|playboy|hustler|xcite|bellesa|ellora'?s cave|black lace|total-e-bound|blushing books|ravenous romance)\b/i;

/**
 * Satanic / demonic / occult material, kept NARROW: only clearly instructional or explicitly satanic / ritual-focused books (the Satanic Bible,
 * demonolatry, the Goetia, occult grimoires such as the Necronomicon). Books that merely MENTION Satan, demons, witches, the devil, mythology,
 * fantasy, religion, theology, or the history of the occult stay eligible (Paradise Lost, The Satanic Verses, The Screwtape Letters, Dante,
 * Demon Copperhead, histories of occultism). Three rules keep it that way:
 *   - a title is decisive only when it names a specific work or practice (OCCULT_NAMED), or a practice word with no fiction / scholarship framing in the categories;
 *   - a GENERIC category ("Occultism", "Demonology") is only a penalty-sized signal that needs a second one; only a PRACTICE category ("Satanism", "Ritual magic") is decisive,
 *     and never when the category itself says "history", "folklore", "religion"...;
 *   - in a description it only ever supports (see occultDescriptionCap).
 */
/** Named works and practices: decisive in a title whatever the categories say. */
const OCCULT_NAMED = /\b(satanic (?:bible|rituals?|witch|worship|magic|spells?|rites?)|demonolat\w*|goet(?:ia|ic)|lesser key of solomon|grimorium verum|sixth and seventh books? of moses)\b/i;
/** Practice words that can also title a study or a novel: decisive in a title unless the categories frame it as fiction or scholarship (OCCULT_FRAME). */
const OCCULT_PRACTICE_TITLE = /\b(satanism|devil[- ]worship\w*|luciferian\w*|demonolog\w*)\b/i;
/** A name shared with fiction and film (Lovecraft anthologies): decisive only without fiction / scholarship framing and without Lovecraft in the title. */
const NECRONOMICON = /\bnecronomicon\b/i;
/** Fiction / scholarship / belief framing in a category: "Horror tales", "Occultism -- History", "Satanism -- Folklore". */
const OCCULT_FRAME = /\b(fiction|novels?|fantasy|stories|short stories|horror|mythology|juvenile|young adult|poetry|drama|comics|folk ?tales?|fairy tales?|history|historical|study|studies|criticism|folklore|sociolog\w*|anthropolog\w*|psycholog\w*|religion|theology|christianity|biblical|literature|philosoph\w*)\b/i;
/** The description side: every named / practice term, counted once each. Never reaches the filter line on one term. */
const OCCULT_STRONG = new RegExp(`${OCCULT_NAMED.source.replace(/\\b\(/, '\\b(?:')}|${OCCULT_PRACTICE_TITLE.source}`, 'i');
/** Weaker words: in a title they only penalise ("Demon Copperhead" must stay findable); in a description they add a little. */
const OCCULT_WEAK = /\b(demons?|occult|exorcis[mt]s?|grimoires?|black mass|summon(?:ing|s)? (?:the )?(?:demons?|devil))\b/gi;
/** A category that names the PRACTICE outright. */
const OCCULT_PRACTICE_SUBJECT = /\b(satanism|devil worship|diabolism|luciferian\w*|demonolatr\w*|goet\w+|ritual magic|ceremonial magic|grimoires?)\b/i;
/** A category that names the SUBJECT (it may be a study of it): a penalty-sized signal that needs a second one. */
const OCCULT_SUBJECT = /\b(occult\w*|demonolog\w*|satan\w*)\b/i;

const WEIGHTS = {
  strongHead: 45, // explicit vocabulary in the title or a category
  occultHead: 45, // a named work / practice in the title, or a practice category
  occultDescription: 30, // one strong term in the description
  occultWeakTitle: 24, // a weak term in the title: above EXPLICIT_PENALTY_AT, below EXPLICIT_FILTER_AT
  occultSubject: 24, // a generic occult category (once): the same size, so it blocks only together with a second signal
  occultWeakDescription: 12, // each distinct weak term in the description
  occultDescriptionCap: 39, // one strong term plus any number of weak ones can never reach EXPLICIT_FILTER_AT in a description; two different strong terms can
  strongDescription: 30,
  pornSubject: 45,
  sexInstruction: 17, // below EXPLICIT_PENALTY_AT: the category alone never penalises sexual-health education
  manualTitle: 24, // above EXPLICIT_PENALTY_AT: a manual-shaped title is penalised and held back, but not excluded by itself
  practiceTerm: 12, // each distinct term, up to practiceCap
  practiceCap: 36,
  educationTerm: 12, // each distinct term, up to educationCap, taken off the soft manual signals only
  educationCap: 36,
  adultPublisher: 24,
  mediumTerm: 12,
  mediumCap: 36,
  googleMature: 30,
  appleAdult: 20,
} as const;

const distinct = (re: RegExp, text: string) => new Set((text.match(re) || []).map(m => m.toLowerCase()));

/** Apple's own wording for "this book is fine" ("notExplicit", "Clean") must not read as an advisory just because it contains the word. */
const appleFlagsAdult = (advisory = ''): boolean => /explicit|adult|18\+|mature/i.test(advisory) && !/\bnot ?explicit\b|\bnon-?explicit\b|\bclean\b|\bcleaned\b/i.test(advisory);

export interface ContentAssessment {
  /** 0 = nothing suspicious */
  score: number;
  /** The part of `score` that comes from signals that stand alone (explicit, satanic / demonic, maturity ratings). */
  hard: number;
  /** The part that comes from the sex-manual family (category + title shape + how-to wording, after health / education framing). */
  soft: number;
  /** Which signals contributed, for tests and diagnostics (never shown to readers) */
  reasons: string[];
}

export function assessContent(title: string, f: ContentFlags = {}): ContentAssessment {
  const reasons: string[] = [];
  const subjects = (f.subjects || []).filter(Boolean);
  const subjectText = subjects.join(' | ');
  const desc = f.description || '';
  const head = `${title} ${subjectText}`;
  let hard = 0;
  let soft = 0;

  if (STRONG.test(head)) { hard += WEIGHTS.strongHead; reasons.push('explicit vocabulary in title or category'); }
  else if (STRONG.test(desc)) { hard += WEIGHTS.strongDescription; reasons.push('explicit vocabulary in description'); }
  if (subjects.some(s => PORN_SUBJECT.test(s) && !PORN_SCHOLARSHIP.test(s))) { hard += WEIGHTS.pornSubject; reasons.push('pornography category'); }
  if (ADULT_PUBLISHER.test(f.publisher || '')) { hard += WEIGHTS.adultPublisher; reasons.push('adult-fiction publisher'); }
  if (/^mature$/i.test(f.googleMaturity || '')) { hard += WEIGHTS.googleMature; reasons.push('Google maturity rating'); }
  if (appleFlagsAdult(f.appleAdvisory)) { hard += WEIGHTS.appleAdult; reasons.push('Apple content advisory'); }
  const medium = distinct(MEDIUM, `${head} ${desc}`);
  if (medium.size) { hard += Math.min(WEIGHTS.mediumCap, medium.size * WEIGHTS.mediumTerm); reasons.push('explicit-romance wording'); }

  // Satanic / demonic / occult instruction: named works and practice categories decide; everything else needs a second signal (see OCCULT_* above)
  const framed = OCCULT_FRAME.test(subjectText);
  const practiceCategory = subjects.some(x => OCCULT_PRACTICE_SUBJECT.test(x) && !OCCULT_FRAME.test(x));
  const namedTitle = OCCULT_NAMED.test(title)
    || (!framed && OCCULT_PRACTICE_TITLE.test(title))
    || (!framed && NECRONOMICON.test(title) && !/\blovecraft\b/i.test(title));
  if (namedTitle || practiceCategory) { hard += WEIGHTS.occultHead; reasons.push('satanic / demonic title or category'); }
  else {
    let occult = 0;
    if (distinct(OCCULT_WEAK, title).size) occult += WEIGHTS.occultWeakTitle;
    if (subjects.some(x => OCCULT_SUBJECT.test(x) && !OCCULT_FRAME.test(x))) occult += WEIGHTS.occultSubject;
    const strongInDesc = distinct(new RegExp(OCCULT_STRONG.source, 'gi'), desc);
    const weakInDesc = distinct(OCCULT_WEAK, desc);
    let fromDesc = 0;
    if (strongInDesc.size) fromDesc += WEIGHTS.occultDescription + (Math.min(strongInDesc.size, 3) - 1) * WEIGHTS.occultWeakDescription; // each further DIFFERENT strong term adds a little
    fromDesc += Math.min(2, weakInDesc.size) * WEIGHTS.occultWeakDescription;
    if (strongInDesc.size < 2) fromDesc = Math.min(fromDesc, WEIGHTS.occultDescriptionCap);
    occult += fromDesc;
    if (occult) { hard += occult; reasons.push('satanic / demonic wording'); }
  }

  // The sex-manual family: independent signals that corroborate each other; health / education wording takes some of it back.
  if (SEX_INSTRUCTION_SUBJECT.test(subjectText)) { soft += WEIGHTS.sexInstruction; reasons.push('sex-instruction category'); }
  if (SEX_MANUAL_TITLE.test(title)) { soft += WEIGHTS.manualTitle; reasons.push('sex-manual title'); }
  const practice = distinct(PRACTICE, `${head} ${desc}`);
  if (practice.size) { soft += Math.min(WEIGHTS.practiceCap, practice.size * WEIGHTS.practiceTerm); reasons.push('explicit how-to wording'); }
  if (soft) {
    const education = distinct(EDUCATION, `${head} ${desc}`);
    if (education.size) { soft = Math.max(0, soft - Math.min(WEIGHTS.educationCap, education.size * WEIGHTS.educationTerm)); reasons.push('health / education framing'); }
  }
  return { score: hard + soft, hard, soft, reasons };
}

/** 0 = nothing suspicious. */
export const explicitScore = (title: string, f: ContentFlags = {}): number => assessContent(title, f).score;

export const isExplicit = (title: string, f?: ContentFlags) => explicitScore(title, f) >= EXPLICIT_FILTER_AT;

/**
 * Should this book be kept out of the app's own surfaces (search results, every Store shelf)? True for explicit / sexual books, sex manuals
 * and satanic / demonic books. A sex-manual-shaped title is enough here (it only penalises on a shelf): search has no "held back until looked
 * at closely" step, so it is judged outright. Sexual-health education (category alone, or health / education wording) stays under the line.
 * The reader's OWN saved books are never run through this: a book already in the Library is never hidden or removed.
 */
export function isBlocked(title: string, f?: ContentFlags): boolean {
  const a = assessContent(title, f);
  return a.score >= EXPLICIT_FILTER_AT || a.soft >= EXPLICIT_PENALTY_AT;
}
