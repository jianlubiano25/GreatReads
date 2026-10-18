/**
 * The genres on the Search tab. Tapping one opens the genre's page: a row of hand-picked books (or the Store's own shelf for that genre), chips
 * for its sub-genres, and below them the catalogs' subject search, ranked for the genre (books of the right kind, widely read, not one author's whole shelf).
 *   query     the word a catalog files its books under (the Keywords search)
 *   kind      what a result should be: 'fiction' / 'nonfiction' (a book of the other kind is pushed down); omitted when a genre has both (classics, poetry, graphic novels)
 *   shelfId   the Store shelf that already holds this genre's picks (so the same hand-picked list is not kept twice)
 *   picks     otherwise: [title, author] of well-known books that are certain to belong
 *   popular   id of an official NYT list (services/store/lists.ts) that is this genre's "Popular now" row; the row is left out when the list can't be loaded
 *   subgenres chips that narrow the genre (each is a Keywords search of its own)
 */
export interface SearchGenre {
  label: string;
  emoji: string;
  query: string;
  kind?: 'fiction' | 'nonfiction';
  shelfId?: string;
  popular?: string;
  picks?: Array<[string, string]>;
  subgenres: Array<{ label: string; query: string }>;
}

export const SEARCH_GENRES: SearchGenre[] = [
  { label: 'Fantasy', emoji: '🐉', query: 'fantasy', kind: 'fiction', shelfId: 'fantasy',
    subgenres: [{ label: 'Epic fantasy', query: 'epic fantasy' }, { label: 'Urban fantasy', query: 'urban fantasy' }, { label: 'Fantasy romance', query: 'fantasy romance' }, { label: 'Dark fantasy', query: 'dark fantasy' }, { label: 'Fairy tales', query: 'fairy tales' }] },
  { label: 'Science Fiction', emoji: '🚀', query: 'science fiction', kind: 'fiction', shelfId: 'scifi',
    subgenres: [{ label: 'Space opera', query: 'space opera' }, { label: 'Dystopian', query: 'dystopian' }, { label: 'Cyberpunk', query: 'cyberpunk' }, { label: 'Time travel', query: 'time travel' }, { label: 'Post-apocalyptic', query: 'post-apocalyptic' }] },
  { label: 'Mystery', emoji: '🔍', query: 'mystery', kind: 'fiction', shelfId: 'mystery',
    subgenres: [{ label: 'Cozy mystery', query: 'cozy mystery' }, { label: 'Detective', query: 'detective' }, { label: 'Police procedural', query: 'police procedural' }, { label: 'Whodunit', query: 'whodunit' }] },
  { label: 'Thriller', emoji: '🕶️', query: 'thriller', kind: 'fiction',
    picks: [['Gone Girl', 'Gillian Flynn'], ['The Girl with the Dragon Tattoo', 'Stieg Larsson'], ['The Silent Patient', 'Alex Michaelides'], ['The Da Vinci Code', 'Dan Brown'], ['The Girl on the Train', 'Paula Hawkins'], ['Before I Go to Sleep', 'S. J. Watson'], ['The Talented Mr. Ripley', 'Patricia Highsmith'], ['The Day of the Jackal', 'Frederick Forsyth'], ['The Guest List', 'Lucy Foley'], ['Verity', 'Colleen Hoover'], ['The Woman in the Window', 'A. J. Finn'], ['Shutter Island', 'Dennis Lehane']],
    subgenres: [{ label: 'Psychological thriller', query: 'psychological thriller' }, { label: 'Legal thriller', query: 'legal thriller' }, { label: 'Spy', query: 'espionage' }, { label: 'Domestic suspense', query: 'domestic suspense' }] },
  { label: 'Romance', emoji: '💕', query: 'romance', kind: 'fiction', shelfId: 'romance',
    subgenres: [{ label: 'Contemporary romance', query: 'contemporary romance' }, { label: 'Historical romance', query: 'historical romance' }, { label: 'Romantic comedy', query: 'romantic comedy' }, { label: 'Fantasy romance', query: 'fantasy romance' }] },
  { label: 'Historical Fiction', emoji: '🏰', query: 'historical fiction', kind: 'fiction', shelfId: 'historical',
    subgenres: [{ label: 'World War II', query: 'world war ii fiction' }, { label: 'Ancient world', query: 'ancient rome fiction' }, { label: 'Victorian', query: 'victorian fiction' }, { label: 'Medieval', query: 'medieval fiction' }] },
  { label: 'Literary Fiction', emoji: '📖', query: 'literary fiction', kind: 'fiction',
    picks: [['The Remains of the Day', 'Kazuo Ishiguro'], ['Beloved', 'Toni Morrison'], ['The Goldfinch', 'Donna Tartt'], ['A Little Life', 'Hanya Yanagihara'], ['Normal People', 'Sally Rooney'], ['Gilead', 'Marilynne Robinson'], ['The Road', 'Cormac McCarthy'], ['Never Let Me Go', 'Kazuo Ishiguro'], ['Americanah', 'Chimamanda Ngozi Adichie'], ['Pachinko', 'Min Jin Lee'], ['The Secret History', 'Donna Tartt'], ['Station Eleven', 'Emily St. John Mandel']],
    subgenres: [{ label: 'Family saga', query: 'family saga' }, { label: 'Coming of age', query: 'coming of age' }, { label: 'Magical realism', query: 'magical realism' }, { label: 'Prize winners', query: 'prize winning novels' }] },
  { label: 'Horror', emoji: '🦇', query: 'horror', kind: 'fiction',
    picks: [['The Shining', 'Stephen King'], ['Dracula', 'Bram Stoker'], ['Frankenstein', 'Mary Shelley'], ['The Haunting of Hill House', 'Shirley Jackson'], ['Pet Sematary', 'Stephen King'], ['Bird Box', 'Josh Malerman'], ['Mexican Gothic', 'Silvia Moreno-Garcia'], ['The Exorcist', 'William Peter Blatty'], ["Rosemary's Baby", 'Ira Levin'], ['The Cabin at the End of the World', 'Paul Tremblay'], ['House of Leaves', 'Mark Z. Danielewski'], ['Interview with the Vampire', 'Anne Rice']],
    subgenres: [{ label: 'Gothic', query: 'gothic' }, { label: 'Ghost stories', query: 'ghost stories' }, { label: 'Supernatural', query: 'supernatural horror' }, { label: 'Haunted house', query: 'haunted house' }] },
  { label: 'Cozy', emoji: '☕', query: 'cozy', kind: 'fiction',
    picks: [['The Thursday Murder Club', 'Richard Osman'], ['Legends & Lattes', 'Travis Baldree'], ['The House in the Cerulean Sea', 'TJ Klune'], ['A Man Called Ove', 'Fredrik Backman'], ['The Guernsey Literary and Potato Peel Pie Society', 'Mary Ann Shaffer'], ['Anxious People', 'Fredrik Backman'], ['Eleanor Oliphant Is Completely Fine', 'Gail Honeyman'], ["The No. 1 Ladies' Detective Agency", 'Alexander McCall Smith'], ['Anne of Green Gables', 'L. M. Montgomery'], ['The Rosie Project', 'Graeme Simsion'], ['A Psalm for the Wild-Built', 'Becky Chambers'], ["Howl's Moving Castle", 'Diana Wynne Jones']],
    subgenres: [{ label: 'Cozy mystery', query: 'cozy mystery' }, { label: 'Heartwarming', query: 'heartwarming' }, { label: 'Small town', query: 'small town' }, { label: 'Cozy fantasy', query: 'cozy fantasy' }] },
  { label: 'Classics', emoji: '🏛️', query: 'classics', shelfId: 'classics',
    subgenres: [{ label: 'Victorian', query: 'victorian literature' }, { label: 'Russian', query: 'russian literature' }, { label: 'American', query: 'american classics' }, { label: 'Gothic', query: 'gothic classics' }] },
  { label: 'Young Adult', emoji: '🎒', query: 'young adult', popular: 'nyt-ya', kind: 'fiction',
    picks: [['The Hunger Games', 'Suzanne Collins'], ["Harry Potter and the Sorcerer's Stone", 'J. K. Rowling'], ['The Fault in Our Stars', 'John Green'], ['Divergent', 'Veronica Roth'], ['The Hate U Give', 'Angie Thomas'], ['Six of Crows', 'Leigh Bardugo'], ['The Lightning Thief', 'Rick Riordan'], ['The Perks of Being a Wallflower', 'Stephen Chbosky'], ['Eleanor & Park', 'Rainbow Rowell'], ['Speak', 'Laurie Halse Anderson'], ['Legendborn', 'Tracy Deonn'], ['The Giver', 'Lois Lowry']],
    subgenres: [{ label: 'Dystopian', query: 'young adult dystopian' }, { label: 'Fantasy', query: 'young adult fantasy' }, { label: 'Contemporary', query: 'young adult contemporary' }, { label: 'Romance', query: 'young adult romance' }] },
  { label: 'Graphic Novels', emoji: '💭', query: 'graphic novels', popular: 'nyt-genre-graphic',
    picks: [['Maus', 'Art Spiegelman'], ['Persepolis', 'Marjane Satrapi'], ['Watchmen', 'Alan Moore'], ['Fun Home', 'Alison Bechdel'], ['Saga', 'Brian K. Vaughan'], ['Heartstopper', 'Alice Oseman'], ['Blankets', 'Craig Thompson'], ['American Born Chinese', 'Gene Luen Yang'], ['The Arrival', 'Shaun Tan'], ['Nimona', 'ND Stevenson'], ['Understanding Comics', 'Scott McCloud'], ['Smile', 'Raina Telgemeier']],
    subgenres: [{ label: 'Manga', query: 'manga' }, { label: 'Superheroes', query: 'superhero comics' }, { label: 'Memoir comics', query: 'graphic memoir' }, { label: 'Fantasy comics', query: 'fantasy graphic novels' }] },
  { label: 'Short Stories', emoji: '✂️', query: 'short stories',
    picks: [['Interpreter of Maladies', 'Jhumpa Lahiri'], ['Cathedral', 'Raymond Carver'], ['Dubliners', 'James Joyce'], ['The Things They Carried', "Tim O'Brien"], ['Tenth of December', 'George Saunders'], ['Stories of Your Life and Others', 'Ted Chiang'], ['The Lottery and Other Stories', 'Shirley Jackson'], ['Nine Stories', 'J. D. Salinger'], ['Exhalation', 'Ted Chiang'], ['Her Body and Other Parties', 'Carmen Maria Machado'], ['A Good Man Is Hard to Find', "Flannery O'Connor"], ['Birds of America', 'Lorrie Moore']],
    subgenres: [{ label: 'Science fiction', query: 'science fiction short stories' }, { label: 'Horror', query: 'horror short stories' }, { label: 'Classic', query: 'classic short stories' }, { label: 'Contemporary', query: 'contemporary short stories' }] },
  { label: 'Poetry', emoji: '🪶', query: 'poetry',
    picks: [['Milk and Honey', 'Rupi Kaur'], ['Leaves of Grass', 'Walt Whitman'], ['Ariel', 'Sylvia Plath'], ['Howl', 'Allen Ginsberg'], ['Citizen: An American Lyric', 'Claudia Rankine'], ['Night Sky with Exit Wounds', 'Ocean Vuong'], ['The Prophet', 'Kahlil Gibran'], ['Devotions', 'Mary Oliver'], ['The Waste Land', 'T. S. Eliot'], ['Postcolonial Love Poem', 'Natalie Diaz'], ['The Sun and Her Flowers', 'Rupi Kaur'], ['The Princess Saves Herself in This One', 'Amanda Lovelace']],
    subgenres: [{ label: 'Love poems', query: 'love poems' }, { label: 'Modern', query: 'contemporary poetry' }, { label: 'Classic', query: 'classic poetry' }, { label: 'Nature', query: 'nature poetry' }] },
  { label: 'Biography', emoji: '🧑', query: 'biography', kind: 'nonfiction',
    picks: [['Steve Jobs', 'Walter Isaacson'], ['Alexander Hamilton', 'Ron Chernow'], ['Becoming', 'Michelle Obama'], ['Long Walk to Freedom', 'Nelson Mandela'], ['The Diary of a Young Girl', 'Anne Frank'], ['Einstein: His Life and Universe', 'Walter Isaacson'], ['Born a Crime', 'Trevor Noah'], ['Educated', 'Tara Westover'], ['The Immortal Life of Henrietta Lacks', 'Rebecca Skloot'], ['Unbroken', 'Laura Hillenbrand'], ['Leonardo da Vinci', 'Walter Isaacson'], ['Elon Musk', 'Walter Isaacson']],
    subgenres: [{ label: 'Leaders', query: 'political biography' }, { label: 'Scientists', query: 'scientists biography' }, { label: 'Artists', query: 'artists biography' }, { label: 'Sports', query: 'sports biography' }] },
  { label: 'Memoir', emoji: '📓', query: 'memoir', kind: 'nonfiction', shelfId: 'memoir',
    subgenres: [{ label: 'Family', query: 'family memoir' }, { label: 'Coming of age', query: 'coming of age memoir' }, { label: 'Celebrity', query: 'celebrity memoir' }, { label: 'Survival', query: 'survival memoir' }] },
  { label: 'History', emoji: '🗺️', query: 'history', popular: 'nyt-genre-history', kind: 'nonfiction',
    picks: [['Sapiens', 'Yuval Noah Harari'], ['Guns, Germs, and Steel', 'Jared Diamond'], ['The Guns of August', 'Barbara W. Tuchman'], ["A People's History of the United States", 'Howard Zinn'], ['SPQR', 'Mary Beard'], ['The Silk Roads', 'Peter Frankopan'], ['1491', 'Charles C. Mann'], ['The Rise and Fall of the Third Reich', 'William L. Shirer'], ['Team of Rivals', 'Doris Kearns Goodwin'], ['The Warmth of Other Suns', 'Isabel Wilkerson'], ['Empire of the Summer Moon', 'S. C. Gwynne'], ['The Splendid and the Vile', 'Erik Larson']],
    subgenres: [{ label: 'Ancient', query: 'ancient history' }, { label: 'World War II', query: 'world war ii history' }, { label: 'American', query: 'american history' }, { label: 'Europe', query: 'european history' }] },
  { label: 'Science', emoji: '🔬', query: 'science', popular: 'nyt-genre-science', kind: 'nonfiction',
    picks: [['A Brief History of Time', 'Stephen Hawking'], ['Cosmos', 'Carl Sagan'], ['The Selfish Gene', 'Richard Dawkins'], ['Astrophysics for People in a Hurry', 'Neil deGrasse Tyson'], ['A Short History of Nearly Everything', 'Bill Bryson'], ['The Gene', 'Siddhartha Mukherjee'], ['Silent Spring', 'Rachel Carson'], ['Pale Blue Dot', 'Carl Sagan'], ['The Double Helix', 'James D. Watson'], ['Why We Sleep', 'Matthew Walker'], ['The Order of Time', 'Carlo Rovelli'], ['The Origin of Species', 'Charles Darwin']],
    subgenres: [{ label: 'Physics', query: 'physics' }, { label: 'Biology', query: 'biology' }, { label: 'Space', query: 'astronomy' }, { label: 'Nature', query: 'nature writing' }] },
  { label: 'Psychology', emoji: '🧠', query: 'psychology', kind: 'nonfiction',
    picks: [['Thinking, Fast and Slow', 'Daniel Kahneman'], ["Man's Search for Meaning", 'Viktor E. Frankl'], ['The Body Keeps the Score', 'Bessel van der Kolk'], ['Quiet', 'Susan Cain'], ['Predictably Irrational', 'Dan Ariely'], ['Influence', 'Robert B. Cialdini'], ['Mindset', 'Carol S. Dweck'], ['Emotional Intelligence', 'Daniel Goleman'], ['Attached', 'Amir Levine'], ['Grit', 'Angela Duckworth'], ['Drive', 'Daniel H. Pink'], ['The Happiness Hypothesis', 'Jonathan Haidt']],
    subgenres: [{ label: 'Behavior', query: 'behavioral psychology' }, { label: 'Relationships', query: 'relationship psychology' }, { label: 'Trauma', query: 'trauma psychology' }, { label: 'Happiness', query: 'positive psychology' }] },
  { label: 'Philosophy', emoji: '🤔', query: 'philosophy', kind: 'nonfiction',
    picks: [['Meditations', 'Marcus Aurelius'], ['The Republic', 'Plato'], ['Beyond Good and Evil', 'Friedrich Nietzsche'], ["Sophie's World", 'Jostein Gaarder'], ['The Myth of Sisyphus', 'Albert Camus'], ['Letters from a Stoic', 'Seneca'], ['Nicomachean Ethics', 'Aristotle'], ['The Consolations of Philosophy', 'Alain de Botton'], ['Tao Te Ching', 'Lao Tzu'], ['Thus Spoke Zarathustra', 'Friedrich Nietzsche'], ['The Problems of Philosophy', 'Bertrand Russell'], ['Enchiridion', 'Epictetus']],
    subgenres: [{ label: 'Stoicism', query: 'stoicism' }, { label: 'Ethics', query: 'ethics' }, { label: 'Existentialism', query: 'existentialism' }, { label: 'Eastern', query: 'eastern philosophy' }] },
  { label: 'Self-Help', emoji: '🌱', query: 'self-help', popular: 'nyt-advice', kind: 'nonfiction', shelfId: 'selfhelp',
    subgenres: [{ label: 'Habits', query: 'habits' }, { label: 'Productivity', query: 'productivity' }, { label: 'Mindfulness', query: 'mindfulness' }, { label: 'Confidence', query: 'confidence' }] },
  { label: 'Business', emoji: '💼', query: 'business', popular: 'nyt-genre-business', kind: 'nonfiction',
    picks: [['Good to Great', 'Jim Collins'], ['The Lean Startup', 'Eric Ries'], ['Zero to One', 'Peter Thiel'], ["The Innovator's Dilemma", 'Clayton M. Christensen'], ['Rich Dad Poor Dad', 'Robert T. Kiyosaki'], ['Start with Why', 'Simon Sinek'], ['The Psychology of Money', 'Morgan Housel'], ['Never Split the Difference', 'Chris Voss'], ['Shoe Dog', 'Phil Knight'], ['How to Win Friends and Influence People', 'Dale Carnegie'], ['The Intelligent Investor', 'Benjamin Graham'], ['Deep Work', 'Cal Newport']],
    subgenres: [{ label: 'Leadership', query: 'leadership' }, { label: 'Entrepreneurship', query: 'entrepreneurship' }, { label: 'Investing', query: 'investing' }, { label: 'Marketing', query: 'marketing' }] },
  { label: 'True Crime', emoji: '🕵️', query: 'true crime', popular: 'nyt-genre-crime', kind: 'nonfiction',
    picks: [['In Cold Blood', 'Truman Capote'], ["I'll Be Gone in the Dark", 'Michelle McNamara'], ['The Stranger Beside Me', 'Ann Rule'], ['Helter Skelter', 'Vincent Bugliosi'], ['Killers of the Flower Moon', 'David Grann'], ['The Devil in the White City', 'Erik Larson'], ['Midnight in the Garden of Good and Evil', 'John Berendt'], ['Say Nothing', 'Patrick Radden Keefe'], ['Bad Blood', 'John Carreyrou'], ['The Five', 'Hallie Rubenhold'], ['Columbine', 'Dave Cullen'], ['The Lost City of Z', 'David Grann']],
    subgenres: [{ label: 'Serial killers', query: 'serial killers' }, { label: 'Cold cases', query: 'cold cases' }, { label: 'Courtroom', query: 'courtroom true crime' }, { label: 'Fraud', query: 'fraud true story' }] },
  { label: 'Travel', emoji: '🧳', query: 'travel', popular: 'nyt-genre-travel', kind: 'nonfiction',
    picks: [['Into the Wild', 'Jon Krakauer'], ['Wild', 'Cheryl Strayed'], ['Eat, Pray, Love', 'Elizabeth Gilbert'], ['A Walk in the Woods', 'Bill Bryson'], ['Under the Tuscan Sun', 'Frances Mayes'], ['Into Thin Air', 'Jon Krakauer'], ['In Patagonia', 'Bruce Chatwin'], ['Travels with Charley', 'John Steinbeck'], ['A Year in Provence', 'Peter Mayle'], ['Notes from a Small Island', 'Bill Bryson'], ['The Lost City of Z', 'David Grann'], ['Vagabonding', 'Rolf Potts']],
    subgenres: [{ label: 'Adventure', query: 'adventure travel' }, { label: 'Hiking', query: 'hiking' }, { label: 'Europe', query: 'travel europe' }, { label: 'Asia', query: 'travel asia' }] },
];
