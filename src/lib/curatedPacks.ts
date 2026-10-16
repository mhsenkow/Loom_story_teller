// =================================================================
// Loom — Curated open-data packs (one-click public CSVs)
// =================================================================
// Complete CSVs fetched via the Worker's /api/fetch-csv on web or saved to
// the mounted folder on desktop. `joinKeys` name the CSV's own columns
// (hints for Collections; checked against the loaded header at link time).
// =================================================================

import type { JoinRole, SourceGeo, SourceGrain, SourceTopic } from "./sourceRegistry";

export interface CuratedPack {
  id: string;
  title: string;
  blurb: string;
  url: string;
  source: string;
  topics: SourceTopic[];
  geo: SourceGeo;
  grain: SourceGrain;
  joinKeys?: Partial<Record<JoinRole, string>>;
}

export const CURATED_OPEN_PACKS: CuratedPack[] = [
  {
    id: "owid-co2-per-capita",
    title: "CO₂ emissions per person",
    blurb: "Every country since 1750 — the classic climate-inequality chart.",
    url: "https://ourworldindata.org/grapher/co-emissions-per-capita.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / Global Carbon Project",
    topics: ["climate", "people"],
    geo: "world",
    grain: "year",
    joinKeys: { country: "code", year: "year" },
  },
  {
    id: "owid-life-expectancy",
    title: "Life expectancy",
    blurb: "Two centuries of longer lives, country by country.",
    url: "https://ourworldindata.org/grapher/life-expectancy.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / UN WPP",
    topics: ["health", "people"],
    geo: "world",
    grain: "year",
    joinKeys: { country: "code", year: "year" },
  },
  {
    id: "owid-gdp-per-capita",
    title: "GDP per person",
    blurb: "Income by country since 1990, with world regions for color.",
    url: "https://ourworldindata.org/grapher/gdp-per-capita-worldbank.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / World Bank",
    topics: ["economy"],
    geo: "world",
    grain: "year",
    joinKeys: { country: "code", year: "year" },
  },
  {
    id: "owid-renewables",
    title: "Renewable electricity share",
    blurb: "How fast each country's grid is going green.",
    url: "https://ourworldindata.org/grapher/share-electricity-renewables.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / Ember",
    topics: ["energy", "climate"],
    geo: "world",
    grain: "year",
    joinKeys: { country: "code", year: "year" },
  },
  {
    id: "owid-population",
    title: "Population since 10,000 BCE",
    blurb: "Country and world population over the long run.",
    url: "https://ourworldindata.org/grapher/population.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / HYDE / UN",
    topics: ["people"],
    geo: "world",
    grain: "year",
    joinKeys: { country: "code", year: "year" },
  },
  {
    id: "keeling-curve",
    title: "Keeling curve (Mauna Loa CO₂)",
    blurb: "Monthly atmospheric CO₂ since 1958 — the sawtooth that keeps climbing.",
    url: "https://raw.githubusercontent.com/datasets/co2-ppm/main/data/co2-mm-mlo.csv",
    source: "NOAA GML via datahub",
    topics: ["climate"],
    geo: "world",
    grain: "month",
  },
  {
    id: "nasa-exoplanets",
    title: "Every confirmed exoplanet",
    blurb: "~6,000 planets — size, mass, orbit, distance, and how they were found.",
    url: "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+pl_name,hostname,disc_year,discoverymethod,pl_rade,pl_bmasse,pl_orbper,sy_dist+from+pscomppars&format=csv",
    source: "NASA Exoplanet Archive",
    topics: ["space"],
    geo: "world",
    grain: "snapshot",
    joinKeys: { year: "disc_year" },
  },
  {
    id: "power-plants",
    title: "Global power plants",
    blurb: "35,000 plants on a map — capacity and fuel for every country.",
    url: "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv",
    source: "World Resources Institute",
    topics: ["energy"],
    geo: "world",
    grain: "snapshot",
    joinKeys: { country: "country" },
  },
  {
    id: "gapminder",
    title: "Gapminder: wealth & health",
    blurb: "142 countries, 1952–2007 — life expectancy, GDP per person, population, continent. The classic bubble chart.",
    url: "https://raw.githubusercontent.com/plotly/datasets/master/gapminderDataFiveYear.csv",
    source: "Gapminder via plotly/datasets",
    topics: ["economy", "health", "people"],
    geo: "world",
    grain: "year",
    joinKeys: { country: "country", year: "year" },
  },
  {
    id: "quakes-m7",
    title: "Every M7+ earthquake since 1900",
    blurb: "1,600 great earthquakes — magnitude, depth, and location on a century-long timeline.",
    url: "https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&starttime=1900-01-01&minmagnitude=7&orderby=time-asc",
    source: "USGS ComCat",
    topics: ["disasters"],
    geo: "world",
    grain: "event",
    joinKeys: { date: "time" },
  },
  {
    id: "nobel-laureates",
    title: "Nobel Prize laureates",
    blurb: "Every laureate since 1901 — category, year, birthplace, gender, and prize share.",
    url: "https://api.nobelprize.org/2.1/laureates?limit=1500&format=csv",
    source: "Nobel Prize API",
    topics: ["culture", "people"],
    geo: "world",
    grain: "event",
  },
  {
    id: "candy-ranking",
    title: "The ultimate candy ranking",
    blurb: "85 candies — chocolate? fruity? sugar, price, and how often each won head-to-head.",
    url: "https://raw.githubusercontent.com/fivethirtyeight/data/master/candy-power-ranking/candy-data.csv",
    source: "FiveThirtyEight",
    topics: ["culture"],
    geo: "us",
    grain: "snapshot",
  },
  {
    id: "us-cities",
    title: "US cities by population",
    blurb: "Largest US cities with coordinates — instant bubble map.",
    url: "https://raw.githubusercontent.com/plotly/datasets/master/2014_us_cities.csv",
    source: "US Census via plotly/datasets",
    topics: ["people", "cities"],
    geo: "us",
    grain: "snapshot",
  },
];
