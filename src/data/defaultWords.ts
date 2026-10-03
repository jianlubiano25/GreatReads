import { WordItem } from '../types';

export const BUILTIN_DICTIONARY: Record<string, {
  phonetic: string;
  partOfSpeech: string;
  definition: string;
  definitions?: string[];
  example: string;
  etymology?: string;
  synonyms?: string[];
}> = {
  solace: {
    phonetic: '/ˈsɒl.ɪs/',
    partOfSpeech: 'noun',
    definition: 'Comfort or consolation in a time of distress, sadness, or disappointment.',
    definitions: [
      'Comfort or consolation in a time of sadness or loneliness.',
      'A person or thing that gives comfort or relieves grief.',
    ],
    example: 'She found quiet solace within the sunlit pages of her morning reading.',
    etymology: 'Middle English: from Old French solas, from Latin solari "to console".',
    synonyms: ['comfort', 'consolation', 'refuge', 'respite'],
  },
  serendipity: {
    phonetic: '/ˌser.ənˈdɪp.ə.ti/',
    partOfSpeech: 'noun',
    definition: 'The occurrence and development of events by chance in a happy or beneficial way.',
    definitions: [
      'The faculty of making fortunate discoveries unexpectedly.',
      'A pleasant surprise or fortunate accident.',
    ],
    example: 'Finding this bookstore in a rainstorm felt like pure serendipity.',
    etymology: 'Coined by Horace Walpole in 1754 from the Persian fairy tale "The Three Princes of Serendip".',
    synonyms: ['chance', 'happy accident', 'fluke', 'providence'],
  },
  ephemeral: {
    phonetic: '/ɪˈfem.ər.əl/',
    partOfSpeech: 'adjective',
    definition: 'Lasting for a very short time; fleeting or transient.',
    definitions: [
      'Lasting only for a brief period or single day.',
      'Fleeting; having a brief, beautiful existence.',
    ],
    example: 'The twilight glow over the rooftops was mesmerizing but ephemeral.',
    etymology: 'From Greek ephēmeros, from epi "upon" + hēmera "day".',
    synonyms: ['transient', 'fleeting', 'evanescent', 'short-lived'],
  },
  limerence: {
    phonetic: '/ˈlɪm.ər.əns/',
    partOfSpeech: 'noun',
    definition: 'The state of being infatuated or obsessed with another person, typically involuntarily and characterized by a desire for reciprocation.',
    definitions: [
      'An involuntary state of intense romantic longing and emotional dependency on another person.',
    ],
    example: 'She realized her racing heartbeat was not mature love, but the intoxicating grip of limerence.',
    etymology: 'Coined in 1979 by American psychologist Dorothy Tennov in "Love and Limerence".',
    synonyms: ['infatuation', 'crush', 'obsession', 'passion'],
  },
  petrichor: {
    phonetic: '/ˈpet.rɪ.kɔːr/',
    partOfSpeech: 'noun',
    definition: 'A pleasant, distinctive smell that frequently accompanies the first rain after a long period of warm, dry weather.',
    definitions: [
      'The earthy scent produced when rain falls on dry soil or parched stone.',
    ],
    example: 'She opened the bedroom window to breathe in the petrichor rising from the garden terrace.',
    etymology: 'From Greek petra "stone" + ichor "ethereal fluid in the veins of gods". Coined in 1964.',
    synonyms: ['rain scent', 'earthiness'],
  },
  sonder: {
    phonetic: '/ˈsɒn.dər/',
    partOfSpeech: 'noun',
    definition: 'The profound realization that each random passerby is living a life as vivid and complex as your own.',
    definitions: [
      'The realization that everyone around you has their own internal world of dreams, sorrow, and memories.',
    ],
    example: 'Watching strangers commute past the window, a wave of sonder washed over her.',
    etymology: 'Coined in 2012 by John Koenig in "The Dictionary of Obscure Sorrows".',
    synonyms: ['empathy', 'awareness', 'perspective'],
  },
  enmeshment: {
    phonetic: '/ɪnˈmeʃ.mənt/',
    partOfSpeech: 'noun',
    definition: 'A relationship dynamic where boundaries are permeable and unclear, causing individuals to absorb each other\'s emotions.',
    definitions: [
      'A condition where family members are over-involved in each other\'s emotional lives, impairing individual autonomy.',
    ],
    example: 'Therapy helped her recognize that what felt like loyalty was actually enmeshment.',
    etymology: 'From en- "in" + mesh "network, net". Used extensively in family systems psychology by Salvador Minuchin.',
    synonyms: ['codependency', 'blurring', 'entanglement'],
  },
  resilience: {
    phonetic: '/rɪˈzɪl.jəns/',
    partOfSpeech: 'noun',
    definition: 'The capacity to recover quickly from difficulties, stress, or trauma; emotional toughness.',
    definitions: [
      'The ability of a person to adapt well in the face of adversity, trauma, or significant sources of stress.',
    ],
    example: 'True resilience is not suppressing pain, but moving through it with patience and grace.',
    etymology: 'From Latin resilire "to spring back or rebound".',
    synonyms: ['fortitude', 'endurance', 'perseverance', 'strength'],
  },
  catharsis: {
    phonetic: '/kəˈθɑːr.sɪs/',
    partOfSpeech: 'noun',
    definition: 'The process of releasing, and thereby providing relief from, strong or repressed emotions.',
    definitions: [
      'Purging or cleansing of emotions, especially through art, literature, or deep conversation.',
    ],
    example: 'Closing the final chapter brought a surprising wave of catharsis and quiet tears.',
    etymology: 'From Greek katharsis "purification, cleansing", from kathairein "to cleanse".',
    synonyms: ['cleansing', 'release', 'purgation', 'liberation'],
  },
  ineffable: {
    phonetic: '/ɪnˈef.ə.bəl/',
    partOfSpeech: 'adjective',
    definition: 'Too great or extreme to be expressed or described in words.',
    definitions: [
      'Beyond expression in words; unspeakable or inexpressible.',
      'Not to be uttered, especially out of reverence.',
    ],
    example: 'The silent stillness of the coastal fog gave the morning an ineffable serenity.',
    etymology: 'From Latin in- "not" + effabilis "speakable", from effari "utter".',
    synonyms: ['indescribable', 'unutterable', 'transcendent', 'overwhelming'],
  },
  vellichor: {
    phonetic: '/ˈvel.ɪ.kɔːr/',
    partOfSpeech: 'noun',
    definition: 'The strange wistfulness of used bookstores, filled with thousands of old books you will never have time to read.',
    definitions: [
      'The nostalgic atmosphere and aged paper scent of secondhand libraries and bookstores.',
    ],
    example: 'She lingered in the antique bookstore, enveloped in warm vellichor and quiet wonder.',
    etymology: 'From "The Dictionary of Obscure Sorrows", blending Latin vellus "fleece/parchment" and ichor.',
    synonyms: ['nostalgia', 'bookish wistfulness'],
  },
  melancholy: {
    phonetic: '/ˈmel.əŋ.kɒl.i/',
    partOfSpeech: 'noun',
    definition: 'A feeling of pensive sadness, typically with no obvious cause, often tinged with beauty.',
    definitions: [
      'A thoughtful, gentle sadness that prompts reflection.',
    ],
    example: 'The cello melody filled the autumn afternoon with a sweet, comforting melancholy.',
    etymology: 'From Greek melas "black" + khole "bile".',
    synonyms: ['pensiveness', 'wistfulness', 'sorrow'],
  },
  malevolent: {
    phonetic: '/məˈlev.əl.ənt/',
    partOfSpeech: 'adjective',
    definition: 'Having or showing a wish to do evil or harm to others; maliciously hostile.',
    definitions: [
      'Having or exhibiting ill will; wishing harm to others.',
      'Arising from intense, malicious ill will or spite.',
    ],
    example: 'Immature parents may project malevolent intentions onto an innocent child’s natural emotional needs.',
    etymology: 'From Latin malevolens, from male "badly, ill" + volens "wishing" (from velle "to wish").',
    synonyms: ['malicious', 'spiteful', 'hostile', 'venomous', 'vindictive'],
  },
  minutiae: {
    phonetic: '/mɪˈnuː.ʃi.aɪ/',
    partOfSpeech: 'noun (plural)',
    definition: 'The small, precise, or trivial details of something; subtle nuances.',
    definitions: [
      'The small, precise, or trivial details of something.',
      'Minor matters or intricate particulars that make up everyday life.',
    ],
    example: 'Lost in the emotional minutiae of family life, she learned to look at the broader behavioral patterns.',
    etymology: 'Latin, plural of minutia "smallness", from minutus "small, lessened".',
    synonyms: ['details', 'niceties', 'particulars', 'trivia', 'finer points'],
  },
};

