// =================================================================
// Loom — WebGPU globe sphere point sprites (live view only)
// =================================================================
// Lon/lat → unit sphere → orbit camera. Capture always uses Canvas
// geoMaps renderers; this path enhances interactive `globe` charts.
// Workgroup 256 — Apple Silicon friendly.
// =================================================================

struct Uniforms {
  viewport_width: f32,
  viewport_height: f32,
  x_min: f32,
  x_max: f32,
  y_min: f32,
  y_max: f32,
  z_min: f32,
  z_max: f32,
  point_size: f32,
  opacity: f32,
  size_scale: f32,
  yaw: f32,
  pitch: f32,
  zoom: f32,
  mode: f32,
  time: f32,
}

struct DataPoint {
  x: f32,
  y: f32,
  z: f32,
  category: u32,
  size_norm: f32,
  trail: u32,
  t: f32,
  _pad: f32,
}

struct ScreenPoint {
  pos_x: f32,
  pos_y: f32,
  color_r: f32,
  color_g: f32,
  color_b: f32,
  alpha: f32,
  size: f32,
  depth: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> data_points: array<DataPoint>;
@group(0) @binding(2) var<storage, read_write> screen_points: array<ScreenPoint>;
@group(0) @binding(3) var<storage, read> palette: array<f32>;

fn get_color(category: u32) -> vec3<f32> {
  let i = (category % 8u) * 3u;
  return vec3<f32>(palette[i], palette[i + 1u], palette[i + 2u]);
}

fn project_sphere(sx: f32, sy: f32, sz: f32) -> vec3<f32> {
  let cy = cos(uniforms.yaw);
  let syaw = sin(uniforms.yaw);
  let cp = cos(uniforms.pitch);
  let sp = sin(uniforms.pitch);
  // Match the Canvas globe (d3 orthographic rotated by -yaw): longitude == yaw faces
  // the viewer and east is to the right, so captures and the live view agree.
  let x1 = sz * cy - sx * syaw;
  let z1 = sx * cy + sz * syaw;
  let y2 = sy * cp - z1 * sp;
  let z2 = sy * sp + z1 * cp;
  let dist = 2.6;
  let scale = (min(uniforms.viewport_width, uniforms.viewport_height) * 0.42 * uniforms.zoom) / (dist + z2 + 2.0);
  let ndc_x = (x1 * scale) / (uniforms.viewport_width * 0.5);
  let ndc_y = (y2 * scale) / (uniforms.viewport_height * 0.5);
  return vec3<f32>(ndc_x, ndc_y, z2);
}

@compute @workgroup_size(256)
fn compute_positions(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= arrayLength(&data_points)) {
    return;
  }

  let dp = data_points[idx];
  // x = longitude degrees, y = latitude degrees (WebGPU globe convention)
  let lon = radians(dp.x);
  let lat = radians(dp.y);
  let cl = cos(lat);
  let sx = cl * cos(lon);
  let sy = sin(lat);
  let sz = cl * sin(lon);

  let pr = project_sphere(sx, sy, sz);
  // Cull back hemisphere softly via alpha
  var alpha = uniforms.opacity;
  if (pr.z < -0.15) {
    alpha = 0.0;
  } else if (pr.z < 0.2) {
    alpha = uniforms.opacity * ((pr.z + 0.15) / 0.35);
  }

  let color = get_color(dp.category);
  let pixel_size = uniforms.point_size * (0.5 + 0.8 * dp.size_norm) * uniforms.size_scale;

  screen_points[idx] = ScreenPoint(
    pr.x, pr.y,
    color.r, color.g, color.b,
    alpha,
    pixel_size,
    pr.z,
  );
}

struct VertexOutput {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) mode_f: f32,
}

@group(0) @binding(0) var<uniform> render_uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> points: array<ScreenPoint>;

@vertex
fn vertex_main(
  @builtin(vertex_index) vertex_idx: u32,
  @builtin(instance_index) instance_idx: u32,
) -> VertexOutput {
  let point = points[instance_idx];
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
  );
  let corner = corners[vertex_idx];
  let px_size = point.size;
  let dx = (px_size / render_uniforms.viewport_width) * corner.x;
  let dy = (px_size / render_uniforms.viewport_height) * corner.y;

  var out: VertexOutput;
  out.clip_pos = vec4<f32>(point.pos_x + dx, point.pos_y + dy, 0.0, 1.0);
  out.color = vec4<f32>(point.color_r, point.color_g, point.color_b, point.alpha);
  out.uv = corner * 0.5 + 0.5;
  out.mode_f = render_uniforms.mode;
  return out;
}

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0;
  let soft = exp(-d * d * 2.4);
  if (soft < 0.02 || in.color.a < 0.01) { discard; }
  return vec4<f32>(in.color.rgb * soft, in.color.a * soft);
}
