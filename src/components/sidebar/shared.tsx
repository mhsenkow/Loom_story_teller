"use client";

import { useLoomStore } from "@/lib/store";
import type { DataGovDataset, DataGovSortKey } from "@/lib/tauri";
import { shellModeFromWidth } from "@/lib/shellLayout";

/** Tauri invoke rejects with string errors from Rust — normalize for UI. */
export function ipcErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

/** Save-to-folder writes .csv bytes — only safe for real CSV URLs. */
export function dataGovResourceSaveable(res: { format: string; url: string }): boolean {
  return res.format === "CSV" || /\.csv(\?|$)/i.test(res.url);
}

/** Leave Data & sources full-screen and show the chart canvas (esp. mobile). */
export function leaveSourcesShowChart() {
  const s = useLoomStore.getState();
  s.setDataSourcesExpanded(false);
  s.setDataRegionOpen(false);
  s.setViewMode("chart");
  s.setPanelTab("chart");
  if (typeof window !== "undefined") {
    const mode = shellModeFromWidth(window.innerWidth);
    if (mode === "phone" || mode === "tablet") {
      if (s.sidebarOpen) s.toggleSidebar();
    }
    if (mode === "phone" && s.panelOpen) s.togglePanel();
  }
}

/** One-click public CSV packs (web Explore / desktop save). */
export const CURATED_OPEN_PACKS: {
  id: string;
  title: string;
  blurb: string;
  url: string;
  source: string;
}[] = [
  {
    id: "owid-co2-per-capita",
    title: "CO₂ emissions per person",
    blurb: "Every country since 1750 — the classic climate-inequality chart.",
    url: "https://ourworldindata.org/grapher/co-emissions-per-capita.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / Global Carbon Project",
  },
  {
    id: "owid-life-expectancy",
    title: "Life expectancy",
    blurb: "Two centuries of longer lives, country by country.",
    url: "https://ourworldindata.org/grapher/life-expectancy.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / UN WPP",
  },
  {
    id: "owid-gdp-per-capita",
    title: "GDP per person",
    blurb: "Income by country since 1990, with world regions for color.",
    url: "https://ourworldindata.org/grapher/gdp-per-capita-worldbank.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / World Bank",
  },
  {
    id: "owid-renewables",
    title: "Renewable electricity share",
    blurb: "How fast each country's grid is going green.",
    url: "https://ourworldindata.org/grapher/share-electricity-renewables.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / Ember",
  },
  {
    id: "owid-population",
    title: "Population since 10,000 BCE",
    blurb: "Country and world population over the long run.",
    url: "https://ourworldindata.org/grapher/population.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / HYDE / UN",
  },
  {
    id: "keeling-curve",
    title: "Keeling curve (Mauna Loa CO₂)",
    blurb: "Monthly atmospheric CO₂ since 1958 — the sawtooth that keeps climbing.",
    url: "https://raw.githubusercontent.com/datasets/co2-ppm/main/data/co2-mm-mlo.csv",
    source: "NOAA GML via datahub",
  },
  {
    id: "nasa-exoplanets",
    title: "Every confirmed exoplanet",
    blurb: "~6,000 planets — size, mass, orbit, distance, and how they were found.",
    url: "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+pl_name,hostname,disc_year,discoverymethod,pl_rade,pl_bmasse,pl_orbper,sy_dist+from+pscomppars&format=csv",
    source: "NASA Exoplanet Archive",
  },
  {
    id: "power-plants",
    title: "Global power plants",
    blurb: "35,000 plants on a map — capacity and fuel for every country.",
    url: "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv",
    source: "World Resources Institute",
  },
  {
    id: "gapminder",
    title: "Gapminder: wealth & health",
    blurb: "142 countries, 1952–2007 — life expectancy, GDP per person, population, continent. The classic bubble chart.",
    url: "https://raw.githubusercontent.com/plotly/datasets/master/gapminderDataFiveYear.csv",
    source: "Gapminder via plotly/datasets",
  },
  {
    id: "quakes-m7",
    title: "Every M7+ earthquake since 1900",
    blurb: "1,600 great earthquakes — magnitude, depth, and location on a century-long timeline.",
    url: "https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&starttime=1900-01-01&minmagnitude=7&orderby=time-asc",
    source: "USGS ComCat",
  },
  {
    id: "nobel-laureates",
    title: "Nobel Prize laureates",
    blurb: "Every laureate since 1901 — category, year, birthplace, gender, and prize share.",
    url: "https://api.nobelprize.org/2.1/laureates?limit=1500&format=csv",
    source: "Nobel Prize API",
  },
  {
    id: "candy-ranking",
    title: "The ultimate candy ranking",
    blurb: "85 candies — chocolate? fruity? sugar, price, and how often each won head-to-head.",
    url: "https://raw.githubusercontent.com/fivethirtyeight/data/master/candy-power-ranking/candy-data.csv",
    source: "FiveThirtyEight",
  },
  {
    id: "us-cities",
    title: "US cities by population",
    blurb: "Largest US cities with coordinates — instant bubble map.",
    url: "https://raw.githubusercontent.com/plotly/datasets/master/2014_us_cities.csv",
    source: "US Census via plotly/datasets",
  },
];

export const DATA_GOV_ROW_OPTIONS = [40, 80, 120, 200] as const;

export const DATA_GOV_SORT_OPTIONS: { value: DataGovSortKey; label: string }[] = [
  { value: "newest", label: "Newest listed" },
  { value: "updated", label: "Recently updated" },
  { value: "relevance", label: "Relevance" },
  { value: "title_az", label: "Title A–Z" },
  { value: "title_za", label: "Title Z–A" },
];

export function filterDatasetsLocal(datasets: DataGovDataset[], text: string): DataGovDataset[] {
  const q = text.trim().toLowerCase();
  if (!q) return datasets;
  return datasets.filter((d) => {
    const hay = `${d.title} ${d.organization ?? ""} ${d.name}`.toLowerCase();
    return hay.includes(q);
  });
}

export function exploreFilename(ds: DataGovDataset, res: { name: string }): string {
  const base = res.name !== "CSV" ? res.name : ds.title;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return cleaned.toLowerCase().endsWith(".csv") ? cleaned : `${cleaned}.csv`;
}

export function SectionHeading({
  title,
  lede,
  meta,
}: {
  title: string;
  lede?: string;
  meta?: string;
}) {
  return (
    <div className="px-1 mb-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-loom-text tracking-tight">{title}</h3>
        {meta && <span className="text-2xs text-loom-muted tabular-nums shrink-0">{meta}</span>}
      </div>
      {lede && <p className="text-2xs text-loom-muted mt-0.5 leading-snug max-w-[36ch]">{lede}</p>}
    </div>
  );
}
