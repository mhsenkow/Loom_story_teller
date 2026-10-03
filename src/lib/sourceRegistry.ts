// =================================================================
// Loom — Live / poll source registry (single source of truth)
// =================================================================
// Every poll source is defined once here: id, display copy, DuckDB /
// buffer table + schema, poll cadence, default ordering, and sidebar
// group. The sidebar cards, Query view, Dive loader, discover scan,
// session resume, and the web buffers all read from this list.
//
// Adding a source: add an entry here, a Worker route in
// workers/catalog-proxy.ts, a parser in webStreams.ts, an insert in
// src-tauri/src/sources.rs (same table + columns), and chart recs /
// SQL snippets in recommendations.ts.
// =================================================================

export const SOURCE_KINDS = [
  "usgs",
  "eonet",
  "gdacs",
  "nws",
  "meteo",
  "aq",
  "ukcarbon",
  "climate",
  "buoys",
  "opensky",
  "citibike",
  "mbta",
  "nyc311",
  "iss",
  "launches",
  "spacex",
  "spaceweather",
  "aurora",
  "asteroids",
  "hn",
  "pageviews",
  "steam",
  "crypto",
  "bitcoin",
  "fx",
  "debt",
  "fema",
  "covid",
  "countries",
  "world_bank",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export type SourceGroup = "earth" | "cities" | "space" | "web" | "world";

export const SOURCE_GROUP_LABELS: Record<SourceGroup, string> = {
  earth: "Earth & climate",
  cities: "Cities & transport",
  space: "Space",
  web: "Web & markets",
  world: "Countries & history",
};

export type SourceColumnType = "VARCHAR" | "DOUBLE" | "INTEGER" | "BIGINT" | "BOOLEAN" | "TIMESTAMP" | "DATE";

export interface SourceDef {
  kind: SourceKind;
  /** Card title. */
  label: string;
  /** One line under the title — what you'll see and how fresh it is. */
  description: string;
  attribution: string;
  /** Upstream home page (credit link). */
  homepage: string;
  /** Name shown for the open dataset (top bar, Recent, story links). */
  fileName: string;
  /** DuckDB table (desktop) / web buffer name. */
  table: string;
  columns: string[];
  types: SourceColumnType[];
  /** Web poll interval; 0 = load once. */
  pollMs: number;
  /** ORDER BY clause for snapshots (no "ORDER BY" keyword). */
  orderBy: string;
  group: SourceGroup;
  /** Token class for the card's status dot. */
  color: "loom-accent" | "loom-success" | "loom-warning" | "loom-error";
}

const def = (d: SourceDef) => d;

/**
 * Rows loaded when a feed opens in Chart / Explore. Covers the largest web buffer
 * (debt keeps ~8.4k days; others cap at 8k), so long histories — temperature since
 * 1880, 24 years × every country, US debt since 1993 — aren't cut to a recent slice.
 */
export const SOURCE_EXPLORE_ROWS = 12_000;

export const SOURCE_DEFS: SourceDef[] = [
  def({
    kind: "usgs",
    label: "USGS Earthquakes",
    description: "Every quake recorded worldwide in the past day — magnitude, depth, map points. Refreshes every minute.",
    attribution: "USGS · public domain",
    homepage: "https://earthquake.usgs.gov/earthquakes/feed/",
    fileName: "USGS Quakes",
    table: "usgs_quakes",
    columns: ["id", "magnitude", "place", "ts", "latitude", "longitude", "depth", "mag_type", "status", "tsunami", "sig", "net"],
    types: ["VARCHAR", "DOUBLE", "VARCHAR", "TIMESTAMP", "DOUBLE", "DOUBLE", "DOUBLE", "VARCHAR", "VARCHAR", "BOOLEAN", "INTEGER", "VARCHAR"],
    pollMs: 60_000,
    orderBy: "ts DESC",
    group: "earth",
    color: "loom-warning",
  }),
  def({
    kind: "eonet",
    label: "Natural events (NASA)",
    description: "Open wildfires, storms, volcanoes, and floods tracked by NASA EONET — great on a map.",
    attribution: "NASA EONET · public domain",
    homepage: "https://eonet.gsfc.nasa.gov/",
    fileName: "NASA Natural Events",
    table: "natural_events",
    columns: ["id", "title", "category", "source", "ts", "latitude", "longitude", "magnitude", "magnitude_unit", "status"],
    types: ["VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "TIMESTAMP", "DOUBLE", "DOUBLE", "DOUBLE", "VARCHAR", "VARCHAR"],
    pollMs: 600_000,
    orderBy: "ts DESC",
    group: "earth",
    color: "loom-error",
  }),
  def({
    kind: "gdacs",
    label: "Disaster alerts (GDACS)",
    description: "Earthquakes, cyclones, floods, volcanoes, wildfires, and droughts worldwide, rated green / orange / red by expected impact.",
    attribution: "GDACS (UN / EC JRC) · free",
    homepage: "https://www.gdacs.org/",
    fileName: "GDACS Disaster Alerts",
    table: "disaster_alerts",
    columns: ["id", "event_type", "title", "alert_level", "alert_score", "country", "latitude", "longitude", "start_ts", "end_ts", "severity", "severity_unit"],
    types: ["VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "DOUBLE", "VARCHAR", "DOUBLE", "DOUBLE", "TIMESTAMP", "TIMESTAMP", "DOUBLE", "VARCHAR"],
    pollMs: 900_000,
    orderBy: "start_ts DESC",
    group: "earth",
    color: "loom-error",
  }),
  def({
    kind: "nws",
    label: "NWS Alerts",
    description: "Active US weather warnings, watches, and advisories by severity and area.",
    attribution: "api.weather.gov · public",
    homepage: "https://www.weather.gov/documentation/services-web-api",
    fileName: "NWS Alerts",
    table: "nws_alerts",
    columns: ["id", "event", "headline", "severity", "certainty", "urgency", "area_desc", "sender_name", "effective", "expires", "status", "category"],
    types: ["VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "TIMESTAMP", "TIMESTAMP", "VARCHAR", "VARCHAR"],
    pollMs: 120_000,
    orderBy: "effective DESC",
    group: "earth",
    color: "loom-error",
  }),
  def({
    kind: "meteo",
    label: "World weather",
    description: "Hourly temperature, wind, and rain for 12 world cities — past 2 days plus today's forecast.",
    attribution: "Open-Meteo · free",
    homepage: "https://open-meteo.com/",
    fileName: "World Weather",
    table: "meteo_weather",
    columns: ["ts", "city", "latitude", "longitude", "temperature", "humidity", "wind_speed", "precipitation", "weather_code", "pressure", "cloud_cover"],
    types: ["TIMESTAMP", "VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "INTEGER", "DOUBLE", "DOUBLE"],
    pollMs: 300_000,
    orderBy: "ts DESC",
    group: "earth",
    color: "loom-accent",
  }),
  def({
    kind: "aq",
    label: "Air quality",
    description: "PM2.5, PM10, ozone, NO₂, and the European AQI right now in 12 world cities.",
    attribution: "Open-Meteo Air Quality · free",
    homepage: "https://open-meteo.com/en/docs/air-quality-api",
    fileName: "Air Quality",
    table: "air_quality",
    columns: ["ts", "city", "latitude", "longitude", "pm2_5", "pm10", "ozone", "nitrogen_dioxide", "european_aqi"],
    types: ["TIMESTAMP", "VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE"],
    pollMs: 300_000,
    orderBy: "pm2_5 DESC",
    group: "earth",
    color: "loom-accent",
  }),
  def({
    kind: "ukcarbon",
    label: "UK grid carbon",
    description: "Carbon intensity of Britain's electricity, every half hour — forecast vs. actual since yesterday.",
    attribution: "National Grid ESO · CC BY 4.0",
    homepage: "https://carbonintensity.org.uk/",
    fileName: "UK Grid Carbon",
    table: "uk_carbon",
    columns: ["ts", "forecast", "actual", "intensity_index"],
    types: ["TIMESTAMP", "INTEGER", "INTEGER", "VARCHAR"],
    pollMs: 1_800_000,
    orderBy: "ts DESC",
    group: "earth",
    color: "loom-success",
  }),
  def({
    kind: "climate",
    label: "Global temperature",
    description: "Monthly global land + ocean temperature anomaly since 1880 (vs. the 20th-century average).",
    attribution: "NOAA NCEI · public domain",
    homepage: "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/",
    fileName: "Global Temperature",
    table: "global_temperature",
    columns: ["ts", "year", "month", "anomaly_c"],
    types: ["DATE", "INTEGER", "INTEGER", "DOUBLE"],
    pollMs: 0,
    orderBy: "ts ASC",
    group: "earth",
    color: "loom-error",
  }),
  def({
    kind: "buoys",
    label: "Ocean buoys",
    description: "Latest waves, wind, and water temperature from ~800 NOAA buoys and coastal stations worldwide.",
    attribution: "NOAA NDBC · public domain",
    homepage: "https://www.ndbc.noaa.gov/",
    fileName: "Ocean Buoys",
    table: "ocean_buoys",
    columns: ["station", "latitude", "longitude", "ts", "wind_dir", "wind_speed_ms", "gust_ms", "wave_height_m", "wave_period_s", "pressure_hpa", "air_temp_c", "water_temp_c"],
    types: ["VARCHAR", "DOUBLE", "DOUBLE", "TIMESTAMP", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE"],
    pollMs: 1_800_000,
    orderBy: "wave_height_m DESC",
    group: "earth",
    color: "loom-accent",
  }),
  def({
    kind: "opensky",
    label: "Live aircraft",
    description: "Aircraft over the US right now — position, altitude, speed. Great scatter maps.",
    attribution: "OpenSky Network / ADSB.lol · free",
    homepage: "https://opensky-network.org/",
    fileName: "Live Aircraft",
    table: "opensky_aircraft",
    columns: ["icao24", "callsign", "origin_country", "longitude", "latitude", "baro_altitude", "velocity", "true_track", "on_ground", "ts"],
    types: ["VARCHAR", "VARCHAR", "VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "BOOLEAN", "TIMESTAMP"],
    pollMs: 30_000,
    orderBy: "baro_altitude DESC",
    group: "cities",
    color: "loom-accent",
  }),
  def({
    kind: "citibike",
    label: "Citi Bike",
    // pct_full is a percentage (0–100) of the dock's capacity holding bikes; null when capacity is 0
    description: "Every NYC Citi Bike dock right now — bikes, e-bikes, open docks, and % full. Refreshes every minute.",
    attribution: "Lyft GBFS · public",
    homepage: "https://citibikenyc.com/system-data",
    fileName: "Citi Bike Stations",
    table: "citibike_stations",
    columns: ["station_id", "name", "latitude", "longitude", "capacity", "bikes_available", "ebikes_available", "docks_available", "pct_full", "is_renting", "ts"],
    types: ["VARCHAR", "VARCHAR", "DOUBLE", "DOUBLE", "INTEGER", "INTEGER", "INTEGER", "INTEGER", "DOUBLE", "BOOLEAN", "TIMESTAMP"],
    pollMs: 60_000,
    orderBy: "bikes_available DESC",
    group: "cities",
    color: "loom-success",
  }),
  def({
    kind: "mbta",
    label: "Boston transit (MBTA)",
    description: "Every MBTA bus, subway, light-rail, and commuter-rail vehicle moving right now. Refreshes every 30 s.",
    attribution: "MBTA V3 API · free",
    homepage: "https://www.mbta.com/developers/v3-api",
    fileName: "MBTA Vehicles",
    table: "mbta_vehicles",
    columns: ["id", "label", "route", "route_type", "latitude", "longitude", "bearing", "speed_mph", "status", "occupancy", "ts"],
    types: ["VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "VARCHAR", "VARCHAR", "TIMESTAMP"],
    pollMs: 30_000,
    orderBy: "route, label",
    group: "cities",
    color: "loom-accent",
  }),
  def({
    kind: "nyc311",
    label: "NYC 311",
    description: "The latest 400 NYC service requests — complaint type, borough, agency, map points.",
    attribution: "NYC Open Data · public",
    homepage: "https://opendata.cityofnewyork.us/",
    fileName: "NYC 311",
    table: "nyc_311",
    columns: ["unique_key", "created_date", "complaint_type", "descriptor", "borough", "city", "latitude", "longitude", "status", "agency"],
    types: ["VARCHAR", "TIMESTAMP", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "DOUBLE", "DOUBLE", "VARCHAR", "VARCHAR"],
    pollMs: 300_000,
    orderBy: "created_date DESC",
    group: "cities",
    color: "loom-warning",
  }),
  def({
    kind: "iss",
    label: "ISS Tracker",
    description: "Where the International Space Station is right now — builds a lat/lon trail.",
    attribution: "Where The ISS At · free",
    homepage: "https://wheretheiss.at/",
    fileName: "ISS Track",
    table: "iss_track",
    columns: ["ts", "latitude", "longitude", "altitude_km", "velocity_kmh", "visibility"],
    types: ["TIMESTAMP", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "VARCHAR"],
    pollMs: 15_000,
    orderBy: "ts DESC",
    group: "space",
    color: "loom-accent",
  }),
  def({
    kind: "launches",
    label: "Upcoming launches",
    description: "The next 40 orbital and suborbital launches worldwide by agency, rocket, and pad.",
    attribution: "The Space Devs · free",
    homepage: "https://thespacedevs.com/llapi",
    fileName: "Space Launches",
    table: "space_launches",
    columns: ["id", "name", "net", "status", "pad", "location", "agency", "rocket", "orbital"],
    types: ["VARCHAR", "VARCHAR", "TIMESTAMP", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "BOOLEAN"],
    pollMs: 1_800_000,
    orderBy: "net ASC",
    group: "space",
    color: "loom-accent",
  }),
  def({
    kind: "spacex",
    label: "SpaceX history",
    description: "SpaceX's most recent 100 launches — success, rocket, cadence over time.",
    attribution: "The Space Devs · free",
    homepage: "https://thespacedevs.com/llapi",
    fileName: "SpaceX Launches",
    table: "spacex_launches",
    columns: ["id", "name", "date_utc", "success", "upcoming", "rocket", "flight_number", "details"],
    types: ["VARCHAR", "VARCHAR", "TIMESTAMP", "BOOLEAN", "BOOLEAN", "VARCHAR", "INTEGER", "VARCHAR"],
    pollMs: 3_600_000,
    orderBy: "date_utc DESC",
    group: "space",
    color: "loom-accent",
  }),
  def({
    kind: "spaceweather",
    label: "Space weather",
    description: "Planetary Kp index every 3 hours for the past week — Kp 5+ means a geomagnetic storm and auroras.",
    attribution: "NOAA SWPC · public domain",
    homepage: "https://www.swpc.noaa.gov/",
    fileName: "Space Weather",
    table: "space_weather",
    columns: ["ts", "kp", "a_running", "station_count", "storm_level"],
    types: ["TIMESTAMP", "DOUBLE", "INTEGER", "INTEGER", "VARCHAR"],
    pollMs: 900_000,
    orderBy: "ts DESC",
    group: "space",
    color: "loom-success",
  }),
  def({
    kind: "aurora",
    label: "Aurora forecast",
    description: "Where the northern and southern lights are likely in the next ~30 minutes (NOAA OVATION model, 2° cells).",
    attribution: "NOAA SWPC · public domain",
    homepage: "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast",
    fileName: "Aurora Forecast",
    table: "aurora_forecast",
    columns: ["longitude", "latitude", "probability", "ts"],
    types: ["DOUBLE", "DOUBLE", "INTEGER", "TIMESTAMP"],
    pollMs: 900_000,
    orderBy: "probability DESC",
    group: "space",
    color: "loom-success",
  }),
  def({
    kind: "asteroids",
    label: "Asteroid flybys",
    description: "Asteroids passing within ~20 lunar distances of Earth over the next 60 days — distance, speed, estimated size.",
    attribution: "NASA JPL CNEOS · public domain",
    homepage: "https://cneos.jpl.nasa.gov/ca/",
    fileName: "Asteroid Flybys",
    table: "asteroid_approaches",
    columns: ["designation", "name", "approach_ts", "distance_ld", "distance_km", "velocity_kms", "abs_magnitude", "diameter_m"],
    types: ["VARCHAR", "VARCHAR", "TIMESTAMP", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE"],
    pollMs: 21_600_000,
    orderBy: "approach_ts ASC",
    group: "space",
    color: "loom-warning",
  }),
  def({
    kind: "hn",
    label: "Hacker News",
    description: "Front-page stories with points and comment counts. Refreshes every 2 min.",
    attribution: "HN Search (Algolia) · free",
    homepage: "https://hn.algolia.com/api",
    fileName: "HN Front Page",
    table: "hn_stories",
    columns: ["id", "title", "author", "points", "num_comments", "url", "created_at"],
    types: ["VARCHAR", "VARCHAR", "VARCHAR", "INTEGER", "INTEGER", "VARCHAR", "TIMESTAMP"],
    pollMs: 120_000,
    orderBy: "points DESC",
    group: "web",
    color: "loom-warning",
  }),
  def({
    kind: "pageviews",
    label: "Wikipedia most-read",
    description: "Yesterday's 100 most-read English Wikipedia articles and their view counts.",
    attribution: "Wikimedia REST API · CC0",
    homepage: "https://wikimedia.org/api/rest_v1/",
    fileName: "Wikipedia Most Read",
    table: "wiki_top_articles",
    columns: ["rank", "article", "views", "day"],
    types: ["INTEGER", "VARCHAR", "BIGINT", "DATE"],
    pollMs: 3_600_000,
    orderBy: "rank ASC",
    group: "web",
    color: "loom-accent",
  }),
  def({
    kind: "steam",
    label: "Steam top games",
    description: "The 100 most-played Steam games of the last two weeks — players, reviews, price, and current discount.",
    attribution: "SteamSpy · free",
    homepage: "https://steamspy.com/api.php",
    fileName: "Steam Top Games",
    table: "steam_games",
    columns: ["appid", "name", "developer", "peak_players", "positive", "negative", "positive_pct", "owners_min", "price_usd", "discount_pct"],
    types: ["VARCHAR", "VARCHAR", "VARCHAR", "INTEGER", "INTEGER", "INTEGER", "DOUBLE", "BIGINT", "DOUBLE", "DOUBLE"],
    pollMs: 21_600_000,
    orderBy: "peak_players DESC",
    group: "web",
    color: "loom-accent",
  }),
  def({
    kind: "crypto",
    label: "Crypto markets",
    description: "Top 50 coins by market cap — price, volume, 24h change.",
    attribution: "CoinGecko / CoinPaprika · free",
    homepage: "https://www.coingecko.com/en/api",
    fileName: "Crypto Markets",
    table: "crypto_markets",
    columns: ["id", "symbol", "name", "price_usd", "market_cap", "volume_24h", "change_24h_pct", "rank"],
    types: ["VARCHAR", "VARCHAR", "VARCHAR", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "INTEGER"],
    pollMs: 60_000,
    orderBy: "rank ASC",
    group: "web",
    color: "loom-success",
  }),
  def({
    kind: "bitcoin",
    label: "Bitcoin blocks",
    description: "The latest ~60 Bitcoin blocks — transactions, fees, size, and which pool mined them.",
    attribution: "mempool.space · free",
    homepage: "https://mempool.space/docs/api",
    fileName: "Bitcoin Blocks",
    table: "bitcoin_blocks",
    columns: ["height", "ts", "tx_count", "size_mb", "median_fee_sat_vb", "total_fees_btc", "reward_btc", "pool"],
    types: ["INTEGER", "TIMESTAMP", "INTEGER", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "VARCHAR"],
    pollMs: 120_000,
    orderBy: "height DESC",
    group: "web",
    color: "loom-warning",
  }),
  def({
    kind: "fx",
    label: "FX rates",
    description: "Daily euro exchange rates for 30 currencies over the past 90 days (ECB).",
    attribution: "Frankfurter (ECB) · free",
    homepage: "https://frankfurter.dev/",
    fileName: "FX Rates",
    table: "fx_rates",
    columns: ["as_of", "base", "quote", "rate", "change_pct"],
    types: ["DATE", "VARCHAR", "VARCHAR", "DOUBLE", "DOUBLE"],
    pollMs: 3_600_000,
    orderBy: "as_of DESC, quote",
    group: "web",
    color: "loom-success",
  }),
  def({
    kind: "debt",
    label: "US national debt",
    description: "Total public debt outstanding, every business day since 1993 — held by the public vs. intragovernmental.",
    attribution: "US Treasury Fiscal Data · public domain",
    homepage: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/",
    fileName: "US National Debt",
    table: "us_debt",
    columns: ["record_date", "total_debt", "held_by_public", "intragovernmental"],
    types: ["DATE", "DOUBLE", "DOUBLE", "DOUBLE"],
    pollMs: 0,
    orderBy: "record_date ASC",
    group: "world",
    color: "loom-error",
  }),
  def({
    kind: "fema",
    label: "FEMA disasters",
    description: "The 200 latest US disaster declarations by state and incident type.",
    attribution: "OpenFEMA · public domain",
    homepage: "https://www.fema.gov/about/openfema",
    fileName: "FEMA Disasters",
    table: "fema_disasters",
    columns: ["id", "disaster_number", "state", "declaration_type", "declaration_title", "incident_type", "declaration_date", "incident_begin", "fy_declared"],
    types: ["VARCHAR", "INTEGER", "VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "TIMESTAMP", "TIMESTAMP", "INTEGER"],
    pollMs: 600_000,
    orderBy: "declaration_date DESC",
    group: "world",
    color: "loom-error",
  }),
  def({
    kind: "covid",
    label: "COVID by country",
    description: "Cumulative COVID-19 cases and deaths by country (historical snapshot).",
    attribution: "disease.sh · free",
    homepage: "https://disease.sh/",
    fileName: "COVID Countries",
    table: "covid_countries",
    columns: ["country", "cases", "today_cases", "deaths", "today_deaths", "recovered", "active", "cases_per_million", "deaths_per_million", "population", "continent"],
    types: ["VARCHAR", "BIGINT", "BIGINT", "BIGINT", "BIGINT", "BIGINT", "BIGINT", "DOUBLE", "DOUBLE", "BIGINT", "VARCHAR"],
    pollMs: 1_800_000,
    orderBy: "cases DESC",
    group: "world",
    color: "loom-error",
  }),
  def({
    kind: "countries",
    label: "World countries",
    description: "Population, area, density, region, and capital for every country.",
    attribution: "mledoze/countries + World Bank · open",
    homepage: "https://github.com/mledoze/countries",
    fileName: "World Countries",
    table: "world_countries",
    columns: ["name", "cca3", "region", "subregion", "population", "area", "density", "capital", "independent"],
    types: ["VARCHAR", "VARCHAR", "VARCHAR", "VARCHAR", "BIGINT", "DOUBLE", "DOUBLE", "VARCHAR", "BOOLEAN"],
    pollMs: 0,
    orderBy: "population DESC",
    group: "world",
    color: "loom-success",
  }),
  def({
    kind: "world_bank",
    label: "World Bank",
    description: "GDP, GDP per person, population, life expectancy, and CO₂ per person by country, 2000–2023. Loads once.",
    attribution: "World Bank Open Data · CC BY 4.0",
    homepage: "https://data.worldbank.org/",
    fileName: "World Bank",
    table: "world_bank",
    // One row per country-year (wide) so every indicator is its own chartable column
    columns: ["country_code", "country_name", "yr", "gdp_usd", "gdp_per_capita", "population", "life_expectancy", "co2_per_capita"],
    types: ["VARCHAR", "VARCHAR", "INTEGER", "DOUBLE", "DOUBLE", "BIGINT", "DOUBLE", "DOUBLE"],
    pollMs: 0,
    orderBy: "yr DESC, country_code",
    group: "world",
    color: "loom-success",
  }),
];

export const SOURCE_BY_KIND: Record<SourceKind, SourceDef> = Object.fromEntries(
  SOURCE_DEFS.map((d) => [d.kind, d]),
) as Record<SourceKind, SourceDef>;

export function isSourceKind(v: string): v is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(v);
}

/** `stream://usgs` → "usgs" (poll sources only; `stream://wiki` → null). */
export function sourceKindFromPath(path: string | null | undefined): SourceKind | null {
  const m = path?.match(/^stream:\/\/([a-z0-9_]+)$/);
  return m && isSourceKind(m[1]!) ? m[1] : null;
}

export function sourceStreamPath(kind: SourceKind): string {
  return `stream://${kind}`;
}

export function sourceTable(kind: SourceKind): string {
  return SOURCE_BY_KIND[kind].table;
}

export function sourceFileName(kind: SourceKind): string {
  return SOURCE_BY_KIND[kind].fileName;
}
