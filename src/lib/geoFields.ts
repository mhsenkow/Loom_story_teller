// =================================================================
// Geo column name heuristics (no atlas JSON — safe for initial bundle)
// =================================================================

/** Region-like column names for choropleth support. */
export function isGeoRegionField(name: string): boolean {
  return (
    /^(country|country_code|country_name|cca3|iso|iso3|iso2|state|stusps|region|nation|territory|province|fips|origin_country|borough)$/i.test(
      name,
    ) || /^(country|state|region|nation|province|iso)/i.test(name)
  );
}

export function isLatField(name: string): boolean {
  const n = name.trim();
  if (/^(lat|latitude)$/i.test(n)) return true;
  return columnNameTokens(n).some((t) => t === "LAT" || t === "LATITUDE");
}

export function isLonField(name: string): boolean {
  const n = name.trim();
  if (/^(lon|lng|long|longitude)$/i.test(n)) return true;
  return columnNameTokens(n).some((t) =>
    t === "LON" || t === "LNG" || t === "LONG" || t === "LONGITUDE",
  );
}

function columnNameTokens(name: string): string[] {
  const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced
    .split(/[_\s./-]+/)
    .map((t) => t.toUpperCase())
    .filter(Boolean);
}

/** True when two fields form a lat/lon pair (token-aware). */
export function isLatLonFieldPair(a: string, b: string): boolean {
  return (isLatField(a) && isLonField(b)) || (isLonField(a) && isLatField(b));
}
