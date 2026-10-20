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
  fireballs: [
    { name: "Most energetic", sql: "SELECT ts, latitude, longitude, impact_kt, energy_e10j, altitude_km FROM fireballs ORDER BY impact_kt DESC LIMIT 20" },
    { name: "Fireballs per year", sql: "SELECT EXTRACT(year FROM ts) AS yr, COUNT(*) AS fireballs, ROUND(SUM(impact_kt), 1) AS total_kt FROM fireballs GROUP BY 1 ORDER BY 1" },
    { name: "Fastest entries", sql: "SELECT ts, velocity_kms, altitude_km, impact_kt FROM fireballs WHERE velocity_kms IS NOT NULL ORDER BY velocity_kms DESC LIMIT 15" },
  ],
  satellites: [
    { name: "Highest orbits", sql: "SELECT name, object_type, apogee_km, perigee_km, inclination FROM visual_satellites ORDER BY apogee_km DESC LIMIT 20" },
    { name: "By object type", sql: "SELECT object_type, COUNT(*) AS cnt, ROUND(AVG(inclination), 1) AS avg_incl FROM visual_satellites GROUP BY 1 ORDER BY cnt DESC" },
    { name: "Oldest still up", sql: "SELECT name, launch_year, perigee_km FROM visual_satellites ORDER BY launch_year ASC LIMIT 15" },
  ],
  internet_outages: [
    { name: "Worst drops", sql: "SELECT ts, country, datasource, level, drop_pct FROM internet_outages WHERE level = 'critical' ORDER BY drop_pct DESC LIMIT 20" },
    { name: "Alerts by country", sql: "SELECT country, COUNT(*) AS alerts, MAX(drop_pct) AS worst_drop FROM internet_outages WHERE level = 'critical' GROUP BY country ORDER BY alerts DESC LIMIT 20" },
    { name: "By signal", sql: "SELECT datasource, level, COUNT(*) AS cnt FROM internet_outages GROUP BY 1, 2 ORDER BY cnt DESC" },
  ],
  faa_delays: [
    { name: "Current problems", sql: "SELECT airport, status_type, reason, max_delay_min, avg_delay_min FROM faa_airport_status ORDER BY max_delay_min DESC" },
    { name: "By status type", sql: "SELECT status_type, COUNT(*) AS airports FROM faa_airport_status GROUP BY 1 ORDER BY airports DESC" },
  ],
  lobbying: [
    { name: "Biggest filings", sql: "SELECT client, registrant, amount_usd, amount_kind, issue_codes FROM lobbying_filings WHERE amount_usd IS NOT NULL ORDER BY amount_usd DESC LIMIT 20" },
    { name: "Busiest firms", sql: "SELECT registrant, COUNT(*) AS filings, SUM(amount_usd) AS total_usd FROM lobbying_filings GROUP BY registrant ORDER BY filings DESC LIMIT 15" },
    { name: "Clients by state", sql: "SELECT client_state, COUNT(*) AS filings FROM lobbying_filings WHERE client_state IS NOT NULL GROUP BY 1 ORDER BY filings DESC" },
  ],
  fda_recalls: [
    { name: "Class I (most serious)", sql: "SELECT report_date, product_type, firm, reason FROM fda_recalls WHERE classification = 'Class I' ORDER BY report_date DESC LIMIT 25" },
    { name: "By type and class", sql: "SELECT product_type, classification, COUNT(*) AS recalls FROM fda_recalls GROUP BY 1, 2 ORDER BY 1, 2" },
    { name: "Top firms", sql: "SELECT firm, COUNT(*) AS recalls FROM fda_recalls GROUP BY firm ORDER BY recalls DESC LIMIT 15" },
  ],
  vehicle_recalls: [
    { name: "Largest recalls", sql: "SELECT report_date, manufacturer, subject, potentially_affected FROM vehicle_recalls ORDER BY potentially_affected DESC LIMIT 20" },
    { name: "Do-not-drive warnings", sql: "SELECT report_date, manufacturer, subject, component FROM vehicle_recalls WHERE do_not_drive OR park_outside ORDER BY report_date DESC" },
    { name: "By component", sql: "SELECT component, COUNT(*) AS recalls, SUM(potentially_affected) AS vehicles FROM vehicle_recalls GROUP BY component ORDER BY recalls DESC LIMIT 15" },
  ],
  arxiv: [
    { name: "Newest papers", sql: "SELECT published, primary_category, title, n_authors FROM arxiv_papers ORDER BY published DESC LIMIT 25" },
    { name: "By category", sql: "SELECT field, primary_category, COUNT(*) AS papers, ROUND(AVG(n_authors), 1) AS avg_authors FROM arxiv_papers GROUP BY 1, 2 ORDER BY papers DESC" },
    { name: "Biggest author lists", sql: "SELECT title, primary_category, n_authors FROM arxiv_papers ORDER BY n_authors DESC LIMIT 15" },
  ],
  github_events: [
    { name: "Event mix", sql: "SELECT event_type, COUNT(*) AS events FROM github_events GROUP BY 1 ORDER BY events DESC" },
    { name: "Busiest repos", sql: "SELECT repo, COUNT(*) AS events FROM github_events GROUP BY repo ORDER BY events DESC LIMIT 15" },
    { name: "Events per minute", sql: "SELECT date_trunc('minute', ts) AS minute, COUNT(*) AS events FROM github_events GROUP BY 1 ORDER BY 1" },
  ],
  books: [
    { name: "Open Library today", sql: "SELECT rank, title, author, first_year, editions FROM trending_books WHERE site = 'Open Library' ORDER BY rank LIMIT 25" },
    { name: "Gutenberg downloads", sql: "SELECT rank, title, author, downloads FROM trending_books WHERE site = 'Project Gutenberg' ORDER BY downloads DESC" },
    { name: "By decade first published", sql: "SELECT (first_year // 10) * 10 AS decade, COUNT(*) AS books FROM trending_books WHERE first_year IS NOT NULL GROUP BY 1 ORDER BY 1" },
  ],
  nyc_inspections: [
    { name: "Worst scores", sql: "SELECT restaurant, borough, cuisine, score, grade, inspection_date FROM nyc_restaurant_inspections WHERE score IS NOT NULL ORDER BY score DESC LIMIT 20" },
    { name: "Grades by borough", sql: "SELECT borough, grade, COUNT(DISTINCT camis) AS restaurants FROM nyc_restaurant_inspections WHERE grade IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2" },
    { name: "Common violations", sql: "SELECT violation_code, violation, COUNT(*) AS cnt FROM nyc_restaurant_inspections WHERE violation_code IS NOT NULL GROUP BY 1, 2 ORDER BY cnt DESC LIMIT 15" },
  ],
  chicago_crime: [
    { name: "By offense", sql: "SELECT primary_type, COUNT(*) AS reports, ROUND(100.0 * AVG(CASE WHEN arrest THEN 1 ELSE 0 END), 1) AS arrest_pct FROM chicago_crime GROUP BY 1 ORDER BY reports DESC" },
    { name: "Reports per day", sql: "SELECT date_trunc('day', ts) AS day, COUNT(*) AS reports FROM chicago_crime GROUP BY 1 ORDER BY 1" },
    { name: "By district", sql: "SELECT district, COUNT(*) AS reports FROM chicago_crime GROUP BY district ORDER BY reports DESC" },
  ],
  nyc_parking: [
    { name: "Most common violations", sql: "SELECT violation, COUNT(*) AS tickets, ROUND(AVG(fine_amount), 2) AS avg_fine FROM nyc_parking_tickets GROUP BY violation ORDER BY tickets DESC LIMIT 15" },
    { name: "Fines by county", sql: "SELECT county, COUNT(*) AS tickets, SUM(fine_amount) AS fines FROM nyc_parking_tickets GROUP BY county ORDER BY fines DESC" },
    { name: "Out-of-state plates", sql: "SELECT plate_state, COUNT(*) AS tickets FROM nyc_parking_tickets WHERE plate_state <> 'NY' GROUP BY 1 ORDER BY tickets DESC LIMIT 15" },
  ],
  powerball: [
    { name: "Most drawn Powerballs", sql: "SELECT powerball, COUNT(*) AS draws FROM powerball_draws GROUP BY powerball ORDER BY draws DESC LIMIT 15" },
    { name: "Latest draws", sql: "SELECT draw_date, n1, n2, n3, n4, n5, powerball, multiplier FROM powerball_draws ORDER BY draw_date DESC LIMIT 20" },
    { name: "Draws per year", sql: "SELECT yr, COUNT(*) AS draws, ROUND(AVG(powerball), 1) AS avg_powerball FROM powerball_draws GROUP BY yr ORDER BY yr" },
  ],
  fed_spending: [
    { name: "Largest agencies", sql: "SELECT agency, budget_authority, obligated, outlays, pct_of_total FROM federal_agencies ORDER BY budget_authority DESC LIMIT 20" },
    { name: "Spent vs authorized", sql: "SELECT agency, ROUND(100.0 * outlays / budget_authority, 1) AS outlay_pct FROM federal_agencies WHERE budget_authority > 1000000000 ORDER BY outlay_pct DESC" },
  ],
  bikeshare: [
    { name: "Systems overview", sql: "SELECT system, COUNT(*) AS stations, SUM(bikes_available) AS bikes, SUM(ebikes_available) AS ebikes FROM bikeshare_stations GROUP BY system ORDER BY stations DESC" },
    { name: "Empty docks", sql: "SELECT system, name, capacity, bikes_available FROM bikeshare_stations WHERE bikes_available = 0 AND is_renting ORDER BY capacity DESC LIMIT 20" },
    { name: "Fullest stations", sql: "SELECT system, name, pct_full, capacity FROM bikeshare_stations ORDER BY pct_full DESC LIMIT 20" },
  ],
  bluesky: [
    { name: "Posts per minute", sql: "SELECT ts, posts_per_min FROM bluesky_activity WHERE dimension = 'total' ORDER BY ts" },
    { name: "Top languages", sql: "SELECT key AS lang, SUM(posts) AS posts FROM bluesky_activity WHERE dimension = 'language' GROUP BY 1 ORDER BY posts DESC LIMIT 15" },
    { name: "Top hashtags", sql: "SELECT key AS hashtag, SUM(posts) AS posts FROM bluesky_activity WHERE dimension = 'hashtag' GROUP BY 1 ORDER BY posts DESC LIMIT 20" },
  ],
  bgp: [
    { name: "Updates per sample", sql: "SELECT ts, announcements, withdrawals FROM bgp_updates WHERE dimension = 'total' ORDER BY ts" },
    { name: "Noisiest origin networks", sql: "SELECT key AS origin, SUM(announcements) AS announced FROM bgp_updates WHERE dimension = 'origin_asn' GROUP BY 1 ORDER BY announced DESC LIMIT 20" },
    { name: "By prefix length", sql: "SELECT key AS prefix_length, SUM(announcements) AS announced, SUM(withdrawals) AS withdrawn FROM bgp_updates WHERE dimension = 'prefix_len' GROUP BY 1 ORDER BY announced DESC" },
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
  {
    // Edit summaries for reverts / undos / rollbacks ("Reverted edits by …", "Undid revision …", "rv vandalism")
    name: "Reverts",
    sql: "SELECT ts, wiki, title, \"user\", delta, comment FROM wiki_stream WHERE regexp_matches(lower(comment), '(^|\\W)(revert|reverted|undid|undo|rv|rvv|rollback)(\\W|$)') ORDER BY ts DESC LIMIT 50",
  },
  {
    name: "Revert rate by wiki",
    sql: "SELECT wiki, COUNT(*) AS edits, SUM(CASE WHEN regexp_matches(lower(comment), '(^|\\W)(revert|reverted|undid|undo|rv|rvv|rollback)(\\W|$)') THEN 1 ELSE 0 END) AS reverts, ROUND(100.0 * SUM(CASE WHEN regexp_matches(lower(comment), '(^|\\W)(revert|reverted|undid|undo|rv|rvv|rollback)(\\W|$)') THEN 1 ELSE 0 END) / COUNT(*), 2) AS revert_pct FROM wiki_stream WHERE edit_type = 'edit' GROUP BY wiki HAVING COUNT(*) >= 20 ORDER BY revert_pct DESC LIMIT 20",
  },
  {
    // Pages with several reverts from more than one editor in the buffer — likely edit wars
    name: "Possible edit wars",
    sql: "SELECT wiki, title, COUNT(*) AS edits, COUNT(DISTINCT \"user\") AS editors, SUM(CASE WHEN regexp_matches(lower(comment), '(^|\\W)(revert|reverted|undid|undo|rv|rvv|rollback)(\\W|$)') THEN 1 ELSE 0 END) AS reverts FROM wiki_stream WHERE NOT bot GROUP BY wiki, title HAVING SUM(CASE WHEN regexp_matches(lower(comment), '(^|\\W)(revert|reverted|undid|undo|rv|rvv|rollback)(\\W|$)') THEN 1 ELSE 0 END) >= 2 AND COUNT(DISTINCT \"user\") >= 2 ORDER BY reverts DESC, edits DESC LIMIT 20",
  },
];
