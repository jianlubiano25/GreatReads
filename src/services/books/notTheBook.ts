/**
 * Titles that are not the book itself. ONE place for the words, used by search ranking (a penalty) and by the Discover shelves (left out).
 *  - CORE: editions ABOUT a book (study guides, summaries, boxed sets).
 *  - SEARCH_EXTRA: more of the same kind that only the search penalises.
 *  - SHELF_EXTRA: exam and study-aid products (Educart CBSE Class 10 Science...) and bundles that Discover shelves leave out.
 *  - ACCESSORY: notebooks, planners, how-to-draw and colouring books; never part of a genre's results.
 */
const CORE = ['study guide', 'summary of', 'summary and analysis', 'summary &', 'workbook', 'analysis of', 'sparknotes', 'cliffsnotes', 'box(?:ed)? set', 'omnibus', 'bundle'];
const SEARCH_EXTRA = ['trivia', 'conversation starters', "lesson plans?", "teacher'?s? guide", 'readers? guide', 'large print', 'annotated', 'graphic novel adaptation', 'import and export market', 'world forecasts?', 'market (?:research|report|forecast)s?', 'industry report', '(?:19|20)\\d\\d (?:import|world|global|forecast)'];
const SHELF_EXTRA = ['collection', '\\d+ books?', 'educart', 'cbse', 'icse', 'ncert', 'isc', 'class (?:\\d+|x|xi|xii)', 'grade \\d+', 'sample papers?', 'question banks?', 'previous years?', 'mock tests?', 'exam(?:s|ination)?', 'jee', 'neet', 'mcqs?', 'syllabus', 'olympiad', 'board exams?', 'textbook', 'guide for', 'worksheets?', 'coloring book', 'activity book'];
const ACCESSORY_WORDS = ['note ?books?', 'planners?', 'sketch ?books?', 'colou?ring books?', 'activity books?', 'how to draw', 'drawing books?', 'log ?books?', 'calendars?', 'gift books?'];

const make = (...lists: string[][]) => new RegExp(`\\b(?:${lists.flat().join('|')})\\b`, 'i');
export const NOT_THE_BOOK = make(CORE, SEARCH_EXTRA);
export const SHELF_JUNK = make(CORE, SHELF_EXTRA);
const ACCESSORY = make(ACCESSORY_WORDS);
/** A notebook / planner / how-to-draw product, not a book of the genre. A novel actually called "The Notebook" (Nicholas Sparks) is a book. */
export const isAccessory = (title = ''): boolean => ACCESSORY.test(title) && !/^(?:the )?note ?book$/i.test(title.trim());
