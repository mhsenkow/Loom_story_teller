// Apply the live palette to portable Vega specs, including explicit ranges in nested layers.
type Spec = Record<string, unknown>;
const object = (v: unknown): v is Spec =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function applyChartSpecColors(
  spec: Spec,
  colors: string[],
  stops: string[],
): Spec {
  const next = { ...spec };
  if (object(spec.encoding)) {
    const encoding = { ...spec.encoding };
    if (object(encoding.color)) {
      const color = { ...encoding.color };
      if (
        color.field != null ||
        color.aggregate != null ||
        color.datum != null
      ) {
        const scale = object(color.scale) ? { ...color.scale } : {};
        delete scale.scheme;
        delete scale.reverse;
        if (color.scale !== null)
          color.scale = {
            ...scale,
            range:
              color.type === "quantitative"
                ? stops.length === 1
                  ? [stops[0], stops[0]]
                  : stops
                : colors,
          };
      } else if ("value" in color) color.value = colors[0];
      encoding.color = color;
    }
    next.encoding = encoding;
  }
  const encoding = object(next.encoding) ? next.encoding : {};
  const mark =
    typeof spec.mark === "string"
      ? { type: spec.mark }
      : object(spec.mark)
        ? spec.mark
        : null;
  if (
    mark &&
    !encoding.color &&
    [
      "bar",
      "arc",
      "point",
      "circle",
      "square",
      "line",
      "area",
      "rect",
      "trail",
    ].includes(String(mark.type))
  ) {
    next.mark = { ...mark, color: colors[0] };
  }
  for (const key of ["layer", "concat", "hconcat", "vconcat"]) {
    if (Array.isArray(spec[key]))
      next[key] = spec[key].map((child: unknown) =>
        object(child) ? applyChartSpecColors(child, colors, stops) : child,
      );
  }
  if (object(spec.spec))
    next.spec = applyChartSpecColors(spec.spec, colors, stops);
  return next;
}
