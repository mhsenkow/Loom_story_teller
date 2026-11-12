// =================================================================
// Loom — Public portals on the data library Discover screen
// =================================================================
// Each portal is a catalog people already know. Discover connects it
// in the app: a live feed (`feedKinds`) and/or a curated CSV (`packIds`).
// The homepage stays a secondary link to the catalog itself.
// =================================================================

import type { SourceKind } from "./sourceRegistry";

export interface PublicPortal {
  id: string;
  title: string;
  blurb: string;
  homepage: string;
  feedKinds: readonly SourceKind[];
  packIds: readonly string[];
}

export const PUBLIC_PORTALS: readonly PublicPortal[] = [
  {
    id: "owid",
    title: "Our World in Data",
    blurb: "Country-year series for health, climate, forests, and income. Explore loads the full CSV.",
    homepage: "https://ourworldindata.org/data",
    feedKinds: [],
    packIds: [
      "owid-co2-per-capita",
      "owid-life-expectancy",
      "owid-child-mortality",
      "owid-maternal-mortality",
      "owid-happiness",
      "owid-human-development",
      "owid-population",
      "owid-gdp-per-capita",
      "owid-renewables",
      "owid-forest-share",
    ],
  },
  {
    id: "europa",
    title: "data.europa.eu",
    blurb: "Eurostat population on 1 January — country, year, and people, ready to chart.",
    homepage: "https://data.europa.eu/en/data",
    feedKinds: [],
    packIds: ["eurostat-population"],
  },
  {
    id: "nasa",
    title: "data.nasa.gov",
    blurb: "Fireballs and asteroid flybys from NASA, the ISS trail, and every confirmed exoplanet.",
    homepage: "https://data.nasa.gov",
    feedKinds: ["fireballs", "asteroids", "iss"],
    packIds: ["nasa-exoplanets"],
  },
  {
    id: "fema",
    title: "OpenFEMA",
    blurb: "The latest US disaster declarations live, plus 8,000 rows of declaration history.",
    homepage: "https://www.fema.gov/about/openfema/data-sets",
    feedKinds: ["fema"],
    packIds: ["fema-declarations"],
  },
  {
    id: "air",
    title: "OpenAQ",
    blurb: "Country PM2.5 since 1998, plus live air quality in 12 cities from Open-Meteo.",
    homepage: "https://openaq.org",
    feedKinds: ["aq"],
    packIds: ["owid-pm25"],
  },
  {
    id: "opensky",
    title: "OpenSky Network",
    blurb: "Aircraft over the US right now — position, altitude, and speed.",
    homepage: "https://opensky-network.org",
    feedKinds: ["opensky"],
    packIds: [],
  },
  {
    id: "world-bank",
    title: "World Bank",
    blurb: "GDP, population, life expectancy, and CO₂ per person by country since 2000.",
    homepage: "https://data.worldbank.org/",
    feedKinds: ["world_bank"],
    packIds: [],
  },
  {
    id: "fivethirtyeight",
    title: "FiveThirtyEight",
    blurb: "Small public tables that chart immediately — majors, airlines, driving, and candy.",
    homepage: "https://github.com/fivethirtyeight/data",
    feedKinds: [],
    packIds: ["college-majors", "airline-safety", "bad-drivers", "candy-ranking"],
  },
  {
    id: "energy",
    title: "Energy history",
    blurb: "Daily Brent crude since 1987, next to the global power-plant census.",
    homepage: "https://www.eia.gov/opendata/",
    feedKinds: [],
    packIds: ["brent-oil", "power-plants"],
  },
];
