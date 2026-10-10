/** Public face of the book system. Components import from here and never need to know which API a book came from. */
import { dropLegacyBookCaches } from './cache';
export * from './identity';
export { makeBook, genreFromSubjects, shrunkRating, hasRealSummary, isKnownGenre } from './model';
export { mergeBooks, dedupeBooks } from './merge';
export { searchBooks, searchRelevance } from './search';
export { resolveBook, type ResolveQuery, type Resolved } from './resolve';
export { enrichBookDetails, fetchBookMeta, fetchRatingSources } from './details';
export { chooseRating, knownRating, withKnownRating, ratingOf, setRating, inferRatingSource, otherRatings, starFills, RATING_SOURCE_LABEL, SUFFICIENT_RATINGS, type RatingPair, type SourceRating, type RatingSourceId } from './ratings';
export * from './covers';
export * from './quality';
dropLegacyBookCaches();
