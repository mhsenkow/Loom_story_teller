// =================================================================
// Loom — Geographic atlas (world + US TopoJSON) and join keys
// =================================================================
// Loads Natural Earth boundaries via world-atlas / us-atlas, indexes
// features by id / name / ISO / FIPS, and normalizes row keys so
// choropleths can join country_code, cca3, state, etc.
// =================================================================

import { feature as topoFeature, mesh as topoMesh } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import worldCountries from "world-atlas/countries-110m.json";
import worldLand from "world-atlas/land-110m.json";
import usStates from "us-atlas/states-10m.json";

export type AtlasKind = "world" | "us";

export type GeoFeature = Feature<Geometry, GeoJsonProperties> & { id?: string | number };

export interface AtlasBundle {
  kind: AtlasKind;
  features: GeoFeature[];
  /** Multi-line / polygon mesh for coastlines / borders. */
  outline: Geometry | null;
  /** Normalized join key → feature index. */
  byKey: Map<string, number>;
}

/** ISO 3166-1 alpha-3 → numeric id used by world-atlas. */
const ISO3_TO_NUM: Record<string, string> = {
  AFG: "4", ALA: "248", ALB: "8", DZA: "12", ASM: "16", AND: "20", AGO: "24", AIA: "660",
  ATA: "10", ATG: "28", ARG: "32", ARM: "51", ABW: "533", AUS: "36", AUT: "40", AZE: "31",
  BHS: "44", BHR: "48", BGD: "50", BRB: "52", BLR: "112", BEL: "56", BLZ: "84", BEN: "204",
  BMU: "60", BTN: "64", BOL: "68", BES: "535", BIH: "70", BWA: "72", BVT: "74", BRA: "76",
  IOT: "86", BRN: "96", BGR: "100", BFA: "854", BDI: "108", CPV: "132", KHM: "116", CMR: "120",
  CAN: "124", CYM: "136", CAF: "140", TCD: "148", CHL: "152", CHN: "156", CXR: "162", CCK: "166",
  COL: "170", COM: "174", COG: "178", COD: "180", COK: "184", CRI: "188", CIV: "384", HRV: "191",
  CUB: "192", CUW: "531", CYP: "196", CZE: "203", DNK: "208", DJI: "262", DMA: "212", DOM: "214",
  ECU: "218", EGY: "818", SLV: "222", GNQ: "226", ERI: "232", EST: "233", SWZ: "748", ETH: "231",
  FLK: "238", FRO: "234", FJI: "242", FIN: "246", FRA: "250", GUF: "254", PYF: "258", ATF: "260",
  GAB: "266", GMB: "270", GEO: "268", DEU: "276", GHA: "288", GIB: "292", GRC: "300", GRL: "304",
  GRD: "308", GLP: "312", GUM: "316", GTM: "320", GGY: "831", GIN: "324", GNB: "624", GUY: "328",
  HTI: "332", HMD: "334", VAT: "336", HND: "340", HKG: "344", HUN: "348", ISL: "352", IND: "356",
  IDN: "360", IRN: "364", IRQ: "368", IRL: "372", IMN: "833", ISR: "376", ITA: "380", JAM: "388",
  JPN: "392", JEY: "832", JOR: "400", KAZ: "398", KEN: "404", KIR: "296", PRK: "408", KOR: "410",
  KWT: "414", KGZ: "417", LAO: "418", LVA: "428", LBN: "422", LSO: "426", LBR: "430", LBY: "434",
  LIE: "438", LTU: "440", LUX: "442", MAC: "446", MDG: "450", MWI: "454", MYS: "458", MDV: "462",
  MLI: "466", MLT: "470", MHL: "584", MTQ: "474", MRT: "478", MUS: "480", MYT: "175", MEX: "484",
  FSM: "583", MDA: "498", MCO: "492", MNG: "496", MNE: "499", MSR: "500", MAR: "504", MOZ: "508",
  MMR: "104", NAM: "516", NRU: "520", NPL: "524", NLD: "528", NCL: "540", NZL: "554", NIC: "558",
  NER: "562", NGA: "566", NIU: "570", NFK: "574", MKD: "807", MNP: "580", NOR: "578", OMN: "512",
  PAK: "586", PLW: "585", PSE: "275", PAN: "591", PNG: "598", PRY: "600", PER: "604", PHL: "608",
  PCN: "612", POL: "616", PRT: "620", PRI: "630", QAT: "634", REU: "638", ROU: "642", RUS: "643",
  RWA: "646", BLM: "652", SHN: "654", KNA: "659", LCA: "662", MAF: "663", SPM: "666", VCT: "670",
  WSM: "882", SMR: "674", STP: "678", SAU: "682", SEN: "686", SRB: "688", SYC: "690", SLE: "694",
  SGP: "702", SXM: "534", SVK: "703", SVN: "705", SLB: "90", SOM: "706", ZAF: "710", SGS: "239",
  SSD: "728", ESP: "724", LKA: "144", SDN: "729", SUR: "740", SJM: "744", SWE: "752", CHE: "756",
  SYR: "760", TWN: "158", TJK: "762", TZA: "834", THA: "764", TLS: "626", TGO: "768", TKL: "772",
  TON: "776", TTO: "780", TUN: "788", TUR: "792", TKM: "795", TCA: "796", TUV: "798", UGA: "800",
  UKR: "804", ARE: "784", GBR: "826", USA: "840", UMI: "581", URY: "858", UZB: "860", VUT: "548",
  VEN: "862", VNM: "704", VGB: "92", VIR: "850", WLF: "876", ESH: "732", YEM: "887", ZMB: "894",
  ZWE: "716", XKX: "983",
};

