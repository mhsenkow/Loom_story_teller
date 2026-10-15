// =================================================================
// Loom — Chart Recommendation Engine
// =================================================================
// Analyzes column metadata and sample data to produce a ranked list
// of chart suggestions. Each suggestion includes:
//   - A Vega-Lite spec (the "brain")
//   - A human-readable title and description
//   - A chart type tag for the UI
//   - A relevance score (higher = more interesting)
//
// Scoring heuristics:
//   - High distinct count on a nominal → good for grouping
//   - Two numeric cols with correlation → good scatter
//   - Temporal + numeric → good time series
//   - Numeric with wide range → good histogram
// =================================================================

// Implementation lives in ./recs/*; this file keeps the historical import path.

export { columnNameTokens } from "./columnClassify";
export { CHART_KIND_OPTIONS, type ChartKind, type ChartRecommendation, type YAggregateOption, Y_AGGREGATE_OPTIONS } from "./recs/types";
export { diversifyRecommendations, isMeasureColumn, stableLiveChartId } from "./recs/columns";
export { createChartRec, createScatterRec, fitEncodingToKind, parseChartKind, PART_TO_WHOLE_KINDS } from "./recs/createChartRec";
export { type StorySequence, getBestSuggestion, getTopSuggestions, recommend, recommendStorySequence } from "./recs/recommend";
export { type EncodingShuffleLocks, type RandomEncoding, applyEncodingLocks, chartKindDataSupport, getRandomChartAndEncoding, getRandomEncoding, randomEncodingToExtra, tryBuildRandomChartRec } from "./recs/random";
export { expandRecommendationsWithExtras, getRecommendationReason } from "./recs/expand";
export { type RecommendSourceStoryOptions, recommendSourceStory, recommendStreamStory } from "./recs/sourceStory";
export { SOURCE_SQL_SNIPPETS, STREAM_SQL_SNIPPETS } from "./recs/sqlSnippets";
