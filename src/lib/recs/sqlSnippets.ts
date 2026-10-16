// =================================================================
// Query-tab SQL snippets for each live source and the Wikipedia stream.
// (split from recommendations.ts — LOOM-195; public API re-exported there)
// =================================================================

import { type SourceKind } from "../sourceRegistry";

/** SQL queries for each source kind. */
export const SOURCE_SQL_SNIPPETS = {
  usgs: [
    { name: "Recent quakes", sql: "SELECT place, magnitude, depth, ts FROM usgs_quakes ORDER BY ts DESC LIMIT 20" },
    { name: "Strongest quakes", sql: "SELECT place, magnitude, depth, latitude, longitude, ts FROM usgs_quakes ORDER BY magnitude DESC LIMIT 15" },
    { name: "Quakes by network", sql: "SELECT net, COUNT(*) AS cnt, AVG(magnitude) AS avg_mag FROM usgs_quakes GROUP BY net ORDER BY cnt DESC" },
    { name: "Tsunami alerts", sql: "SELECT * FROM usgs_quakes WHERE tsunami = true ORDER BY ts DESC" },
  ],
  meteo: [
    { name: "Current conditions", sql: "SELECT city, temperature, humidity, wind_speed, precipitation, ts FROM meteo_weather ORDER BY ts DESC LIMIT 5" },
    { name: "Hottest hours", sql: "SELECT city, temperature, ts FROM meteo_weather ORDER BY temperature DESC LIMIT 20" },
    { name: "City averages", sql: "SELECT city, AVG(temperature) AS avg_temp, AVG(humidity) AS avg_hum, AVG(wind_speed) AS avg_wind FROM meteo_weather GROUP BY city" },
    { name: "Rainy periods", sql: "SELECT city, ts, precipitation, temperature FROM meteo_weather WHERE precipitation > 0 ORDER BY precipitation DESC LIMIT 20" },
  ],
  nws: [
    { name: "Active alerts", sql: "SELECT event, severity, urgency, headline, area_desc FROM nws_alerts ORDER BY effective DESC LIMIT 20" },
    { name: "By severity", sql: "SELECT severity, COUNT(*) AS cnt FROM nws_alerts GROUP BY severity ORDER BY cnt DESC" },
    { name: "By event type", sql: "SELECT event, COUNT(*) AS cnt, MIN(effective) AS first_seen FROM nws_alerts GROUP BY event ORDER BY cnt DESC LIMIT 15" },
    { name: "Extreme alerts", sql: "SELECT * FROM nws_alerts WHERE severity = 'Extreme' OR severity = 'Severe' ORDER BY effective DESC" },
  ],
  world_bank: [
    { name: "Richest per person (latest)", sql: "SELECT country_name, yr, gdp_per_capita FROM world_bank WHERE yr = (SELECT MAX(yr) FROM world_bank WHERE gdp_per_capita IS NOT NULL) AND gdp_per_capita IS NOT NULL ORDER BY gdp_per_capita DESC LIMIT 20" },
    { name: "Most populous (latest)", sql: "SELECT country_name, population FROM world_bank WHERE yr = (SELECT MAX(yr) FROM world_bank WHERE population IS NOT NULL) ORDER BY population DESC LIMIT 20" },
    { name: "Life expectancy trend", sql: "SELECT yr, ROUND(AVG(life_expectancy), 1) AS avg_life_expectancy FROM world_bank GROUP BY yr ORDER BY yr" },
    { name: "CO₂ per person (top)", sql: "SELECT country_name, yr, co2_per_capita FROM world_bank WHERE co2_per_capita IS NOT NULL QUALIFY ROW_NUMBER() OVER (PARTITION BY country_code ORDER BY yr DESC) = 1 ORDER BY co2_per_capita DESC LIMIT 15" },
  ],
  iss: [
    { name: "Latest position", sql: "SELECT * FROM iss_track ORDER BY ts DESC LIMIT 20" },
    { name: "Altitude trail", sql: "SELECT ts, altitude_km, velocity_kmh FROM iss_track ORDER BY ts" },
  ],
  hn: [
    { name: "Top by points", sql: "SELECT title, points, num_comments, author FROM hn_stories ORDER BY points DESC LIMIT 20" },
    { name: "Discussion intensity", sql: "SELECT title, points, num_comments FROM hn_stories ORDER BY num_comments DESC LIMIT 20" },
  ],
  lobsters: [
    { name: "Top by score", sql: "SELECT title, score, comment_count, author, tags FROM lobsters_stories ORDER BY score DESC LIMIT 20" },
    { name: "Discussion intensity", sql: "SELECT title, score, comment_count, tags FROM lobsters_stories ORDER BY comment_count DESC LIMIT 20" },
  ],
  firms: [
    { name: "Hottest fires", sql: "SELECT latitude, longitude, frp, bright_ti4, confidence, acq_ts FROM firms_fires ORDER BY frp DESC LIMIT 30" },
    { name: "By confidence", sql: "SELECT confidence, COUNT(*) AS cnt, AVG(frp) AS avg_frp FROM firms_fires GROUP BY confidence ORDER BY cnt DESC" },
  ],
  nwis: [
    { name: "Latest discharge", sql: "SELECT site_name, ts, discharge_cfs, gage_height_ft FROM nwis_gauges ORDER BY ts DESC LIMIT 40" },
    { name: "Site averages", sql: "SELECT site_name, AVG(discharge_cfs) AS avg_cfs, AVG(gage_height_ft) AS avg_ft FROM nwis_gauges GROUP BY site_name ORDER BY avg_cfs DESC" },
  ],
  starlink: [
    { name: "Orbital sample", sql: "SELECT object_name, inclination, mean_motion, eccentricity, epoch FROM starlink_sats ORDER BY mean_motion DESC LIMIT 50" },
    { name: "Inclination bands", sql: "SELECT ROUND(inclination, 0) AS inc_deg, COUNT(*) AS sats FROM starlink_sats GROUP BY 1 ORDER BY sats DESC LIMIT 20" },
  ],
  crypto: [
    { name: "Market leaders", sql: "SELECT symbol, name, price_usd, market_cap, change_24h_pct FROM crypto_markets ORDER BY rank ASC LIMIT 20" },
    { name: "Biggest movers", sql: "SELECT symbol, change_24h_pct, price_usd, volume_24h FROM crypto_markets ORDER BY ABS(change_24h_pct) DESC LIMIT 20" },
  ],
  aq: [
    { name: "PM2.5 leaders", sql: "SELECT city, pm2_5, pm10, european_aqi, ts FROM air_quality ORDER BY pm2_5 DESC" },
    { name: "AQI comparison", sql: "SELECT city, european_aqi, ozone, nitrogen_dioxide FROM air_quality ORDER BY european_aqi DESC" },
  ],
  fx: [
    { name: "Latest rates", sql: "SELECT quote, rate, change_pct FROM fx_rates WHERE as_of = (SELECT MAX(as_of) FROM fx_rates) ORDER BY quote" },
    { name: "Most volatile", sql: "SELECT quote, ROUND(STDDEV(change_pct), 3) AS daily_volatility_pct FROM fx_rates GROUP BY quote ORDER BY daily_volatility_pct DESC" },
    { name: "Dollar over time", sql: "SELECT as_of, rate FROM fx_rates WHERE quote = 'USD' ORDER BY as_of" },
  ],
  fema: [
    { name: "Recent declarations", sql: "SELECT state, incident_type, declaration_title, declaration_date FROM fema_disasters ORDER BY declaration_date DESC LIMIT 30" },
    { name: "By incident type", sql: "SELECT incident_type, COUNT(*) AS cnt FROM fema_disasters GROUP BY incident_type ORDER BY cnt DESC" },
    { name: "By state", sql: "SELECT state, COUNT(*) AS cnt FROM fema_disasters GROUP BY state ORDER BY cnt DESC LIMIT 20" },
  ],
  opensky: [
    { name: "Airborne sample", sql: "SELECT callsign, origin_country, latitude, longitude, baro_altitude, velocity FROM opensky_aircraft WHERE NOT on_ground ORDER BY baro_altitude DESC LIMIT 50" },
    { name: "By country", sql: "SELECT origin_country, COUNT(*) AS aircraft FROM opensky_aircraft GROUP BY origin_country ORDER BY aircraft DESC LIMIT 20" },
  ],
  countries: [
    { name: "Population top 30", sql: "SELECT name, region, population, area, density FROM world_countries ORDER BY population DESC LIMIT 30" },
    { name: "By region", sql: "SELECT region, COUNT(*) AS countries, SUM(population) AS pop FROM world_countries GROUP BY region ORDER BY pop DESC" },
  ],
  spacex: [
    { name: "Recent flights", sql: "SELECT name, date_utc, rocket, success FROM spacex_launches ORDER BY date_utc DESC LIMIT 30" },
    { name: "Success rate", sql: "SELECT success, COUNT(*) AS cnt FROM spacex_launches GROUP BY success" },
    { name: "Launches per month", sql: "SELECT date_trunc('month', date_utc) AS month, COUNT(*) AS launches FROM spacex_launches GROUP BY 1 ORDER BY 1" },
  ],
  nyc311: [
    { name: "Top complaints", sql: "SELECT complaint_type, COUNT(*) AS cnt FROM nyc_311 GROUP BY complaint_type ORDER BY cnt DESC LIMIT 20" },
    { name: "By borough", sql: "SELECT borough, COUNT(*) AS cnt FROM nyc_311 GROUP BY borough ORDER BY cnt DESC" },
  ],
  covid: [
    { name: "Cases leaders", sql: "SELECT country, cases, deaths, today_cases, continent FROM covid_countries ORDER BY cases DESC LIMIT 30" },
    { name: "Per million", sql: "SELECT country, cases_per_million, deaths_per_million FROM covid_countries ORDER BY cases_per_million DESC LIMIT 30" },
  ],
  launches: [
    { name: "Upcoming", sql: "SELECT name, net, agency, location, rocket, status FROM space_launches ORDER BY net ASC LIMIT 40" },
    { name: "By agency", sql: "SELECT agency, COUNT(*) AS cnt FROM space_launches GROUP BY agency ORDER BY cnt DESC" },
  ],
  eonet: [
    { name: "Open events", sql: "SELECT title, category, ts, latitude, longitude FROM natural_events ORDER BY ts DESC LIMIT 50" },
    { name: "By category", sql: "SELECT category, COUNT(*) AS events FROM natural_events GROUP BY category ORDER BY events DESC" },
  ],
  citibike: [
    { name: "Emptiest docks", sql: "SELECT name, capacity, bikes_available, docks_available FROM citibike_stations WHERE is_renting AND capacity > 0 ORDER BY pct_full ASC LIMIT 25" },
    { name: "System totals", sql: "SELECT COUNT(*) AS stations, SUM(bikes_available) AS bikes, SUM(ebikes_available) AS ebikes, SUM(docks_available) AS open_docks FROM citibike_stations" },
  ],
  spaceweather: [
    { name: "Storm periods", sql: "SELECT ts, kp, storm_level FROM space_weather WHERE kp >= 5 ORDER BY ts DESC" },
    { name: "Daily peak Kp", sql: "SELECT CAST(ts AS DATE) AS day, MAX(kp) AS peak_kp FROM space_weather GROUP BY 1 ORDER BY 1" },
  ],
  ukcarbon: [
    { name: "Greenest half hours", sql: "SELECT ts, forecast, actual, intensity_index FROM uk_carbon ORDER BY forecast ASC LIMIT 10" },
    { name: "Forecast error", sql: "SELECT ts, forecast, actual, actual - forecast AS error FROM uk_carbon WHERE actual IS NOT NULL ORDER BY ts" },
  ],
  pageviews: [
    { name: "Top 25", sql: "SELECT rank, article, views FROM wiki_top_articles ORDER BY rank LIMIT 25" },
    { name: "Share of top 100", sql: "SELECT article, views, ROUND(100.0 * views / SUM(views) OVER (), 1) AS pct FROM wiki_top_articles ORDER BY views DESC LIMIT 25" },
  ],
  gdacs: [
    { name: "Red & orange alerts", sql: "SELECT event_type, title, country, alert_level, start_ts FROM disaster_alerts WHERE alert_level IN ('Red', 'Orange') ORDER BY alert_score DESC" },
    { name: "By type", sql: "SELECT event_type, COUNT(*) AS events FROM disaster_alerts GROUP BY event_type ORDER BY events DESC" },
  ],
  buoys: [
    { name: "Biggest waves", sql: "SELECT station, latitude, longitude, wave_height_m, wind_speed_ms FROM ocean_buoys WHERE wave_height_m IS NOT NULL ORDER BY wave_height_m DESC LIMIT 20" },
    { name: "Warmest water", sql: "SELECT station, latitude, longitude, water_temp_c FROM ocean_buoys WHERE water_temp_c IS NOT NULL ORDER BY water_temp_c DESC LIMIT 20" },
  ],
  mbta: [
    { name: "Vehicles by mode", sql: "SELECT route_type, COUNT(*) AS vehicles FROM mbta_vehicles GROUP BY route_type ORDER BY vehicles DESC" },
    { name: "Crowded right now", sql: "SELECT route, label, occupancy, status FROM mbta_vehicles WHERE occupancy IS NOT NULL ORDER BY occupancy" },
  ],
  aurora: [
    { name: "Best chances", sql: "SELECT latitude, longitude, probability FROM aurora_forecast ORDER BY probability DESC LIMIT 25" },
    { name: "By hemisphere", sql: "SELECT CASE WHEN latitude >= 0 THEN 'North' ELSE 'South' END AS hemisphere, MAX(probability) AS peak, AVG(probability) AS mean FROM aurora_forecast GROUP BY 1" },
  ],
  asteroids: [
    { name: "Closest passes", sql: "SELECT name, approach_ts, distance_ld, velocity_kms, diameter_m FROM asteroid_approaches ORDER BY distance_ld ASC LIMIT 15" },
    { name: "Biggest", sql: "SELECT name, diameter_m, distance_ld, approach_ts FROM asteroid_approaches ORDER BY diameter_m DESC LIMIT 10" },
  ],
  steam: [
    { name: "Most played", sql: "SELECT name, developer, peak_players, positive_pct, price_usd FROM steam_games ORDER BY peak_players DESC LIMIT 25" },
    { name: "Best reviewed", sql: "SELECT name, positive_pct, positive + negative AS reviews FROM steam_games WHERE positive + negative > 1000 ORDER BY positive_pct DESC LIMIT 20" },
  ],
  bitcoin: [
    { name: "Latest blocks", sql: "SELECT height, ts, pool, tx_count, median_fee_sat_vb FROM bitcoin_blocks ORDER BY height DESC LIMIT 20" },
    { name: "Pool share", sql: "SELECT pool, COUNT(*) AS blocks FROM bitcoin_blocks GROUP BY pool ORDER BY blocks DESC" },
  ],
  debt: [
    { name: "Latest", sql: "SELECT record_date, total_debt, held_by_public, intragovernmental FROM us_debt ORDER BY record_date DESC LIMIT 10" },
    { name: "Yearly growth", sql: "SELECT EXTRACT(year FROM record_date) AS yr, MAX(total_debt) - MIN(total_debt) AS added FROM us_debt GROUP BY 1 ORDER BY 1" },
  ],
  usafacts_states: [
    { name: "Income ranking (latest year)", sql: "SELECT state_name, median_household_income, poverty_rate FROM usafacts_states WHERE yr = (SELECT MAX(yr) FROM usafacts_states) ORDER BY median_household_income DESC" },
    { name: "Population growth since 2012", sql: "SELECT state_name, MAX(CASE WHEN yr = 2012 THEN population END) AS pop_2012, MAX(CASE WHEN yr = (SELECT MAX(yr) FROM usafacts_states) THEN population END) AS pop_latest, ROUND(100.0 * MAX(CASE WHEN yr = (SELECT MAX(yr) FROM usafacts_states) THEN population END) / MAX(CASE WHEN yr = 2012 THEN population END) - 100, 1) AS growth_pct FROM usafacts_states GROUP BY state_name ORDER BY growth_pct DESC" },
    { name: "State averages by year", sql: "SELECT yr, ROUND(AVG(unemployment_rate), 2) AS avg_unemployment, ROUND(AVG(poverty_rate), 2) AS avg_poverty, ROUND(AVG(bachelors_or_higher_pct), 1) AS avg_bachelors FROM usafacts_states GROUP BY yr ORDER BY yr" },
  ],
  usafacts_nation: [
    { name: "Latest months", sql: "SELECT month, unemployment_rate, inflation_yoy_pct, fed_funds_rate, gas_price_usd FROM usafacts_nation ORDER BY month DESC LIMIT 12" },
    { name: "Yearly averages", sql: "SELECT yr, ROUND(AVG(unemployment_rate), 2) AS unemployment, ROUND(AVG(inflation_yoy_pct), 2) AS inflation, ROUND(AVG(gas_price_usd), 2) AS gas FROM usafacts_nation GROUP BY yr ORDER BY yr" },
    { name: "Highest-inflation months", sql: "SELECT month, inflation_yoy_pct, fed_funds_rate FROM usafacts_nation WHERE inflation_yoy_pct IS NOT NULL ORDER BY inflation_yoy_pct DESC LIMIT 12" },
    { name: "Jobs added per year", sql: "SELECT yr, MAX(payrolls_k) - MIN(payrolls_k) AS jobs_change_k FROM usafacts_nation GROUP BY yr ORDER BY yr" },
  ],
  climate: [
    { name: "Warmest years", sql: "SELECT year, ROUND(AVG(anomaly_c), 2) AS anomaly_c FROM global_temperature GROUP BY year ORDER BY anomaly_c DESC LIMIT 15" },
    { name: "By decade", sql: "SELECT (year // 10) * 10 AS decade, ROUND(AVG(anomaly_c), 2) AS anomaly_c FROM global_temperature GROUP BY 1 ORDER BY 1" },
  ],
} satisfies Record<SourceKind, { name: string; sql: string }[]>;