const ISO2_TO_ISO3: Record<string, string> = {
  AF: "AFG", AL: "ALB", DZ: "DZA", AS: "ASM", AD: "AND", AO: "AGO", AI: "AIA", AQ: "ATA",
  AG: "ATG", AR: "ARG", AM: "ARM", AW: "ABW", AU: "AUS", AT: "AUT", AZ: "AZE", BS: "BHS",
  BH: "BHR", BD: "BGD", BB: "BRB", BY: "BLR", BE: "BEL", BZ: "BLZ", BJ: "BEN", BM: "BMU",
  BT: "BTN", BO: "BOL", BQ: "BES", BA: "BIH", BW: "BWA", BV: "BVT", BR: "BRA", IO: "IOT",
  BN: "BRN", BG: "BGR", BF: "BFA", BI: "BDI", CV: "CPV", KH: "KHM", CM: "CMR", CA: "CAN",
  KY: "CYM", CF: "CAF", TD: "TCD", CL: "CHL", CN: "CHN", CX: "CXR", CC: "CCK", CO: "COL",
  KM: "COM", CG: "COG", CD: "COD", CK: "COK", CR: "CRI", CI: "CIV", HR: "HRV", CU: "CUB",
  CW: "CUW", CY: "CYP", CZ: "CZE", DK: "DNK", DJ: "DJI", DM: "DMA", DO: "DOM", EC: "ECU",
  EG: "EGY", SV: "SLV", GQ: "GNQ", ER: "ERI", EE: "EST", SZ: "SWZ", ET: "ETH", FK: "FLK",
  FO: "FRO", FJ: "FJI", FI: "FIN", FR: "FRA", GF: "GUF", PF: "PYF", TF: "ATF", GA: "GAB",
  GM: "GMB", GE: "GEO", DE: "DEU", GH: "GHA", GI: "GIB", GR: "GRC", GL: "GRL", GD: "GRD",
  GP: "GLP", GU: "GUM", GT: "GTM", GG: "GGY", GN: "GIN", GW: "GNB", GY: "GUY", HT: "HTI",
  HM: "HMD", VA: "VAT", HN: "HND", HK: "HKG", HU: "HUN", IS: "ISL", IN: "IND", ID: "IDN",
  IR: "IRN", IQ: "IRQ", IE: "IRL", IM: "IMN", IL: "ISR", IT: "ITA", JM: "JAM", JP: "JPN",
  JE: "JEY", JO: "JOR", KZ: "KAZ", KE: "KEN", KI: "KIR", KP: "PRK", KR: "KOR", KW: "KWT",
  KG: "KGZ", LA: "LAO", LV: "LVA", LB: "LBN", LS: "LSO", LR: "LBR", LY: "LBY", LI: "LIE",
  LT: "LTU", LU: "LUX", MO: "MAC", MG: "MDG", MW: "MWI", MY: "MYS", MV: "MDV", ML: "MLI",
  MT: "MLT", MH: "MHL", MQ: "MTQ", MR: "MRT", MU: "MUS", YT: "MYT", MX: "MEX", FM: "FSM",
  MD: "MDA", MC: "MCO", MN: "MNG", ME: "MNE", MS: "MSR", MA: "MAR", MZ: "MOZ", MM: "MMR",
  NA: "NAM", NR: "NRU", NP: "NPL", NL: "NLD", NC: "NCL", NZ: "NZL", NI: "NIC", NE: "NER",
  NG: "NGA", NU: "NIU", NF: "NFK", MK: "MKD", MP: "MNP", NO: "NOR", OM: "OMN", PK: "PAK",
  PW: "PLW", PS: "PSE", PA: "PAN", PG: "PNG", PY: "PRY", PE: "PER", PH: "PHL", PN: "PCN",
  PL: "POL", PT: "PRT", PR: "PRI", QA: "QAT", RE: "REU", RO: "ROU", RU: "RUS", RW: "RWA",
  BL: "BLM", SH: "SHN", KN: "KNA", LC: "LCA", MF: "MAF", PM: "SPM", VC: "VCT", WS: "WSM",
  SM: "SMR", ST: "STP", SA: "SAU", SN: "SEN", RS: "SRB", SC: "SYC", SL: "SLE", SG: "SGP",
  SX: "SXM", SK: "SVK", SI: "SVN", SB: "SLB", SO: "SOM", ZA: "ZAF", GS: "SGS", SS: "SSD",
  ES: "ESP", LK: "LKA", SD: "SDN", SR: "SUR", SJ: "SJM", SE: "SWE", CH: "CHE", SY: "SYR",
  TW: "TWN", TJ: "TJK", TZ: "TZA", TH: "THA", TL: "TLS", TG: "TGO", TK: "TKL", TO: "TON",
  TT: "TTO", TN: "TUN", TR: "TUR", TM: "TKM", TC: "TCA", TV: "TUV", UG: "UGA", UA: "UKR",
  AE: "ARE", GB: "GBR", US: "USA", UM: "UMI", UY: "URY", UZ: "UZB", VU: "VUT", VE: "VEN",
  VN: "VNM", VG: "VGB", VI: "VIR", WF: "WLF", EH: "ESH", YE: "YEM", ZM: "ZMB", ZW: "ZWE",
  XK: "XKX", UK: "GBR", EL: "GRC",
};

