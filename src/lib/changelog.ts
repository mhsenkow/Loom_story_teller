// =================================================================
// Loom — Changelog ("What's new")
// =================================================================
// Newest release first. Shipping something user-visible? Add an entry
// at the top with a new `id` — returning users see the What's new modal
// once (before the discover scan), then it lives behind the quiet
// "What's new" links in the sidebar header, Settings, and Help.
// =================================================================

export interface ChangelogItem {
  title: string;
  detail: string;
}

export interface ChangelogRelease {
  /** Unique, sortable — bump for every release (date, plus a suffix if two ship the same day). */
  id: string;
  /** ISO date shown to people. */
  date: string;
  title: string;
  /** One line under the title. */
  summary?: string;
  items: ChangelogItem[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    id: "2026-10-26a-wordcloud",
    date: "2026-10-26",
    title: "Compare word clouds",
    items: [
      {
        title: "Cloud, Compare, or Grid",
        detail: "A word cloud can stay one spiral, lean each word toward the group where it counts more, or show one cloud per group on the same size scale. Pick Compare by, then Layout, in Encoding.",
      },
    ],
  },
  {
    id: "2026-10-25a-group",
    date: "2026-10-25",
    title: "Group a crowded color",
    items: [
      {
        title: "Group into",
        detail: "When color or shape has a hundred values, Encoding can chunk them. Numbers become ranges — 10 groups instead of every calorie. Categories keep the largest names and roll the rest into Other. The same control shows up on every chart that uses those channels, and it rides along in the share link.",
      },
    ],
  },
  {
    id: "2026-10-24c-share",
    date: "2026-10-24",
    title: "Links that show the chart",
    items: [
      { title: "Bigger chart in link previews", detail: "When you share a link on LinkedIn, X, Slack, iMessage and the rest, the preview card is now the chart drawn at the card's own wide shape, not a small copy of a tall chart in a big blank frame." },
      { title: "Readable link titles", detail: "Shared links get a headline-style title with the data source, so “name sized by total” arrives as “Name sized by total · pokemon”." },
      { title: "Mastodon, SeenU and Bluesky up front", detail: "The share list now leads with Mastodon, SeenU and Bluesky, then LinkedIn, then everywhere else in a compact grid." },
      { title: "SeenU that works on a computer", detail: "SeenU gets a 4:5 image sized for its feed. On phones it goes through the share sheet to the SeenU app; on a computer the image saves, the caption and link copy, SeenU opens, and a short checklist stays put with copy and save-again buttons." },
      { title: "More places to share", detail: "X, Reddit, WhatsApp and Telegram join the share list, each opening with your caption and the chart card ready." },
    ],
  },
  {
    id: "2026-10-24b-gallery",
    date: "2026-10-24",
    title: "Six more charts from the classics",
    items: [
      { title: "Browse every chart type", detail: "On a computer, the chart type picker opens a gallery: every type grouped by what it shows (compare, over time, spread, relationships…), each with a live preview of your data. Pick one and you get exactly what the preview showed." },
      { title: "Density curve", detail: "A smooth outline of where values pile up — no bin sizes to pick. Split by a group to compare shapes; small groups get a rug of the raw values." },
      { title: "Q–Q plot", detail: "Is it a bell curve? Sorted values against a normal curve, with the points that stray furthest highlighted." },
      { title: "Connected scatter", detail: "Two measures traced through time, with arrows and labeled start and end. Long histories fold into about 40 steps so the path stays readable." },
      { title: "Warming stripes", detail: "One band per period, colored cool below the average and warm above — a whole series at a glance." },
      { title: "Word cloud", detail: "Category names sized by count or value, packed together. Bigger words really are bigger values." },
      { title: "Mean ± CI dots", detail: "Each group's average with a 95% interval over its raw rows, plus the overall average for reference." },
      { title: "Discover finds them", detail: "Find something fun to chart now reaches all the newer chart types, and only offers each one where the data suits it: calendars for daily data, word clouds for real labels, intervals where groups have enough rows." },
      { title: "Sharper lines and dumbbells", detail: "A rolling mean now shows a ±1σ band around it, Compare Y shades who's ahead when both lines share a scale, and dumbbells point from start to end." },
    ],
  },
  {
    id: "2026-10-24a-charts",
    date: "2026-10-24",
    title: "Four new charts, tidier controls",
    items: [
      { title: "Calendar heatmap", detail: "Every day as a square — weeks across, weekdays down — so busy stretches and weekly rhythms stand out." },
      { title: "Nightingale rose", detail: "Polar wedges whose area tracks the value. Add a second category to stack it inside each petal." },
      { title: "ECDF", detail: "See what share of rows falls at or below each value, and compare medians and tails across groups without picking bin sizes." },
      { title: "Sparkline grid", detail: "One small trend per group, each on its own scale, so you compare shapes at a glance. Top N sets how many panels." },
      { title: "Slopes show direction", detail: "Slope lines that rise and fall now get their own colors, with a key that counts each. 3D bars, terrain, and firefly glows shade with your theme instead of plain black and white." },
      { title: "Controls that do something", detail: "The chart panel only shows options the current chart actually uses. Choices sit in compact segmented rows, sliders show their value beside them, and every dropdown is the same height." },
    ],
  },
  {
    id: "2026-10-23a-library",
    date: "2026-10-23",
    title: "A home for your data",
    items: [
      { title: "One data library", detail: "Find your uploads and saved combinations in one place. Collections hold datasets and charts together for a reason. Start one even before you name it. Search and filter collections and My data the same way as Discover — by topic, place, and how the data is kept. They leave if you don’t touch them — after 3, 6, or 9 months — or they can keep going. Hearts, marks, and curious notes stay as filters." },
      { title: "Keep useful datasets", detail: "Bookmark files, feeds and public catalog results. Bookmarked uploads and files used by combinations are protected from routine local cache cleanup." },
      { title: "Combine two sources", detail: "Match a primary dataset to a lookup table, check matched and unmatched rows, then save the recipe. Reopen it to rebuild from available source rows. Your chart keeps the result from the time you opened it." },
      { title: "Smoother everywhere", detail: "Buttons give a little when pressed, panels and sheets glide in from where they live, new chart ideas arrive in a short cascade, and switching charts settles the new one onto the stage. Segmented controls slide to the choice you press. Reduce motion in Settings still turns all of it off." },
      { title: "Just the chart", detail: "Full screen (F, or the corners button beside Share) slides the sidebar, panels, and bars away so the chart has the screen. Esc brings them back. Charts that animate in now grow up from the baseline." },
    ],
  },
  {
    id: "2026-10-22a",
    date: "2026-10-22",
    title: "Share anywhere",
    items: [
      { title: "Bluesky, Mastodon and SeenU", detail: "Share now opens Bluesky and Mastodon with your caption and chart link ready, and Mastodon remembers your server after the first time. SeenU gets the image, caption and link ready to post." },
      { title: "Instagram, sized right", detail: "Pick Post, Story or Message. Posts get a 4:5 image with your caption, Stories get a 9:16 frame that keeps the chart clear of Instagram's top bar and reply field (the link is copied for a link sticker), and Messages send the chart link." },
      { title: "Clearer choices", detail: "Every share option now says what will happen before you tap it, and Copy caption no longer sits on top of the preview." },
    ],
  },
  {
    id: "2026-10-21g-polish",
    date: "2026-10-21",
    title: "Polish pass",
    items: [
      { title: "Make the colors yours", detail: "Keep your favorite presets or edit individual swatches and gradient stops with a color picker or hex code. Fit a palette to your field’s value count, see when colors repeat, and browse presets without changing your chart. Custom colors travel with Undo, saved looks and shared charts; SVG exports now honor the selected palette." },
      { title: "Shared stories open again", detail: "“Open with shared data in Loom” links and refreshed snapshot pages now load the shared chart instead of an empty app." },
      { title: "Share fits on phones", detail: "The phone top bar no longer runs off the screen, so Share is always fully visible. Theme stays in Settings." },
      { title: "Years read as time", detail: "A year column in an uploaded spreadsheet now suggests trend lines over time, and text columns like incident type or created by stay categories instead of turning into empty time charts." },
      { title: "Catalog search on iPhone and iPad", detail: "Searching the open-data catalog works for popular queries on iPhone and iPad, not just the first time a search is run." },
      { title: "Clearer charts and readouts", detail: "Horizontal bars with only negative values fill the chart, and their value labels no longer cover the category names. Hovering long bars and wide bands always finds them, globes no longer show the previous chart’s readouts, and firefly charts answer hover." },
      { title: "Better first stories", detail: "Discover leads with each feed’s headline finding and only calls a leader “concentrated” when it really stands out. It no longer blames extreme values when repeated values are the real cause." },
      { title: "Pins on phones", detail: "Pinning a mark closes the floating readout so the pinned callout is the only one left, and the pin counter sits above the source note." },
      { title: "Share images stay current", detail: "After you change colors, theme, notes or pins, or the data refreshes, Share now creates a new image instead of reusing the old one." },
      { title: "Query keeps your SQL", detail: "Saved query views and Dive’s “Open in Query” now fill the editor, and Copy cell / Copy row copy the row you see after sorting." },
      { title: "Charts speak to screen readers", detail: "With a screen reader, arrow keys step through marks and each one is read aloud with its values. Pinning and unpinning are announced too." },
      { title: "Comfortable on phones", detail: "Banners, sheets and full-screen views stay clear of the notch and home indicator, and small buttons and story card text are bigger and easier to tap and read." },
      { title: "Messages in plain words", detail: "When a feed, file or import can’t load, Loom says what failed and whether you’re offline instead of showing a raw error." },
      { title: "Saving on iPhone and iPad", detail: "Save Image and Take Photo no longer close the app, saving a file opens the share sheet, and Loom only says something was saved when it really was." },
      { title: "Links open once", detail: "Links to data portals and other sites open a single time in your browser instead of twice or inside Loom." },
      { title: "Easier-to-read colors", detail: "Chart series, warnings, badges and focus rings have stronger contrast in every theme, including colorblind mode." },
      { title: "Steadier desktop app", detail: "Slow queries no longer stall live feeds on Mac, interrupted CSV downloads don’t leave half-written files, and SQLite files that can’t be opened explain why instead of disappearing." },
      { title: "Feeds ride out outages", detail: "When a data provider goes down, the web and iPhone apps show the last good copy instead of an error." },
      { title: "Back where you left off", detail: "Reopening Loom resumes your saved live feed again and tells you if it comes back empty." },
      { title: "Shared charts match", detail: "Chart links keep the sender’s options such as top N, log scale and comparisons, and times line up the same in every time zone." },
      { title: "Tidier charts", detail: "Sunburst inner rings stay inside their wedges, the top ridgeline fits on the chart, and hovering parallel coordinates picks the line under your pointer." },
    ],
  },
  {
    id: "2026-10-21f",
    date: "2026-10-21",
    title: "Point at what matters",
    items: [
      { title: "Every mark lights up", detail: "Hover or arrow-key through any chart and the bar, point, slice, cell or path you're on gets a clear highlight shaped to the chart: rings for points, outlines for bars, edges for slices, a soft wash for bands. Maps, globes, terrain, weaves and trail charts now answer hover too." },
      { title: "Pin it, share it", detail: "Click a mark (or press Enter, or tap Pin on your phone) to keep its readout on the chart. Up to five pins, numbered. They're drawn into exported images and saved in share links, so whoever opens your chart sees exactly what you were pointing at." },
    ],
  },
  {
    id: "2026-10-21e",
    date: "2026-10-21",
    title: "Feeds that take a rest",
    items: [
      { title: "No more dead-end feeds", detail: "When a data provider has been down for hours, Loom marks its feed Resting: What's interesting and the Digest skip it, and its card says when it last worked instead of spinning into an error. You can still Try anyway." },
    ],
  },
  {
    id: "2026-10-21d",
    date: "2026-10-21",
    title: "A sharper mix of ideas",
    items: [
      { title: "Every chart type in the mix", detail: "What's interesting right now can now reach all 60 chart types when the data fits — including globe trails, arc maps and trail ribbons, which follow one moving thing (a flight, the ISS, a state over the years) instead of joining unrelated points." },
      { title: "No more squashed charts", detail: "When one giant value (say, Bitcoin's market cap) would crush every other point into a corner, that chart is skipped. Relationship notes now say when a correlation is driven by a few extreme values." },
    ],
  },
  {
    id: "2026-10-21c",
    date: "2026-10-21",
    title: "Fireflies in daylight",
    items: [{ title: "Readable, meaningful glow", detail: "Firefly charts now stay legible in light themes, with clearer axes and separated labels. Steady glow follows Size or an actual time field; arbitrary twinkling and row-order brightness are gone." }],
  },
  {
    id: "2026-10-21b",
    date: "2026-10-21",
    title: "Six more feeds to pick apart",
    summary: "Nobel prizes, trivia, Pokémon, the Met collection, food labels, and radio — plus a Digest view in Data & sources.",
    items: [
      { title: "Culture & learning feeds", detail: "Connect Nobel laureates, Open Trivia questions, Gen‑1 Pokémon stats, a daily sample of the Met collection, Open Food Facts products, and top internet radio stations. Same Connect → Explore path as every other live feed." },
      { title: "Digest or Directory", detail: "In Data & sources, Digest shows a short newspaper-style shortlist of feeds worth opening; Directory keeps the full searchable listing." },
    ],
  },
  {
    id: "2026-10-21",
    date: "2026-10-21",
    title: "Moments worth sharing",
    summary: "Watch a number in one sentence, hear about it anywhere, and share what happened.",
    items: [
      { title: "Quick Watch", detail: "Tap the bell on a chart: \"Tell me when the highest magnitude goes above 6.\" Drag the line on the chart, see how often it would have fired, pick what you'll do, done. Every suggestion and example opens the same way." },
      { title: "Moments", detail: "Each alert keeps a card of what happened: the number, the limit, and the history that led up to it. Share it as a link, post it to NeoSpace in one tap, save the image, or jump back to the chart. Monitors can share their moments automatically." },
      { title: "Your phone in one scan", detail: "Where alerts go → Your phone makes a private ntfy topic and shows a QR code. Install the free ntfy app, scan, and always-on alerts arrive on your phone." },
      { title: "Push to this browser", detail: "Always-on alerts can arrive as real browser notifications even with Loom closed, including on iPhone when Loom is on your Home Screen." },
      { title: "A public page and RSS", detail: "Publish a live status page of your always-on monitors with their moments, plus an RSS feed you can plug into Slack, Zapier, IFTTT or any reader." },
      { title: "Little things", detail: "A chime when something fires, and the tab title shows how many alerts are waiting." },
    ],
  },
  {
    id: "2026-10-20b",
    date: "2026-10-20",
    title: "Watch it so you don't have to",
    summary: "Monitor any live feed on a schedule, and hear about it only when it matters.",
    items: [
      { title: "Charts that follow your choices", detail: "Heatmaps and hexbins can show a numeric measure as well as counts. Signed stacks, reversed bars, log axes, and facet scales read more faithfully; visual controls honor explicit choices. Encoding edits keep your headline, notes, and reference lines, with Undo and Redo." },
      { title: "See the line you're watching", detail: "The monitor editor charts your number over the feed's recent history with the rule drawn on top. Drag the limit and it tells you how often it would have alerted. Limits also appear on matching charts, and Monitor suggests watches for whatever feed you have open." },
      { title: "Monitor this chart", detail: "Tap the bell beside any live-feed chart, or \"Alert me when this happens\" in Analyze → Anomaly detection. The monitor watches the same measure and lookback, and every card and alert opens that chart again." },
      { title: "Monitors tied to a decision", detail: "Open Monitor (key 5), pick a feed and a number, and say what you'll do when it fires. Start from examples like a big earthquake, a dirty grid hour, or city heat health." },
      { title: "Unusual isn't the same as wrong", detail: "Choose a limit, a healthy range, a sudden change, or \"unusual for this hour\". Add expected windows for maintenance or planned events. When you mark an alert as expected, Loom stops alerting at that time." },
      { title: "Was it worth it?", detail: "Each alert asks what happened next. Cards show how often alerts led to action and flag monitors that are mostly noise. Related metrics group into scorecards." },
      { title: "Schedules and notifications", detail: "Check every few minutes, daily, weekly, or on a cron schedule, with quiet hours and reminder cooldowns. Alerts arrive as system notifications on Mac, iPhone, iPad, and in the browser." },
      { title: "Always on", detail: "Mark a monitor Always on and Loom's server keeps checking it on its schedule (as often as every 15 minutes), even when the app is closed. Alerts go to an ntfy topic on your phone, Slack, Discord, or a webhook." },
    ],
  },
  {
    id: "2026-10-20",
    date: "2026-10-20",
    title: "Eighteen new live feeds",
    summary: "Fireballs to Powerball: more of the world to chart, all free and open.",
    items: [
      { title: "Sky and space", detail: "Fireballs caught by government sensors since 1988, and the satellites bright enough to see tonight with their orbits worked out." },
      { title: "The internet, live", detail: "Country-level internet outages, a few seconds of live BGP routing each minute, a Bluesky pulse of posts per minute by language and hashtag, GitHub activity, and the newest arXiv papers. Bluesky and GitHub keep only counts and repository names — no posts or people." },
      { title: "Safety and government", detail: "FDA food, drug, and device recalls; vehicle recalls; federal lobbying filings; and every federal agency's budget this year." },
      { title: "Cities", detail: "US airport delays and ground stops, NYC restaurant inspections and parking tickets (no plates), Chicago crime reports, and bike share docks in Chicago, DC, and San Francisco." },
      { title: "Just for fun", detail: "Trending books from Open Library and Project Gutenberg, and every Powerball draw since 2010." },
      { title: "Wikipedia reverts", detail: "New Query snippets on the Wikipedia stream find reverts and pages that look like edit wars." },
    ],
  },
  {
    id: "2026-10-18b",
    date: "2026-10-18",
    title: "More than one way forward",
    summary: "Compare forecast methods in a focused reading panel, and the chart follows the one you choose.",
    items: [
      { title: "A curtain for the hard part", detail: "Forecast and anomaly explanations now open as a full-height panel on the right. The rest of Loom dims so the reasoning can be read from top to bottom." },
      { title: "Four forecasts, none of them universal", detail: "Keep the straight line, or switch to the last value, a recent trend, or a repeated cycle. Each choice explains when it holds, when it misleads, and how its shaded range is only an approximation." },
    ],
  },
  {
    id: "2026-10-18",
    date: "2026-10-18",
    title: "See what comes next",
    summary: "Forecast a line, mark what stands out, and give bars and pies a quieter finish.",
    items: [
      { title: "Analyze what comes next", detail: "Add a forecast and uncertainty band, flag unusual points, or mark events alongside a line chart. Chart now groups Encoding, Visual, Analyze, and Overlays in one icon-labeled tab strip. Analyze cards keep controls simple and reveal the calculation code on demand; Overlays adds timing and context. First-draft layers appear in PNG captures and last for this session." },
      { title: "Material, with restraint", detail: "Bars and pies inherit subtle glazed, satin, printed, or etched finishes. Theme-specific grid weight and title weight add character; data cube walls stay close to the chart surface. The toolbar theme button now cycles looks with a distinct icon for each." },
    ],
  },
  {
    id: "2026-10-17c",
    date: "2026-10-17",
    title: "Themes that carry through",
    summary: "One palette button restyles the workspace, the charts, and the type.",
    items: [
      { title: "Palette controls that agree", detail: "Automatic density colors and scale choices respect colorblind defaults. Palette previews follow the current theme, explicit choices stay selected, and device-font fallbacks are clearly labeled." },
      { title: "A proper stage for every chart", detail: "Previews and full charts now share a theme-specific plotting surface. NES keeps its blue workspace with clean, bright chart cards and crisp frames; dialogs and sharing sheets respect your chosen corner geometry." },
      { title: "Linework with character", detail: "Line endings and corners now follow the theme, including chart previews, Dive, and SVG defaults. Choose rounded, flat, or square ends and rounded, beveled, or sharp corners in Visual → Marks. Large axis values now fit using trillions or scientific notation." },
      {
        title: "Type and texture, together",
        detail: "Follow theme pairs typeface and chrome as you switch looks. Source Sans 3, Source Serif 4, and IBM Plex Mono are available for the app and charts. Subtle surface shadows and icon weights reflect each theme; mobile Settings keeps chart tooltips behind the sheet.",
      },
      {
        title: "A theme that carries through",
        detail: "Switch themes with the palette button in Discover. Automatic chart colors now follow your theme, from story previews to the full canvas. Marks inherit crisp, soft, or geometric styling while your own Visual choices stay yours.",
      },
    ],
  },
  {
    id: "2026-10-17b",
    date: "2026-10-17",
    title: "Emoji on more charts",
    summary: "More charts can carry a symbol per category, and Discover’s controls sit where you can reach them.",
    items: [
      {
        title: "Pick a symbol for each category",
        detail: "Bubble, line, radar, lollipop, isometric scatter, beeswarm, slope, and bump charts now have Emoji from column and Shape by category under More channels. Each value gets its own emoji, and the key shows which is which.",
      },
      {
        title: "Change the points on a line",
        detail: "Visual → Marks sets one marker for every point: a shape or an emoji, and its size. On a line with no color split, an emoji column draws one line per category.",
      },
      {
        title: "No more letters",
        detail: "A column without a saved set of emoji gets real symbols, not the first letter of each name. Busy charts switch to shapes once there are too many points for emoji.",
      },
      {
        title: "Discover’s controls moved up",
        detail: "Card size and Flow, Tiles, Masonry, and List sit with refresh and close. The filters stay on one line with the title, and the search field is larger.",
      },
    ],
  },
  {
    id: "2026-10-17",
    date: "2026-10-17",
    title: "A newspaper you can scan",
    summary: "Discover reads in one glance, and globes show the whole planet.",
    items: [
      {
        title: "Stories, then the fine print",
        detail: "Each card keeps one quiet line for how fresh it is, how many rows it covers, and where the data came from. The headline and the chart stay in front.",
      },
      {
        title: "The page reads like a sentence",
        detail: "What’s interesting right now sits with the filters in one line: showing a perspective, in a topic, from a source. Search lives at the lower right, where a thumb can reach it. S, M, and L change how large the cards are, and the page mixes a lead story with wider and shorter ones.",
      },
      {
        title: "Each symbol keeps its name",
        detail: "When a chart uses emoji, the side panel lists the symbol next to what it means. Changing one keeps the others. The panel is wider so those names, and the tooltip fields, have room.",
      },
      {
        title: "Globes show every country",
        detail: "Spinning a globe, or any map of latitude and longitude, draws the world. In Basemap you can switch to a more detailed world, US states, or US counties when the story is local.",
      },
    ],
  },
  {
    id: "2026-10-16i",
    date: "2026-10-16",
    title: "Give every point a shape or a face",
    summary: "Scatterplots and point maps can speak with silhouettes, category shapes, and emoji.",
    items: [
      {
        title: "Fresh discoveries, expressive charts",
        detail: "Discover now considers category shapes and meaningful emoji for weather, disasters, transit, and fire observations. Previews, legends, and shared links keep the same symbols. While Loom is open, a rotating scan checks the whole source catalog on each feed’s cadence. Real changes wait behind New data ready; unchanged checks stay quiet, and recently updated data gets a highlight.",
      },
      {
        title: "More ways to find something interesting",
        detail: "Discover considers all 59 chart types, then balances useful signals with a broader mix of sources and questions. Browse eight perspectives, see measured evidence on each pick, and explore related views together. Trends need real history; stronger charts get more room. Flow keeps a newspaper mix of large and small cards on a wide desktop, and phones consider the same breadth before choosing their picks.",
      },
      {
        title: "A broader marker palette",
        detail: "Choose circles, pills, dashes, polygons, rings, pins, and more from a visual grid — or use a curated emoji for every point.",
      },
      {
        title: "Shape and emoji from data",
        detail: "Shape by category cycles groups through readable silhouettes. Emoji from column draws each row’s first complete symbol, with matching legends and shared-link support.",
      },
    ],
  },
  {
    id: "2026-10-16h",
    date: "2026-10-16",
    title: "Flip a channel, and a quieter Encoding header",
    summary: "A large number can draw as a small mark. Chart type gets the full width of the panel.",
    items: [
      {
        title: "High can mean small",
        detail: "On Size, Color, Depth, Glow, Outline, and Opacity, ↕ flips the direction. A large value draws small, or takes the low end of the color ramp.",
      },
      {
        title: "Chart type on its own row",
        detail: "The type menu spans the panel. Shuffle and Random sit underneath. A small lock marks the channels that stay put while you shuffle.",
      },
    ],
  },
  {
    id: "2026-10-16g",
    date: "2026-10-16",
    title: "The preview is the chart",
    summary: "A shared link carries a large picture that Threads, LinkedIn, Slack, iMessage, and the rest can show.",
    items: [
      {
        title: "One picture, every network",
        detail: "The chart fills the card. Share again so the new link can unfurl with that picture.",
      },
      {
        title: "Every US state, year by year",
        detail: "New in Data & sources → United States: population, income, poverty, education, and unemployment for all 50 states, DC, and Puerto Rico since 2012, plus the US economy month by month since 1990 — unemployment, inflation, jobs, rates, housing starts, and gas prices. Both come from federal statistics via USAFacts and open on a state map or a trend line.",
      },
      {
        title: "Love, save, or hide a source",
        detail: "Tap ♡ on a feed or pack to see more of it in Discover, the sidebar, and search. Save it with the bookmark, or use ⋯ for Less like this and Hide. Data & sources now has search, Topic / Where / Freshness filters, and a Saved group. Manage them all in Settings → Your sources.",
      },
    ],
  },
  {
    id: "2026-10-16f",
    date: "2026-10-16",
    title: "Share links name the chart",
    summary: "A shared chart lives at loom.ibm.io/plot/your-title/… so the address says what it is.",
    items: [
      {
        title: "A plot, not a code",
        detail: "New links look like loom.ibm.io/plot/correlation-matrix/…. Share again to get one. Older /s/ links still open.",
      },
    ],
  },
  {
    id: "2026-10-16e",
    date: "2026-10-16",
    title: "The story page is the chart",
    summary: "A shared link shows the same chart image, and Threads can read that picture for the preview.",
    items: [
      {
        title: "The picture you shared",
        detail: "The public page is the chart from Share, not a redraw. Share again to replace an older link.",
      },
      {
        title: "Preview without a Facebook app",
        detail: "Threads and Facebook read the public chart image. No developer account is required. Share again so the new link can unfurl.",
      },
    ],
  },
  {
    id: "2026-10-16c",
    date: "2026-10-16",
    title: "Share keeps the chart you see",
    summary: "Share uses the chart on screen, then one button opens Instagram, Facebook, LinkedIn, Threads, or email.",
    items: [
      {
        title: "Same chart, not a new crop",
        detail: "The preview is the chart you already have open. Square, Story, and Wide sizes stay under Other sizes.",
      },
      {
        title: "One Share button",
        detail: "Share lists Instagram, Facebook, LinkedIn, Threads, and email. Copy caption sits in the corner of the image.",
      },
    ],
  },
  {
    id: "2026-10-16b",
    date: "2026-10-16",
    title: "Chart hover stays on the chart",
    summary: "Hovering an axis, title, or legend outlines it. The side panel opens and highlights the matching control only when you click.",
    items: [
      {
        title: "Click to open, hover to preview",
        detail: "A closed panel stays closed while you move across the chart. Click the outlined region to open Encoding and jump to that control. If the panel is already open, the click is what rings and scrolls it.",
      },
      {
        title: "LinkedIn, Threads, and Instagram from the link",
        detail: "After Share or Get link, the result offers LinkedIn (chart card plus a caption to paste), Threads (caption and link), and Instagram (the image). On iPad, LinkedIn and Threads open in Safari and Instagram uses the share sheet. On Mac, saving the image also publishes the link, then LinkedIn and Threads open in your browser and Instagram puts the PNG in Finder.",
      },
    ],
  },
  {
    id: "2026-10-16a",
    date: "2026-10-16",
    title: "Type that follows your chart",
    summary: "Readable labels, thoughtful font choices, and consistent typography from chart to export.",
    items: [
      {
        title: "More room for your chart",
        detail: "Auto width uses the whole center panel, and plots leave only the space their labels need on each side. Visual → Layout adds Auto, Fill, and Roomy space choices that stay distinct on phones. Fixed device previews and manual arrangements stay available; Restore automatic sizing brings a shrunken canvas back to fit.",
      },
      {
        title: "Labels that hold together",
        detail: "Long labels wrap without splitting emoji or accented characters. Cube tables and pinned values follow your chart’s type, with clearer headers and shaded-cell contrast. Phone What’s interesting titles stay at least 12px. Correlation and heatmap numbers keep the chart type size or stay off the cell. Readouts stay inside the screen, the live type sample reflects your title styling, and floating tools stay clear of the phone editor.",
      },
      {
        title: "One place to tune your chart’s type",
        detail: "Visual → Typography now groups font family, chart text size, title weight, and italics with a live sample. All chart families follow the selected font and size, including map keys, 3D labels, tooltips, notes, and exports. Choose App typeface to follow Settings.",
      },
      {
        title: "Clearer at every size",
        detail: "Chart labels have a readable minimum, larger text stays large on phones, and crowded charts space or skip labels instead of shrinking them. Stronger contrast, full correlation headers, and wrapping field names make the panels easier to read. Settings groups sans, serif, and monospace choices, with device fallbacks or optional font downloads.",
      },
    ],
  },
  {
    id: "2026-10-15j",
    date: "2026-10-15",
    title: "Find your next story",
    summary: "Daily picks, instant reopening, and a richer chart gallery that fits your phone.",
    items: [
      {
        title: "Your place, your perspective",
        detail: "Back to stories restores your filters, layout, and scroll position. Related charts share one card with a perspective picker, and technical field names read more naturally. Each card shows its own check age; due feeds refresh quietly, with updates ready when you choose to show them.",
      },
      {
        title: "Fresh each day, quick every time",
        detail: "Saved picks reopen without another scan. Loom refreshes them in the background on a new day while the app is open, keeps older picks usable during the update, and reconnects a selected feed after its chart is already on screen. Refresh is always available when you want it.",
      },
      {
        title: "More ideas on your phone",
        detail: "Compact previews and smaller type fit three columns on wider phones, with two on narrow screens. Filters stay tucked away until you need them.",
      },
      {
        title: "More perspectives, less hunting",
        detail: "Switch between Flow, square Tiles, Masonry, and List. Larger stories continue down the Flow layout, and more ideas load automatically as you approach the bottom. A smaller toolbar leaves more room for charts; search by topic, source, chart, or setting, and filter for comparisons, time windows, small multiples, and trends.",
      },
      {
        title: "Know what you’re opening",
        detail: "Cards show their row coverage and observation dates. Opening a chart preserves its previewed snapshot and settings; Source & data takes you to its provenance. Comparisons with different units use separate scales without a misleading difference label.",
      },
      {
        title: "Previews that stay true to the data",
        detail: "Fresh snapshots keep their own thumbnail data. Counts, averages, scales, and mirror settings now carry through to previews more faithfully.",
      },
    ],
  },
  {
    id: "2026-10-15i",
    date: "2026-10-15",
    title: "More compare charts in What’s interesting",
    summary: "World Bank, countries, crypto, air quality, HN, and weather now lead with mirror / dumbbell / slope — and short lists reserve half the slots for them.",
    items: [
      {
        title: "Curated dual-measure stories",
        detail: "Feeds with two numeric measures get ready-made pyramid, dumbbell, and slope cards with Δ labels — not just COVID.",
      },
      {
        title: "Discover ranks compares higher",
        detail: "Alt cards prefer those kinds after the primary hook, with a score bump so they don’t sink under bars and maps. Missing fills pick a stable category + measure pair instead of a random shuffle.",
      },
    ],
  },
  {
    id: "2026-10-15h",
    date: "2026-10-15",
    title: "What’s interesting shows compare charts",
    summary: "Mirror pyramids, dumbbells, slopes, and Δ variants stay in the discover rail — even on phone’s shorter list.",
    items: [
      {
        title: "Complex compares aren’t truncated away",
        detail: "Discover keeps one of each priority compare kind (pyramid, dumbbell, slope, bump, Pareto, …) in the first cards per feed, and phones get eight variants per source instead of six.",
      },
      {
        title: "Scale and Δ ideas in the rail",
        detail: "Suggestion expand adds same-scale / separate-scale pyramid copies and Δ / % labels on slope and dumbbell, and promotes dual-measure bars into those chart types when the schema fits.",
      },
    ],
  },
  {
    id: "2026-10-15g",
    date: "2026-10-15",
    title: "Delta compare across charts",
    summary: "Show Δ or % change on dumbbell, slope, and pyramid — and earlier-half overlays now work on bars too.",
    items: [
      {
        title: "Delta on dual-measure charts",
        detail: "Encoding → Delta adds signed change (Δ) or percent on dumbbell, slope, and mirror pyramid so Start→End / Left→Right isn’t only in the tooltip.",
      },
      {
        title: "Earlier-half overlay on bars",
        detail: "Ordered bar charts can ghost the first half of categories onto the later half — the same compare pattern line and area already had.",
      },
    ],
  },
  {
    id: "2026-10-15f",
    date: "2026-10-15",
    title: "Mirror pyramid scales you can trust",
    summary: "Same scale, separate scales, or Auto — plus Top N, aggregate, and swap for opposing-bar charts.",
    items: [
      {
        title: "Same vs separate scales",
        detail: "Mirror pyramid Encoding now has Scale: Auto (separate when magnitudes diverge ~5×), Same (comparable bar lengths), or Separate (each arm keeps its own domain). The chart labels which mode is active.",
      },
      {
        title: "Top N, aggregate, swap",
        detail: "Cap categories, sum/mean/min/max across rows (handy when Category is continent), and Swap Left ↔ Right. Hover hits land on the bars, not a fake scatter.",
      },
    ],
  },
  {
    id: "2026-10-15e",
    date: "2026-10-15",
    title: "Sharper charts on every screen",
    summary: "Retina and phone stages stay crisp without melting the GPU; dense scatters paint leaner on phones.",
    items: [
      {
        title: "Pixel-perfect chart stage",
        detail: "Charts cap on-screen pixel density and size the canvas from the browser’s device-pixel box, so iPhone 3× and big iPads stay sharp without huge buffers. Exports still use the full capture resolution.",
      },
      {
        title: "Phone density that keeps up",
        detail: "Dense scatter / bubble / hexbin ideas draw fewer points on phones for steadier touch FPS, with a compact status strip and safer idea-rail swipe scrolling.",
      },
      {
        title: "Gatekeeper stays quiet",
        detail: "Desktop Loom still refuses unsigned DuckDB extension downloads. Opening Parquet/JSON/Excel without helpers now explains the CSV workaround instead of a raw engine error.",
      },
    ],
  },
  {
    id: "2026-10-15d",
    date: "2026-10-15",
    title: "No more macOS “extension Not Opened” alerts",
    summary: "Desktop Loom no longer downloads unsigned DuckDB extensions that Gatekeeper blocks.",
    items: [
      {
        title: "Gatekeeper stays quiet",
        detail: "On launch we used to auto-install parquet/json/excel helpers into ~/.duckdb. Those binaries aren’t Apple-signed, so macOS showed “Not Opened” dialogs. Loom now refuses that download path; CSV keeps working, and we’ll ship signed helpers later for Parquet/JSON/Excel.",
      },
    ],
  },
  {
    id: "2026-10-15c",
    date: "2026-10-15",
    title: "Data chip on What’s interesting",
    summary: "Hover any card’s Data link for a short source TLDR; click it to inspect the feed.",
    items: [
      {
        title: "Where this data is from",
        detail: "Each What’s interesting card has a quiet Data control. Hover for a one-line TLDR and credit; click to open the feed with Stats (provenance + columns). The rest of the card still opens the chart.",
      },
    ],
  },
  {
    id: "2026-10-15b",
    date: "2026-10-15",
    title: "Terrain Direction and isometric axes",
    summary: "Fake-3D charts get a Direction control, Height on the right channel, and axes that sit on the diamond floor.",
    items: [
      {
        title: "Direction for terrain & iso charts",
        detail: "Terrain, isometric bars, and isometric scatter join the Direction chips — rotate or flip the fake-3D floor (and bar grow) instead of only flat bar charts.",
      },
      {
        title: "Height is Height",
        detail: "Terrain Height maps to the Z channel (kept through Shuffle / Random). Older shares that stored height on Size still render.",
      },
      {
        title: "Axes on the diamond",
        detail: "Floor and height ticks follow the isometric projection so labels stay even with the bars and cells — not a separate flat L-frame.",
      },
    ],
  },
  {
    id: "2026-10-15a",
    date: "2026-10-15",
    title: "Encoding that stays out of the way",
    summary: "Clearer channel controls, a movable key that shares cleanly, and source info where you want it.",
    items: [
      { title: "Arrange your canvas", detail: "Move and resize chart titles, legends, plots and notes directly on the canvas. Resize the frame, nudge with the keyboard, snap to edges or center, and undo each gesture in one step. PNG shares keep your arrangement." },
      {
        title: "Help behind ⓘ tips",
        detail: "Long Encoding essays for Facet, Split, Direction, Glow, and friends move into small info tips so the panel stays scannable.",
      },
      {
        title: "Keep vs Pin, clearly",
        detail: "Encoding and Visual both use Keep chips for shuffle (⟳ / ✦ / Shuffle look). Color’s old orphan lock is now Pin across types — a different job.",
      },
      {
        title: "Size where it matters",
        detail: "Bubble, map, and glyph charts keep Size in the main Channels list instead of burying it under More.",
      },
      {
        title: "Move the key, keep the link",
        detail: "The Arrange icon lives with the other chart tools (Refresh, Save…). Drag title, legend, and plot — placement rides along in the share link.",
      },
      {
        title: "Source info in the header or footer",
        detail: "Visual → Source / time info can sit under the title or under the plot — credit, date range, and color ramp move together.",
      },
    ],
  },
  {
    id: "2026-10-15",
    date: "2026-10-15",
    title: "What’s new opens again",
    summary: "See what’s new from Settings, Help, and the sidebar — the changelog modal no longer stays silent.",
    items: [
      {
        title: "See what’s new works",
        detail: "Tapping See what’s new (or What’s new in the sidebar) opens the changelog every time, including after you’ve already read the latest notes.",
      },
    ],
  },
  {
    id: "2026-10-14b",
    date: "2026-10-14",
    title: "Make a look yours",
    summary: "Save favorite styles, explore without losing your place, and find visual controls faster.",
    items: [
      { title: "More touch controls", detail: "Reorder table columns with arrow buttons on phones, tap values to exclude them in Dive, and swap cube axes with larger controls and a tap hint." },
      { title: "Your own look library", detail: "Save up to 20 named looks in Visual → My looks. Apply them to any chart, update them as your style evolves, and carry them to another device in a workspace backup." },
      { title: "Undo and Redo while you edit", detail: "The chart panel keeps history controls in reach. Restore fields, styling, titles, notes and reference lines together; rapid slider changes are grouped. Use ⌘/Ctrl Z and ⌘/Ctrl Shift Z outside text fields." },
      { title: "A calmer visual editor", detail: "Expand only the sections you need, or expand and collapse them all. Search color palettes by name, source or scale; clicking chart controls opens the corresponding section." },
    ],
  },
  {
    id: "2026-10-14a",
    date: "2026-10-14",
    title: "Smoother column picking",
    summary: "Search and choose chart fields comfortably on a keyboard or a small screen.",
    items: [
      {
        title: "Column menus stay in reach",
        detail: "Field menus open above or below the control to fit the visible screen, including when the phone keyboard is open.",
      },
      {
        title: "Reliable keyboard selection",
        detail: "Arrow keys skip incompatible fields; Home and End jump through results. Type filters remain keyboard accessible, and screen readers distinguish the selected column from the highlighted result.",
      },
    ],
  },
  {
    id: "2026-10-13q",
    date: "2026-10-13",
    title: "What’s interesting — sharper, fuller",
    summary:
      "Live Discover waits for feeds to load, ranks with clearer headlines, and map thumbs no longer crash before the atlas arrives.",
    items: [
      {
        title: "More feeds in Discover",
        detail:
          "Scanning waits for each live source to return rows instead of giving up after a short tick — reopen What’s interesting for a fresh scan.",
      },
      {
        title: "Stronger story hooks",
        detail:
          "Quakes, crypto, weather, and more lead with severity and context, with a balanced mix of topics at the top.",
      },
      {
        title: "Map previews stay calm",
        detail:
          "Globe and map cards load the world atlas in the background instead of erroring on first paint.",
      },
    ],
  },
  {
    id: "2026-10-13p",
    date: "2026-10-13",
    title: "See board, hide board",
    summary:
      "Dashboards drop the confusing Expand labels — one See board / Hide board toggle, boards pick first, then slots.",
    items: [
      {
        title: "Clearer board language",
        detail:
          "Pick a board, toggle See board. Hide board returns you to editing. New boards get unique names automatically.",
      },
    ],
  },
  {
    id: "2026-10-13o",
    date: "2026-10-13",
    title: "Dashboards easier on a tablet",
    summary:
      "Slots sit up top after you save, Add buttons are finger-sized, and Update/Export tuck into a quiet drawer.",
    items: [
      {
        title: "Board first",
        detail:
          "Active slots and layout come before the long saved-views list. Deletes and reorder stay visible without hover.",
      },
    ],
  },
  {
    id: "2026-10-13n",
    date: "2026-10-13",
    title: "Save, go to Dashboards",
    summary:
      "Save a chart view and jump straight to Dashboards — or just save. Why and Data now open beside the cell so you can see them.",
    items: [
      {
        title: "Save · Save and go",
        detail:
          "Name the view, then Save, or Save and go to Dashboards to place it on a board.",
      },
      {
        title: "Why + Data tables",
        detail:
          "The ? card explains the recommendation next to the rail. The grid opens a real values table over the stage.",
      },
    ],
  },
  {
    id: "2026-10-13m",
    date: "2026-10-13",
    title: "Chart as a floating cell",
    summary:
      "Save and Refresh sit as icon actions beside the plot. Time chips match the window the chart actually uses.",
    items: [
      {
        title: "Cell chrome",
        detail:
          "The stage treats the chart like a cell — soft float, shadow, and a glass icon rail for redraw, save, data table, why, and title.",
      },
      {
        title: "Honest time chips",
        detail:
          "If a chart is already sliced to last 24h, the View strip highlights 24h — not All. Link only shows when brush can apply.",
      },
    ],
  },
  {
    id: "2026-10-13l",
    date: "2026-10-13",
    title: "One view, both surfaces",
    summary:
      "Explorer and Chart share a living cohort — brush, filters, sort, and time window — with a quiet Reset view strip, color lock, column explain, and a mic on ⌘K.",
    items: [
      {
        title: "Brush both ways",
        detail:
          "Lasso or shift-drag on the chart filters the table when Link is on. Select rows in Explorer, then Show selected. Esc clears the cohort brush.",
      },
      {
        title: "Shared time · color lock · explain",
        detail:
          "Last 24h / 7d / 30d chips sit on both surfaces. Lock color in Encoding (or say “color by site”). Right-click Explain column — or ⌘K “explain discharge_cfs”.",
      },
      {
        title: "Speak to search",
        detail:
          "The glass field has a mic — say “distribution” or “over time” and Loom ranks the same vernacular intents.",
      },
    ],
  },
  {
    id: "2026-10-13k",
    date: "2026-10-13",
    title: "Search talks like analysis",
    summary:
      "⌘K understands data-science and everyday chart talk — “distribution”, “over time”, “share of total”, “map it”, “tufte”, “site vs discharge” — and jumps to the right chart, look, or action.",
    items: [
      {
        title: "Say what you mean",
        detail:
          "Phrases map to chart types and options (log Y, stacked %, residuals, rolling average). Named columns become encodings when you type “X vs Y”.",
      },
      {
        title: "Looks and chores too",
        detail:
          "Try tufte / clarity, clear filters, deep scan, encoding, or export — same glass field as dataset search.",
      },
    ],
  },
  {
    id: "2026-10-13j",
    date: "2026-10-13",
    title: "Explorer filters follow you to Chart",
    summary:
      "Column filters, anomaly filters, and sort from Explorer now shape the Chart (and Preview). Search also finds saved uploads and open-data datasets by name.",
    items: [
      {
        title: "Same cohort on Chart",
        detail:
          "Filter or sort in Explorer, switch to Chart — the plot uses that filtered set. The row count says “filtered” when a table filter is active.",
      },
      {
        title: "Search opens datasets",
        detail:
          "⌘K: type a file or catalog name — Loom matches Recent, saved uploads, live sources, and Data.gov / data.gov.uk CSVs, then opens them.",
      },
    ],
  },
  {
    id: "2026-10-13i",
    date: "2026-10-13",
    title: "Search & commands beside Tools",
    summary:
      "A glass search next to the Tools waffle (or ⌘K / Ctrl+K) jumps views, opens share, switches chart types, loads live sources, and turns short sentences into actions.",
    items: [
      {
        title: "Type a word or a sentence",
        detail:
          "Try share, schema, usgs, bar chart, or “ask how many…” — Loom ranks the match and runs it. Chips under the field cover the common jumps.",
      },
      {
        title: "Same dock as Tools",
        detail:
          "The magnifying glass sits next to the ibm.io Tools waffle above Preview, so search and suite stay one quiet corner.",
      },
    ],
  },
  {
    id: "2026-10-13h",
    date: "2026-10-13",
    title: "Share links for anyone on loom.ibm.io",
    summary:
      "Shared stories and reopen links always use loom.ibm.io — never a personal workers.dev host or the iPad app’s localhost — so anyone can open the chart in the browser or App Store app path.",
    items: [
      {
        title: "Public share URLs",
        detail:
          "Get link / Share image publish https://loom.ibm.io/s/… with “Open in Loom” pointing at loom.ibm.io/#story=…, including from the iPad app.",
      },
      {
        title: "Clearer Share sheet",
        detail:
          "Centered image preview, chart title in the header and under the image, caption preview, and a tidier format + actions column.",
      },
    ],
  },
  {
    id: "2026-10-13g",
    date: "2026-10-13",
    title: "Share image keeps a LinkedIn-ready link",
    summary:
      "Share image now publishes a short-lived story page first, then hands the OS both the PNG and that URL — so LinkedIn/X can unfurl the chart and recipients can reopen it.",
    items: [
      {
        title: "Image + link in one share",
        detail:
          "LinkedIn often drops bare image files from the share sheet. Loom now attaches a public chart link (with Open Graph preview) alongside the PNG, and falls back to copying the link if a target rejects the file.",
      },
    ],
  },
  {
    id: "2026-10-13f",
    date: "2026-10-13",
    title: "iPad Explore reaches the CSV proxy",
    summary:
      "Explore on iPad was blocked by the Worker’s cross-site check (Capacitor calls loom.ibm.io as cross-site from localhost). Allowed Origins now work, so catalog CSVs load into Chart.",
    items: [
      {
        title: "Data.gov Explore on iPad",
        detail:
          "Tap Explore → full CSV via the Loom Worker → Chart. Also fixed the earlier bug where the app shell HTML was saved as a fake 16.7 KB file.",
      },
    ],
  },
  {
    id: "2026-10-13e",
    date: "2026-10-13",
    title: "iPad Explore loads real catalog CSVs",
    summary:
      "Open-data Explore on iPhone/iPad was saving the app shell (~17 KB, 0 rows) instead of the CSV. It now fetches through the Loom Worker like live feeds do.",
    items: [
      {
        title: "Data.gov / UK Explore works on iPad",
        detail:
          "Tapping Explore on a catalog CSV pulls the full file (capped by the Worker), so Query and Chart see real rows — not an empty 16.7 KB placeholder.",
      },
    ],
  },
  {
    id: "2026-10-13d",
    date: "2026-10-13",
    title: "Share sheet that fits the device",
    summary: "Share uses the full stage on iPad and desktop, stacks actions for clear tab order, and warms the PNG so the preview is often ready when the sheet opens.",
    items: [
      {
        title: "Wider on tablet & desktop",
        detail:
          "Share is no longer a narrow phone dialog on iPad — preview sits beside formats and a vertical action rail, with a larger preview when there’s room.",
      },
      {
        title: "Image ready sooner",
        detail:
          "Tapping Share starts rendering immediately; Share image, Save, Get link, and NeoSpace all use that same PNG. Reopening the same format reuses the warm preview.",
      },
      {
        title: "iPad share labels fixed",
        detail:
          "On iPad the primary action is Share image (system share sheet with the file), not a desktop Save dialog — NeoSpace and chart link stay available.",
      },
      {
        title: "Share keeps the legend",
        detail:
          "Map share-outs keep the city color key, size scale, title, and footnote — the same chrome as the main chart, not a bare basemap.",
      },
      {
        title: "Export tab, less overlap",
        detail:
          "Share chart / image / download no longer triple the same job — Share sheet posts the image; Export keeps framing, story packs, video, SVG, and CSV.",
      },
    ],
  },
  {
    id: "2026-10-13c",
    date: "2026-10-13",
    title: "iPad room · Discover that opens",
    summary: "Charts keep their real size after relaunch, What’s interesting fills the stage, and the button opens even when a session was saved.",
    items: [
      {
        title: "Not stuck on phone size",
        detail:
          "Closing and reopening on iPad no longer locks the chart into a narrow phone frame — Loom remeasures the real viewport after launch.",
      },
      {
        title: "What’s interesting, roomy",
        detail:
          "The discover grid uses almost the whole screen (with a slim gutter), so more story cards fit at once.",
      },
      {
        title: "Tap opens every time",
        detail:
          "What’s interesting right now opens even if Onboarding wasn’t mounted yet or you already have a saved session — no more dead taps.",
      },
    ],
  },
  {
    id: "2026-10-13b",
    date: "2026-10-13",
    title: "Ideas rail · quieter chrome",
    summary: "The chart ideas strip can tuck away, encodings match their marks, and the chart footers stop stacking on each other.",
    items: [
      {
        title: "Ideas, not Suggestions",
        detail:
          "The left rail is now Ideas, with the count as a quiet subtitle. Hide it with the chevron; a slim Ideas tab brings it back. Ask AI is shorter too.",
      },
      {
        title: "Less overlapping foot ink",
        detail:
          "Data-cube tips sit above the source/time footnote instead of on top of it, and the status bar drops the duplicate color ramp — color stays on the chart.",
      },
      {
        title: "Encoding matches the mark",
        detail:
          "Force bubbles say Category/Value, geo bubbles and globe expose Size, radar/parallel only ask for Series, and bubble size no longer reappears after you clear it.",
      },
    ],
  },
  {
    id: "2026-10-13",
    date: "2026-10-13",
    title: "iPad launch fix",
    summary: "The App Store build no longer crashes on open under Safari’s WebKit.",
    items: [
      {
        title: "Opens cleanly on iPad",
        detail:
          "Chart thumbnails no longer trip a missing browser API that Safari on older iPadOS doesn’t ship — Loom stays up instead of flashing an application error.",
      },
    ],
  },
  {
    id: "2026-10-12",
    date: "2026-10-12",
    title: "Responsive shell for iPad and iPhone",
    summary: "Side panels survive Split View and Stage Manager, with a real tablet layout between phone and desktop.",
    items: [
      {
        title: "Back up and restore your saved work",
        detail:
          "Settings → Local data can export saved views, dashboards and SQL snippets to one file (with a size and privacy preview) and import it on another device. Datasets themselves aren’t included.",
      },
      {
        title: "Clear offline messaging",
        detail:
          "Without a connection Loom now says which live sources can’t refresh and that your saved uploads still open from Recent files; the feed resumes when you’re back online.",
      },
      {
        title: "Get link stays image-only unless you opt in",
        detail:
          "Publishing a public link no longer uploads every column by default. Local and uploaded files start with image-only; turn on “Include data” to share chart columns.",
      },
      {
        title: "Panels come back after you resize",
        detail:
          "Shrinking Loom then expanding it (Split View, Stage Manager) restores the sidebar and detail panel instead of leaving empty chrome.",
      },
      {
        title: "Tablet band",
        detail:
          "Between phone and desktop widths, the data sidebar overlays while the detail panel stays docked — more room for the chart on iPad.",
      },
      {
        title: "Help on phones",
        detail: "Open Help from the sidebar or Settings when the ? control isn’t on the top bar.",
      },
    ],
  },
  {
    id: "2026-10-10a",
    date: "2026-10-10",
    title: "Faster What’s interesting on iPad",
    summary: "The discover grid keeps a tight top list on tablet and remembers it when you close and reopen.",
    items: [
      {
        title: "120 stories on iPad",
        detail:
          "What’s interesting caps at 120 cards on iPad and iPhone so the scan and thumbnails stay responsive.",
      },
      {
        title: "Remembers the last scan",
        detail:
          "Close the panel and open it again — your stories are still there from memory, no waiting on a full rescan.",
      },
    ],
  },
  {
    id: "2026-10-09f",
    date: "2026-10-09",
    title: "Scatter scale & alignment",
    summary: "Log / Symlog on GPU scatter now reshape the Y axis, and dots sit inside the plot frame with the ticks.",
    items: [
      {
        title: "Y scale on dense scatter",
        detail:
          "Linear / Log / Symlog apply to WebGPU scatter the same way they do on Canvas — ticks, grid, and points share one transform.",
      },
      {
        title: "Dots match the axes",
        detail:
          "GPU points map into the padded plot rectangle so they line up with axis labels instead of the full canvas edge.",
      },
    ],
  },
  {
    id: "2026-10-09e",
    date: "2026-10-09",
    title: "Loom on iPad",
    summary:
      "A first App Store build ships the same charts, live feeds, and share flow you already use on the phone web — no desktop DuckDB required.",
    items: [
      {
        title: "iPad / iPhone app shell",
        detail:
          "Install Loom from TestFlight or the App Store. Live feeds, Dive, file pick, and share use the familiar web path inside a native shell.",
      },
      {
        title: "Desktop stays the heavy lifter",
        detail:
          "Folder mount, SQL over millions of rows, and WebGPU scatter remain in the macOS app. The tablet build is the storytelling surface.",
      },
    ],
  },
  {
    id: "2026-10-09d",
    date: "2026-10-09",
    title: "Clearer chart type",
    summary:
      "Titles, ticks, legends, and labels share one type ramp — bigger by default, stronger ink, titles wrap before they truncate.",
    items: [
      {
        title: "One type ramp",
        detail:
          "Axis size 11 is the new baseline (10 on compact phones). Titles, subtitles, legends, footnotes, and mark labels step from that single control instead of scattered 9px leftovers.",
      },
      {
        title: "Ink that reads",
        detail:
          "Axis chrome uses theme label (not muddy mid-gray). Labels on colored cells pick black/white with a stricter contrast check — Hot–Cold treemaps stay readable.",
      },
      {
        title: "Titles can wrap",
        detail:
          "Long chart titles take two lines before ellipsis, so “What’s interesting” stories don’t lose the point in a single truncated line.",
      },
    ],
  },
  {
    id: "2026-10-09c",
    date: "2026-10-09",
    title: "Preview tokens · more discover room",
    summary:
      "Column headers are sortable, draggable tokens that map into Encoding. Discover on phones gives the story grid more of the screen.",
    items: [
      {
        title: "Preview / Schema field tokens",
        detail:
          "Click a column header to sort. Drag it (or a Schema chip) into Chart → Encoding. On phones, tap a field then pick X / Y / Color — the chart updates live. Active roles show as badges on the tokens.",
      },
      {
        title: "Discover: taller story scroll",
        detail:
          "With filters parked at the bottom on mobile, the card grid stretches higher — tighter chrome, description tucked away once stories load.",
      },
    ],
  },
  {
    id: "2026-10-09b",
    date: "2026-10-09",
    title: "My Loom data",
    summary:
      "A personal data folder on your phone — add files, link a real device folder, and sync. Same mental model as the desktop folder.",
    items: [
      {
        title: "Your folder, by name",
        detail:
          "Web Loom now mounts “My Loom data” instead of a nameless upload pile. Add files into it; they stay on this device and reopen after refresh.",
      },
      {
        title: "Link & sync a device folder",
        detail:
          "On Chrome (including Android), Link a folder remembers that directory. Drop CSVs into it in Files, come back to Loom, tap Sync — your charts catch up.",
      },
    ],
  },
  {
    id: "2026-10-09",
    date: "2026-10-09",
    title: "Open more files · discover in thumb reach",
    summary:
      "Web Loom opens CSV, TSV, JSON, Parquet, and Excel — and remembers them. Discover filters sit where your thumb is on phones.",
    items: [
      {
        title: "More formats on the web",
        detail:
          "Open CSV, TSV, JSON / NDJSON, Parquet, and Excel (.xlsx) from this device. Chromium can Choose folder; paste a CSV/JSON URL when the file lives online.",
      },
      {
        title: "Uploads survive refresh",
        detail:
          "Local web files are stored in this browser (IndexedDB), so Recent still reopens them after a reload — data stays on your machine.",
      },
      {
        title: "Discover filters for one-handed use",
        detail:
          "On phones, topic / source / chart filters move under the story cards into the thumb zone. The chip rows still slide sideways.",
      },
    ],
  },
  {
    id: "2026-10-07j",
    date: "2026-10-07",
    title: "Color legend at a glance",
    summary: "Palette names leave the footnote — a real color ramp sits on the right so Hot–Cold (and friends) read without reading.",
    items: [
      {
        title: "Footnote color ramp",
        detail:
          "Source and date stay on the left. The active palette draws as a strip on the right, with a tiny field label (e.g. nest: views) above it — no more “Diverging Hot–Cold” as plain text.",
      },
      {
        title: "Status bar swatch",
        detail:
          "The bottom status line shows the same ramp next to the encoding field, so the color story matches what you see on the chart.",
      },
    ],
  },
  {
    id: "2026-10-07i",
    date: "2026-10-07",
    title: "Tooltip styles",
    summary: "Tooltips stay on by default — six styles from hover float to frosted glass, with Auto picking glass on phones.",
    items: [
      {
        title: "Six presentation modes",
        detail:
          "Encoding → Tooltip → Style: Auto, Hover, Glass, Dock, Pill, or Off. Auto floats on desktop and uses a frosted sheet on mobile so your finger doesn’t cover the numbers.",
      },
      {
        title: "Sticky on glass & dock",
        detail:
          "Touch-friendly modes keep the readout until you tap × or pick another mark — no more vanishing the moment you lift your finger.",
      },
    ],
  },
  {
    id: "2026-10-07h",
    date: "2026-10-07",
    title: "Chart ↔ Encoding link",
    summary: "Hover an axis, title, or legend on the chart and Encoding / Visual jumps to the matching control — and the other way around.",
    items: [
      {
        title: "Hover the chart chrome",
        detail:
          "Y gutter → Y channel, X strip → X, title band → Title layout, legend pocket → Color / Legend. The Detail panel switches Encoding ↔ Visual and scrolls to the control.",
      },
      {
        title: "Hover Encoding or Visual",
        detail:
          "Mousing a channel or look control outlines the related region on the canvas so you can see what you’re editing.",
      },
    ],
  },
  {
    id: "2026-10-07g",
    date: "2026-10-07",
    title: "Y scale in Encoding",
    summary: "Linear, log, and symlog for the measure axis — next to Direction on line, area, and scatter.",
    items: [
      {
        title: "Encoding → Y scale",
        detail:
          "Pick Linear / Log / Symlog on charts that map a continuous Y. Log compresses wide positive ranges; symlog stays soft around zero.",
      },
    ],
  },
  {
    id: "2026-10-07f",
    date: "2026-10-07",
    title: "Down means zero at the top",
    summary: "Direction ↓ flips the measure axis for real — and suggestions offer it for ranks, losses, and similar fields.",
    items: [
      {
        title: "Axis labels follow Direction",
        detail:
          "↓ puts 0 at the top (and ← puts 0 on the right) so hanging bars aren’t lying about the scale.",
      },
      {
        title: "Suggestions for “lower is the story”",
        detail:
          "When Y looks like rank, loss, latency, deficit, and friends, the rail gets a ↓ zero-at-top variant.",
      },
    ],
  },
  {
    id: "2026-10-07e",
    date: "2026-10-07",
    title: "Chart direction",
    summary: "Point bars and lollipops up, down, left, or right from Encoding — Auto still picks from the stage.",
    items: [
      {
        title: "Direction control for bar-like charts",
        detail:
          "Encoding → Direction (Auto / ↑ / ↓ / → / ←) orients bars, lollipops, Pareto, and waterfalls. Auto keeps the portrait and label heuristic.",
      },
      {
        title: "Shares with the chart link",
        detail:
          "Direction rides in #chart= links so a flipped layout opens the same way on another device.",
      },
    ],
  },
  {
    id: "2026-10-07d",
    date: "2026-10-07",
    title: "Color named in the status bar",
    summary: "When color drives the chart, the footer spells out the field and palette — and treemaps actually use continuous ramps.",
    items: [
      {
        title: "Color status next to the encoding line",
        detail:
          "The chart footer shows labels like “color: views · Diverging Hot–Cold” whenever Color or a continuous palette is in play — not just X × Y.",
      },
      {
        title: "Treemaps respect continuous palettes",
        detail:
          "Picking Diverging / Sequential now ramps tile color by the measure instead of painting every cell the same stop.",
      },
    ],
  },
  {
    id: "2026-10-07c",
    date: "2026-10-07",
    title: "What’s interesting, clearer",
    summary: "Discover hooks stay honest, rankings don’t flood, and a slow scan no longer wipes the stories you already saw.",
    items: [
      {
        title: "Discover stories that mean “right now”",
        detail:
          "Weather uses the latest reading per city, launches pick the soonest NET, OpenSky counts planes not trail points, Steam says “playing now,” and SpaceX only scores finished flights.",
      },
      {
        title: "Less noise, no wipe",
        detail:
          "Alt charts score lower so one feed doesn’t own the top of the grid, while Discover still keeps thousands of variants. Re-scanning won’t clear cards a slow timeout used to erase.",
      },
    ],
  },
  {
    id: "2026-10-07b",
    date: "2026-10-07",
    title: "Tooltips match Encoding",
    summary: "Hover readouts honor the Tooltip field chips — including data cubes and aggregated bars.",
    items: [
      {
        title: "Tooltip fields actually show up",
        detail:
          "Data cube (and other aggregated) hovers keep axis/measure summaries, then append the fields you picked in Encoding — so name, developer, and friends appear next to the bin ranges.",
      },
      {
        title: "Honest note for GPU / map charts",
        detail:
          "3D particle scenes and most geo maps still don’t hover yet; Encoding says so instead of pretending the chips work.",
      },
    ],
  },
  {
    id: "2026-10-07",
    date: "2026-10-07",
    title: "When the data happened",
    summary: "Charts footnote the date range of the rows on screen whenever a timestamp is available.",
    items: [
      {
        title: "Time span under the chart",
        detail:
          "When Encoding Time (or another date column) is present, the footer shows the span — e.g. “Jan 8, 2020 – Oct 6, 2026” — under the source credit so “OMG earthquakes” answers when.",
      },
    ],
  },
  {
    id: "2026-10-06c",
    date: "2026-10-06",
    title: "Honest clocks and clearer type",
    summary: "NYC and UK dates land in the right zone, Wikipedia picks a published day, and chart labels stay readable across themes.",
    items: [
      {
        title: "NYC 311 times use Eastern time",
        detail:
          "311 request timestamps without a time zone are treated as New York local time before charts and filters run, so “last 7 days” matches the calendar you expect.",
      },
      {
        title: "UK carbon and Wikipedia days",
        detail:
          "Carbon Intensity uses the London calendar day. Top pageviews try the latest published Wikimedia day (often day-2 before mid-afternoon UTC).",
      },
      {
        title: "Typography that stays legible",
        detail:
          "Dark and NES themes brighten secondary text, chart labels stay readable at small sizes, and suggestion chips no longer shrink to unreadable type.",
      },
    ],
  },
  {
    id: "2026-10-06b",
    date: "2026-10-06",
    title: "Truer clocks on live data",
    summary: "Last-hour windows mean calendar time, USGS/NWS stay current, and Steam CCU is labeled honestly.",
    items: [
      {
        title: "Live Time windows use the wall clock",
        detail:
          "“Last 6 hours” on earthquakes, fires, and aircraft means the last six hours on the clock — not six hours before the newest row in a lagging sample. Historical files still count back from their newest date. Upcoming asteroids and launches use a forward window (“next 24 hours”).",
      },
      {
        title: "Web USGS and NWS match the rolling feed",
        detail:
          "Each poll replaces the buffer with the current day of quakes and the active alert set, so magnitude updates apply and expired alerts leave the map.",
      },
      {
        title: "Aircraft timestamps and Steam CCU",
        detail:
          "OpenSky rows use each craft’s last_contact when available. Steam’s player column is labeled as current concurrent players (CCU), which is what SteamSpy actually returns.",
      },
    ],
  },
  {
    id: "2026-10-06",
    date: "2026-10-06",
    title: "Time windows on Encoding",
    summary: "Slice any chart to the last hour, day, week, or year — independently of the X axis.",
    items: [
      {
        title: "Time in the Encoding panel",
        detail:
          "When a table has a date or timestamp column — live feeds, USGS, fires, sales files — Encoding shows Time and Window chips. Last 24 hours on a bar map of categories, last 7 days on a scatter: the clock is a data slice, not an axis.",
      },
      {
        title: "Recent windows in Discover and Suggestions",
        detail:
          "What’s interesting and the suggestion rail surface “last hour / 6h / 24h” (or week/month for date columns) variants when a feed has a clock — open one and Encoding already has the window set. Random and Shuffle pick windows too.",
      },
      {
        title: "Windows count from the newest row",
        detail:
          "Presets hide themselves when they would empty a short sample. Share links and suggestion cards keep the window you picked.",
      },
    ],
  },
  {
    id: "2026-10-05",
    date: "2026-10-05",
    title: "Facets, compare, and four new live feeds",
    summary: "Small multiples and Top N on Encoding, compare overlays on lines, plus fires, rivers, Starlink, and Lobsters.",
    items: [
      {
        title: "Facet, Split, and Top N",
        detail:
          "Encoding can split a chart into small multiples (Facet), switch Color vs Facet with Split chips, and cap bars to Top 10–50 categories.",
      },
      {
        title: "Compare on line and area",
        detail:
          "Map a second measure to Compare Y, or overlay the earlier half of a time series — dashed so you can read change at a glance.",
      },
      {
        title: "Four new live feeds",
        detail:
          "NASA VIIRS active fires over the US, USGS river gauges, CelesTrak Starlink orbital elements, and Lobsters hottest stories.",
      },
      {
        title: "Suggestions pick up Facet, Top N, and Compare",
        detail:
          "Chart suggestion rails, live-source stories, Random / Shuffle, and file recommendations now propose small multiples, Top N bars, and Compare Y / earlier-half overlays when the schema fits.",
      },
      {
        title: "Encoding and Visual controls match what charts actually draw",
        detail:
          "Facet, Top N, Compare, marks, glow, and data-label toggles now only appear for chart types that honor them — and tooltips stick when you edit geo, GPU, or creative charts.",
      },
      {
        title: "Suggestion cards preview the real chart",
        detail:
          "What’s interesting and the Suggestions rail show a tiny canvas of just the chart shapes — Facet / Top N / Compare chips when those encodings are in play — so you can see the story before you open it.",
      },
      {
        title: "More suggestion variants everywhere",
        detail:
          "Live-source stories, Random / Shuffle, and file recommendations surface more Facet, Top N, and Compare options so the first panel is packed with distinct chart ideas.",
      },
      {
        title: "Shared links keep a data snapshot",
        detail:
          "Get link now freezes a capped copy of the rows that built the chart (with source, time, and columns) beside the preview. Open with shared data rebuilds the same chart from that snapshot for seven days — not whatever the live feed looks like later.",
      },
      {
        title: "Stats links back to the data source",
        detail:
          "The Stats panel opens with a Source card — live feed homepage, catalog / pack credit, raw data URL, and capture time for shared snapshots — so you always have a path back to where the rows came from.",
      },
      {
        title: "Source footnote on the chart",
        detail:
          "Chart → Visual → Source footnote draws lineage on the canvas (name, credit, or full). It ships with Share / PNG so the image still points back to the data — align left, center, or right.",
      },
      {
        title: "Shared charts stay honest on reopen",
        detail:
          "Refresh keeps the frozen snapshot URL, shared rows show as a snapshot (not a live feed), and source footnotes stay visible on GPU scenes and globes.",
      },
      {
        title: "Network and arc diagrams",
        detail:
          "Two new relational charts sit beside Sankey — a force-directed network and an arc diagram. Same Source → Target → Weight encoding, and they show up in suggestions when you have two categories.",
      },
      {
        title: "What’s interesting shows more chart types",
        detail:
          "Discover now keeps up to 500 stories (about 20 chart variants per live feed) and fills in every chart kind the schema supports — networks, arcs, creative, maps — not just the curated defaults.",
      },
      {
        title: "Share links look sharper everywhere",
        detail:
          "Get link letterboxes into a 1200×627 preview for Slack and iMessage, copies the URL for you, keeps the source footnote clear of the Loom footer, and opens shared snapshots with a single toast.",
      },
      {
        title: "Stacked bars, 100% bars, and bucket fields in Discover",
        detail:
          "What’s interesting now surfaces grouped, stacked, and 100% stacked bars side by side — plus bucket-field paddocks for drilling into a category. Open one and Encoding already has the stack mode set.",
      },
      {
        title: "Data-science chart variants everywhere",
        detail:
          "Rolling means, indexed / z-scored series, log Y, residual scatters, anomaly rings, Pareto (80/20), correlation matrices, period-over-period bars, and Δ-rank bumps now show up in What’s interesting, Suggestions, and Random / Shuffle when the schema fits.",
      },
    ],
  },
  {
    id: "2026-10-02e",
    date: "2026-10-02",
    title: "Thousands more datasets, and charts that switch cleanly",
    summary: "Two new catalogs, eight new live feeds, four new packs — and every chart type checked against real data.",
    items: [
      {
        title: "City & state open data",
        detail:
          "Search NYC, Chicago, San Francisco, Seattle, Austin, state portals, and the CDC from Data & sources — 311 calls, trees, crashes, inspections, permits — and chart any table in a tap.",
      },
      {
        title: "TidyTuesday",
        detail:
          "Browse every weekly community dataset since 2018 — over 400 weeks of ready-to-chart data, from Olympics to coffee ratings. Filter by topic and tap a file to chart it.",
      },
      {
        title: "Eight new live feeds",
        detail:
          "Every Boston bus and train moving now, the aurora forecast, UN disaster alerts worldwide, asteroids passing Earth, ocean buoys, Bitcoin blocks, Steam's most-played games, and the US national debt since 1993.",
      },
      {
        title: "New packs",
        detail: "Gapminder's wealth-and-health data, every M7+ earthquake since 1900, every Nobel laureate, and FiveThirtyEight's candy ranking.",
      },
      {
        title: "Switching chart types just works",
        detail:
          "Change a scatter into a bar, pie, funnel, or box and Loom picks a sensible category instead of turning every number into its own group. Lines use dates when there are any, and long daily series roll up to weeks or months.",
      },
      {
        title: "Reference lines, trails, and marginals",
        detail:
          "“Add reference line”, “Connect points”, and “Marginal distributions” now draw on the chart — reference lines land on the value axis even when bars run sideways.",
      },
      {
        title: "Sharper 3D and maps",
        detail: "3D scatter and firefly fill the frame instead of a tiny speck, and maps no longer color countries from unrelated numbers.",
      },
      {
        title: "Steadier panels",
        detail:
          "“What’s interesting right now” keeps one screen-fitted size while you filter, instead of shrinking and jumping. On phones the detail sheet no longer resizes between tabs, and rows that scroll sideways fade at the edge so you can tell there’s more.",
      },
    ],
  },
  {
    id: "2026-10-02d",
    date: "2026-10-02",
    title: "More live data, and every feed fixed up",
    summary: "Six new feeds, nine new open datasets, and a tune-up of every connection in Data & sources.",
    items: [
      {
        title: "Six new live feeds",
        detail:
          "NASA's tracked wildfires, storms, and volcanoes on a map; every Citi Bike dock in New York right now; NOAA space weather (when to expect auroras); Britain's grid carbon every half hour; yesterday's most-read Wikipedia articles; and global temperature since 1880, with a climate spiral.",
      },
      {
        title: "Feeds that work again",
        detail:
          "Weather alerts, crypto prices, live aircraft, SpaceX history, and world countries had stopped loading — they're back, with backups when an upstream service is busy. Earthquakes now show the past day instead of the past hour.",
      },
      {
        title: "Richer data in every feed",
        detail:
          "Weather and air quality cover 12 cities, exchange rates show 90 days of history, and World Bank data now charts GDP per person against life expectancy (CO₂ per person is back too). Opening a feed loads all of it, not just the newest 500 rows.",
      },
      {
        title: "Whole datasets, not the first page",
        detail:
          "Curated packs and your own CSVs load completely (up to about 1.5 million cells), and charts total every row — no more sums from a small preview. New packs: CO₂ per person, life expectancy, GDP, renewables, long-run population, the Keeling curve, every confirmed exoplanet, 35,000 power plants, and US cities.",
      },
      {
        title: "Easier to browse",
        detail: "Live feeds are grouped — Earth & climate, Cities & transport, Space, Web & markets, Countries & history — and each card links to where its data comes from.",
      },
    ],
  },
  {
    id: "2026-10-02c",
    date: "2026-10-02",
    title: "Every chart, easier to read",
    summary: "A pass over every chart type so the numbers, labels, and colors say what they mean.",
    items: [
      {
        title: "Links that reopen your chart",
        detail:
          "Copy chart link (in Share) or the address bar now reopens the exact chart — same data, chart type, fields, headline, colors, and look. Works for live feeds, demo data, and open-data files; for your own files, the other person opens the same file and the chart appears.",
      },
      {
        title: "Round numbers on every axis",
        detail:
          "Axes tick at 0, 20, 40 — not 3.7k and 7.4k — and gridlines sit right on those values. Dates read as Jan, Feb, Mar instead of 0.2, 0.4.",
      },
      {
        title: "Labels you can actually read",
        detail:
          "Category names are no longer cut off after nine letters. Bar charts with long names turn sideways automatically, and crowded axes angle or thin their labels instead of overlapping.",
      },
      {
        title: "Tooltips show the number",
        detail:
          "Hover a bar, slice, bin, or cell to see its total, average, or share — not just one row that happened to be underneath.",
      },
      {
        title: "Color only when it means something",
        detail:
          "Single-series charts use one color. When color encodes a field, a legend appears on its own, tucked into the emptiest corner.",
      },
      {
        title: "Sharper chart types",
        detail:
          "Box plots mark outliers, pies roll small slices into Other with percentages, treemaps use squarer tiles, waterfalls end with a total, and heatmaps and hexbins come with a color key that works in light and dark themes.",
      },
    ],
  },
  {
    id: "2026-10-02b",
    date: "2026-10-02",
    title: "Deeper dives",
    summary: "Dive picks up the rest of Scuba’s toolkit — and a few things Scuba never had.",
    items: [
      {
        title: "Make your own columns",
        detail:
          "Add a derived column like hour(ts), lower(country), or CASE WHEN delta > 0 THEN 'add' ELSE 'cut' END, then filter and group by it like any other column. It shows up in the SQL too.",
      },
      {
        title: "Drag to zoom, Back to undo",
        detail:
          "Drag across the time series to zoom in; double-click to zoom out. Or type any window, like “-3 hours” or “yesterday”. Every change is a step in your browser history, so Back takes you to your previous question.",
      },
      {
        title: "Smarter filters",
        detail:
          "Pick several values at once from suggestions drawn from your data, or match with contains, LIKE, or a regex.",
      },
      {
        title: "More ways to measure",
        detail:
          "p5 through p99.9, first and last seen on time columns, a hits column with each group’s share, and lowest-first ranking. With several metrics, each gets its own chart panel.",
      },
      {
        title: "Easier to read",
        detail:
          "Hover a crowded chart to highlight the nearest line, click to pin the readout, and choose how empty buckets look. Axis labels line up with real dates, and you can pick which columns Samples shows and sort by any of them.",
      },
    ],
  },
  {
    id: "2026-10-02",
    date: "2026-10-02",
    title: "Made for your phone",
    summary: "Find something fun, chart it, and share it — all from your phone.",
    items: [
      {
        title: "One-tap Share",
        detail:
          "Share renders your chart as a Square, Portrait, Story, or Wide image with feed-sized text, then opens your phone’s share sheet. Get link makes a page that previews nicely in iMessage, Slack, and X.",
      },
      {
        title: "Start with something interesting",
        detail:
          "Every empty screen now leads with “What’s interesting right now” — live quakes, flights, Hacker News, crypto, weather — and opens the best one as a chart, headline included.",
      },
      {
        title: "Edit while you watch",
        detail: "On phones, Edit opens a half-height sheet so the chart stays visible and updates as you change it.",
      },
      {
        title: "Charts that fit tall screens",
        detail:
          "Bar charts turn sideways on tall screens so long labels stay readable, and world maps now fill the width.",
      },
      {
        title: "Touch that works",
        detail:
          "Tap for tooltips, drag a finger to scrub across a chart, spin 3D charts, and long-press a table column to profile it. Text fields no longer zoom the page.",
      },
    ],
  },
  {
    id: "2026-09-30",
    date: "2026-09-30",
    title: "Dive and the data cube",
    items: [
      {
        title: "Dive",
        detail:
          "Slice and dice event data: pick a time window, filter, group by, compare against last week, and click any value to drill in. The whole query lives in the link.",
      },
      {
        title: "Data cube 3D",
        detail:
          "Rows × columns × depth as voxels. Swap axes, slice a layer, and dock a linked pivot table.",
      },
      {
        title: "Searchable chart picker",
        detail: "Type to find any of the 50+ chart types, with a “Fits this table” filter.",
      },
    ],
  },
  {
    id: "2026-09-26",
    date: "2026-09-26",
    title: "Maps and 3D scenes",
    items: [
      {
        title: "Geography charts",
        detail: "Choropleths, point and bubble maps, hex maps, globes, and arc maps.",
      },
      {
        title: "GPU scenes",
        detail: "Orbit 3D, firefly, trail ribbons, quake terrain, and loom weave.",
      },
      {
        title: "Richer discover",
        detail: "“What’s interesting right now” scans more live feeds and suggests more kinds of charts.",
      },
    ],
  },
  {
    id: "2026-09-25",
    date: "2026-09-25",
    title: "Swipe for chart ideas",
    items: [
      {
        title: "Deep scan swipe deck",
        detail: "Swipe through a deck of chart ideas — Keep or Skip — and Loom learns what you like, on your device.",
      },
      {
        title: "Looks and social framing",
        detail: "Visual presets (Tufte, Bauhaus, Newspaper…) and aspect presets for social posts.",
      },
    ],
  },
];

/** localStorage: id of the newest release this browser has seen. */
export const WHATS_NEW_SEEN_KEY = "loom-whats-new-seen";

export function latestRelease(): ChangelogRelease | undefined {
  return CHANGELOG[0];
}

/** Releases newer than `seenId` (all of them when nothing was seen). */
export function unseenReleases(seenId: string | null): ChangelogRelease[] {
  if (!seenId) return CHANGELOG;
  return CHANGELOG.filter((r) => r.id > seenId);
}

/** Ask the What's new modal to open (from Settings, Help, the sidebar…). */
export function requestWhatsNew(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("loom-whats-new"));
}

export type HelpRequestDetail = {
  tab?: "shortcuts" | "feedback";
  feedbackTitle?: string;
  feedbackBody?: string;
};

/** Ask the Help / shortcuts dialog to open (phones hide the TopBar ? button). */
export function requestHelp(detail?: HelpRequestDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<HelpRequestDetail>("loom-help", { detail }));
}