/** SQL queries that work well with the wiki_stream table for the Query view. */
export const STREAM_SQL_SNIPPETS = [
  {
    name: "Edits per minute",
    sql: "SELECT date_trunc('minute', ts) AS minute, COUNT(*) AS edits FROM wiki_stream GROUP BY 1 ORDER BY 1",
  },
  {
    name: "Top 10 wikis",
    sql: "SELECT wiki, COUNT(*) AS edits FROM wiki_stream GROUP BY wiki ORDER BY edits DESC LIMIT 10",
  },
  {
    name: "Bot ratio",
    sql: "SELECT bot, COUNT(*) AS cnt, ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) AS pct FROM wiki_stream GROUP BY bot",
  },
  {
    name: "Biggest edits",
    sql: "SELECT title, wiki, \"user\", delta, ts FROM wiki_stream ORDER BY ABS(delta) DESC LIMIT 20",
  },
  {
    name: "Active editors",
    sql: "SELECT \"user\", COUNT(*) AS edits, SUM(delta) AS total_delta FROM wiki_stream WHERE NOT bot GROUP BY 1 ORDER BY edits DESC LIMIT 15",
  },
  {
    name: "Namespace breakdown",
    sql: "SELECT namespace, COUNT(*) AS edits, AVG(delta) AS avg_delta FROM wiki_stream GROUP BY namespace ORDER BY edits DESC",
  },
];