/** Common aliases that don't match Natural Earth names exactly. */
const NAME_ALIASES: Record<string, string> = {
  usa: "united states of america",
  "united states": "united states of america",
  "u.s.": "united states of america",
  "u.s.a.": "united states of america",
  america: "united states of america",
  uk: "united kingdom",
  "great britain": "united kingdom",
  britain: "united kingdom",
  russia: "russian federation",
  "south korea": "korea",
  "north korea": "dem. rep. korea",
  "czech republic": "czechia",
  "ivory coast": "côte d'ivoire",
  "cote d'ivoire": "côte d'ivoire",
  syria: "syria",
  iran: "iran",
  vietnam: "vietnam",
  laos: "laos",
  bolivia: "bolivia",
  venezuela: "venezuela",
  tanzania: "tanzania",
  moldova: "moldova",
  macedonia: "north macedonia",
  swaziland: "eswatini",
  "democratic republic of the congo": "dem. rep. congo",
  "dr congo": "dem. rep. congo",
  "drc": "dem. rep. congo",
  congo: "congo",
  "republic of the congo": "congo",
  palestine: "palestine",
  myanmar: "myanmar",
  burma: "myanmar",
  "timor-leste": "timor-leste",
  "east timor": "timor-leste",
  "bosnia": "bosnia and herz.",
  "bosnia and herzegovina": "bosnia and herz.",
  "dominican rep": "dominican rep.",
  "dominican republic": "dominican rep.",
  "central african republic": "central african rep.",
  "eq. guinea": "eq. guinea",
  "equatorial guinea": "eq. guinea",
  "solomon islands": "solomon is.",
  "cayman islands": "cayman is.",
  "marshall islands": "marshall is.",
  "virgin islands": "u.s. virgin is.",
};

const US_ABBR_TO_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10",
  DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19",
  KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27",
  MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35",
  NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44",
  SC: "45", SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53",
  WV: "54", WI: "55", WY: "56", PR: "72", VI: "78", GU: "66", AS: "60", MP: "69",
};

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addKey(map: Map<string, number>, key: string, idx: number) {
  const k = norm(key);
  if (!k || map.has(k)) return;
  map.set(k, idx);
}

function buildWorldAtlas(): AtlasBundle {
  const topo = worldCountries as unknown as Topology<{ countries: GeometryCollection }>;
  const landTopo = worldLand as unknown as Topology<{ land: GeometryCollection }>;
  const fc = topoFeature(topo, topo.objects.countries) as FeatureCollection;
  const features = fc.features as GeoFeature[];
  let outline: Geometry | null = null;
  try {
    outline = topoMesh(landTopo, landTopo.objects.land) as Geometry;
  } catch {
    outline = null;
  }
  const byKey = new Map<string, number>();
  features.forEach((f, i) => {
    const id = f.id != null ? String(f.id) : "";
    const name = String(f.properties?.name ?? "");
    if (id) {
      addKey(byKey, id, i);
      addKey(byKey, id.padStart(3, "0"), i);
    }
    if (name) {
      addKey(byKey, name, i);
      const n = norm(name);
      for (const [alias, target] of Object.entries(NAME_ALIASES)) {
        if (norm(target) === n) addKey(byKey, alias, i);
      }
    }
  });
  for (const [iso3, num] of Object.entries(ISO3_TO_NUM)) {
    const idx = byKey.get(norm(num)) ?? byKey.get(norm(num.padStart(3, "0")));
    if (idx == null) continue;
    addKey(byKey, iso3, idx);
  }
  for (const [iso2, iso3] of Object.entries(ISO2_TO_ISO3)) {
    const num = ISO3_TO_NUM[iso3];
    if (!num) continue;
    const idx = byKey.get(norm(num)) ?? byKey.get(norm(num.padStart(3, "0")));
    if (idx == null) continue;
    addKey(byKey, iso2, idx);
  }
  return { kind: "world", features, outline, byKey };
}

