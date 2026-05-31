// Imported as the very first side-effect import in smoke scripts that
// transitively load news-rss.ts, so the autorun guard is set before any
// other module in the graph executes.
process.env.NEWS_RSS_SKIP_AUTORUN = "1";
