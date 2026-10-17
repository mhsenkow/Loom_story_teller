// Expressive discovery views use real categories and documented source codes.
import type { ColumnInfo, QueryResult } from "./queryTypes";
import type { ChartRecommendation } from "./recs/types";
import { CATEGORY_MARK_SHAPES } from "./chartMarks";
import { isEmojiGlyph, type ChartEmojiMap } from "./chartEmoji";
import { inferType } from "./recs/columns";

const WEATHER: Record<string, string> = {
  0: "☀️",
  1: "🌤️",
  2: "⛅",
  3: "☁️",
  45: "🌫️",
  48: "🌫️",
  51: "🌦️",
  53: "🌦️",
  55: "🌧️",
  56: "🌧️",
  57: "🌧️",
  61: "🌧️",
  63: "🌧️",
  65: "🌧️",
  66: "🌧️",
  67: "🌧️",
  71: "🌨️",
  73: "🌨️",
  75: "❄️",
  77: "❄️",
  80: "🌦️",
  81: "🌧️",
  82: "🌧️",
  85: "🌨️",
  86: "🌨️",
  95: "⛈️",
  96: "⛈️",
  99: "⛈️",
};
const SEMANTIC: Record<string, ChartEmojiMap> = {
  meteo: {
    field: "weather_code",
    values: WEATHER,
    labels: {
      0: "Clear sky",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Fog",
      48: "Rime fog",
      51: "Light drizzle",
      53: "Drizzle",
      55: "Dense drizzle",
      56: "Light freezing drizzle",
      57: "Freezing drizzle",
      61: "Light rain",
      63: "Rain",
      65: "Heavy rain",
      66: "Light freezing rain",
      67: "Freezing rain",
      71: "Light snow",
      73: "Snow",
      75: "Heavy snow",
      77: "Snow grains",
      80: "Light showers",
      81: "Showers",
      82: "Heavy showers",
      85: "Light snow showers",
      86: "Snow showers",
      95: "Thunderstorm",
      96: "Thunderstorm with hail",
      99: "Thunderstorm with heavy hail",
    },
  },
  eonet: {
    field: "category",
    values: {
      Wildfires: "🔥",
      "Severe Storms": "🌪️",
      Volcanoes: "🌋",
      Floods: "🌊",
      Drought: "🌵",
      Earthquakes: "🫨",
      Landslides: "⛰️",
      "Dust and Haze": "🌫️",
      Snow: "❄️",
      "Sea and Lake Ice": "🧊",
    },
  },
  gdacs: {
    field: "event_type",
    labels: {
      EQ: "Earthquake",
      TC: "Tropical cyclone",
      FL: "Flood",
      WF: "Wildfire",
      VO: "Volcano",
      DR: "Drought",
    },
    values: {
      EQ: "🫨",
      TC: "🌀",
      FL: "🌊",
      WF: "🔥",
      VO: "🌋",
      DR: "🌵",
      Earthquake: "🫨",
      "Tropical cyclone": "🌀",
      Flood: "🌊",
      Wildfire: "🔥",
      Volcano: "🌋",
      Drought: "🌵",
    },
  },
  firms: {
    field: "daynight",
    values: { D: "☀️", N: "🌙" },
    labels: { D: "Day", N: "Night" },
  },
  mbta: {
    field: "route_type",
    labels: {
      "0": "Light rail",
      "1": "Subway",
      "2": "Commuter rail",
      "3": "Bus",
      "4": "Ferry",
    },
    values: {
      "0": "🚊",
      "1": "🚇",
      "2": "🚆",
      "3": "🚌",
      "4": "⛴️",
      Tram: "🚊",
      "Light rail": "🚊",
      Subway: "🚇",
      "Commuter rail": "🚆",
      "Commuter Rail": "🚆",
      Bus: "🚌",
      Ferry: "⛴️",
    },
  },
};
export const DISCOVER_SYMBOL_KINDS = new Set([
  "scatter",
  "geoPoints",
  "geoBubbles",
  "globe",
]);

export function addDiscoverMarkerVariants(
  recs: ChartRecommendation[],
  columns: ColumnInfo[],
  source: string,
  sample?: QueryResult | null,
): ChartRecommendation[] {
  const semantic = SEMANTIC[source];
  const mapped =
    semantic && columns.some((c) => c.name === semantic.field)
      ? semantic
      : undefined;
  const rawEmoji =
    sample &&
    columns.find((c) => {
      if (inferType(c.data_type, c.name) !== "nominal") return false;
      const index = sample.columns.indexOf(c.name);
      const values = sample.rows
        .slice(0, 256)
        .map((row) => row[index])
        .filter((v) => v != null && v !== "");
      return values.length > 0 && values.every(isEmojiGlyph);
    })?.name;
  const cats = columns.filter(
    (c) =>
      inferType(c.data_type, c.name) === "nominal" &&
      c.distinct_count >= 2 &&
      c.distinct_count <= CATEGORY_MARK_SHAPES.length,
  );
  const out = [...recs];
  for (const rec of recs) {
    if (
      !DISCOVER_SYMBOL_KINDS.has(rec.kind) ||
      rec.emojiField ||
      rec.shapeField
    )
      continue;
    const shape =
      cats.find((c) => c.name === rec.colorField) ??
      cats.find((c) => c.name !== rec.xField && c.name !== rec.yField);
    if (shape)
      out.push({
        ...rec,
        id: `${rec.id}-shapes-${shape.name}`,
        shapeField: shape.name,
        colorField: shape.name,
        subtitle: `${rec.subtitle ? `${rec.subtitle} · ` : ""}Shapes distinguish ${shape.name}`,
        score: rec.score + 1,
      });
    const field = mapped?.field ?? rawEmoji;
    if (!field) continue;
    out.push({
      ...rec,
      id: `${rec.id}-emoji-${field}`,
      emojiField: field,
      emojiMap: mapped,
      // Source codes are labels, not a magnitude or severity scale.
      colorField: mapped ? null : field,
      subtitle: `${rec.subtitle ? `${rec.subtitle} · ` : ""}Emoji show ${field}`,
      score: rec.score + 3,
    });
  }
  return out;
}