function buildUsAtlas(): AtlasBundle {
  const topo = usStates as unknown as Topology<{ states: GeometryCollection; nation: GeometryCollection }>;
  const fc = topoFeature(topo, topo.objects.states) as FeatureCollection;
  const features = fc.features as GeoFeature[];
  let outline: Geometry | null = null;
  try {
    outline = topoMesh(topo, topo.objects.states, (a, b) => a !== b) as Geometry;
  } catch {
    outline = null;
  }
  const byKey = new Map<string, number>();
  features.forEach((f, i) => {
    const id = f.id != null ? String(f.id).padStart(2, "0") : "";
    const name = String(f.properties?.name ?? "");
    if (id) addKey(byKey, id, i);
    if (name) addKey(byKey, name, i);
  });
  for (const [abbr, fips] of Object.entries(US_ABBR_TO_FIPS)) {
    const idx = byKey.get(norm(fips));
    if (idx == null) continue;
    addKey(byKey, abbr, idx);
  }
  return { kind: "us", features, outline, byKey };
}

let worldCache: AtlasBundle | null = null;
let usCache: AtlasBundle | null = null;

export function getWorldAtlas(): AtlasBundle {
  if (!worldCache) worldCache = buildWorldAtlas();
  return worldCache;
}

export function getUsAtlas(): AtlasBundle {
  if (!usCache) usCache = buildUsAtlas();
  return usCache;
}

export function getAtlas(kind: AtlasKind): AtlasBundle {
  return kind === "us" ? getUsAtlas() : getWorldAtlas();
}

/** Normalize a raw cell into candidate join keys (most specific first). */
export function joinKeyCandidates(raw: unknown): string[] {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  const out: string[] = [s];
  const n = norm(s);
  if (n && n !== s.toLowerCase()) out.push(n);
  const alias = NAME_ALIASES[n];
  if (alias) out.push(alias);
  if (/^[A-Za-z]{2}$/.test(s)) {
    const iso3 = ISO2_TO_ISO3[s.toUpperCase()];
    if (iso3) {
      out.push(iso3);
      const num = ISO3_TO_NUM[iso3];
      if (num) out.push(num);
    }
    const fips = US_ABBR_TO_FIPS[s.toUpperCase()];
    if (fips) out.push(fips);
  }
  if (/^[A-Za-z]{3}$/.test(s)) {
    const num = ISO3_TO_NUM[s.toUpperCase()];
    if (num) out.push(num);
  }
  if (/^\d{1,3}$/.test(s)) out.push(s.padStart(3, "0"), s.padStart(2, "0"));
  return out;
}

export function findFeatureIndex(atlas: AtlasBundle, raw: unknown): number {
  for (const c of joinKeyCandidates(raw)) {
    const idx = atlas.byKey.get(norm(c));
    if (idx != null) return idx;
  }
  return -1;
}

/** Heuristic: which atlas fits a region column name + sample values. */
export function pickAtlasKind(regionField: string, sampleValues: unknown[]): AtlasKind {
  const field = regionField.toLowerCase();
  if (/\b(state|stusps|fips|province)\b/.test(field) && !/country/.test(field)) {
    return "us";
  }
  let usHits = 0;
  let worldHits = 0;
  const us = getUsAtlas();
  const world = getWorldAtlas();
  for (const v of sampleValues.slice(0, 40)) {
    if (findFeatureIndex(us, v) >= 0) usHits++;
    if (findFeatureIndex(world, v) >= 0) worldHits++;
  }
  if (usHits >= worldHits && usHits >= 2) return "us";
  return "world";
}

/** Region-like column names for choropleth support. */
export function isGeoRegionField(name: string): boolean {
  return /^(country|country_code|country_name|cca3|iso|iso3|iso2|state|stusps|region|nation|territory|province|fips|origin_country|borough)$/i.test(
    name,
  ) || /^(country|state|region|nation|province|iso)/i.test(name);
}

export function isLatField(name: string): boolean {
  return /^(lat|latitude)$/i.test(name);
}

export function isLonField(name: string): boolean {
  return /^(lon|lng|long|longitude)$/i.test(name);
}