export const INITIAL_WORDS: WordItem[] = [
  {
    id: 'w1',
    word: 'solace',
    phonetic: '/ˈsɒl.ɪs/',
    partOfSpeech: 'noun',
    definition: 'Comfort or consolation in a time of distress, sadness, or disappointment.',
    definitions: [
      'Comfort or consolation in a time of sadness or loneliness.',
      'A person or thing that gives comfort or relieves grief.',
    ],
    example: 'She found quiet solace within the sunlit pages of her morning reading.',
    etymology: 'Middle English: from Old French solas, from Latin solari "to console".',
    synonyms: ['comfort', 'consolation', 'refuge'],
    bookId: 0,
    bookTitle: 'Adult Children of Emotionally Immature Parents',
    quoteSentence: 'Healing begins when you find solace in your own self-worth rather than external validation.',
    isLearned: false,
    addedAt: Date.now() - 86400000 * 3,
  },
  {
    id: 'w2',
    word: 'serendipity',
    phonetic: '/ˌser.ənˈdɪp.ə.ti/',
    partOfSpeech: 'noun',
    definition: 'The occurrence and development of events by chance in a happy or beneficial way.',
    definitions: [
      'The faculty of making fortunate discoveries unexpectedly.',
      'A pleasant surprise or fortunate accident.',
    ],
    example: 'Finding this bookstore in a rainstorm felt like pure serendipity.',
    etymology: 'Coined by Horace Walpole in 1754 from the fairy tale The Three Princes of Serendip.',
    synonyms: ['chance', 'happy accident', 'fluke'],
    bookId: 5,
    bookTitle: 'Piranesi',
    quoteSentence: 'The Beauty of the House is immeasurable; its Kindness infinite.',
    isLearned: true,
    addedAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'w3',
    word: 'limerence',
    phonetic: '/ˈlɪm.ər.əns/',
    partOfSpeech: 'noun',
    definition: 'The state of being infatuated or obsessed with another person, typically involuntarily and characterized by a desire for reciprocation.',
    definitions: [
      'An involuntary state of intense romantic longing and emotional dependency on another person.',
    ],
    example: 'She realized her racing heartbeat was not mature love, but the intoxicating grip of limerence.',
    etymology: 'Coined in 1979 by psychologist Dorothy Tennov.',
    synonyms: ['infatuation', 'crush', 'obsession'],
    bookId: 3,
    bookTitle: 'Attached',
    quoteSentence: 'Anxious attachment often mistakes anxiety and limerence for real passion.',
    isLearned: false,
    addedAt: Date.now() - 86400000,
  },
];
