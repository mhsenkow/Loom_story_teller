// =================================================================
// Loom — WebGPU particle / 3D scene shaders (shortlist)
// =================================================================
// Modes (uniforms.mode):
//   0 = scatter3d (orbit projected points)
//   1 = firefly (additive soft sprites)
//   2 = trailRibbon (line segments via point sprites along trails)
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

fn project(nx: f32, ny: f32, nz: f32) -> vec3<f32> {
  let cy = cos(uniforms.yaw);
  let sy = sin(uniforms.yaw);
  let cp = cos(uniforms.pitch);
  let sp = sin(uniforms.pitch);
  let x1 = nx * cy + nz * sy;
  let z1 = -nx * sy + nz * cy;
  let y2 = ny * cp - z1 * sp;
  let z2 = ny * sp + z1 * cp;
  // Same projection as the Canvas fallback (gpuScenes.ts orbitFrame / projectUnit): the
  // unit cube fills the stage without clipping at any orbit angle, with mild perspective.
  // (It used to be ~3× smaller, so 3D scatter and firefly rendered as a speck.)
  let persp = 3.2 / (3.2 + z2);
  let scale = (min(uniforms.viewport_width, uniforms.viewport_height) / 2.0 / 2.1) * uniforms.zoom * persp;
  // Return NDC-ish xy and depth
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
  let x_range = max(uniforms.x_max - uniforms.x_min, 1e-6);
  let y_range = max(uniforms.y_max - uniforms.y_min, 1e-6);
  let z_range = max(uniforms.z_max - uniforms.z_min, 1e-6);

  let nx = ((dp.x - uniforms.x_min) / x_range) * 2.0 - 1.0;
  let ny = ((dp.y - uniforms.y_min) / y_range) * 2.0 - 1.0;
  let nz = ((dp.z - uniforms.z_min) / z_range) * 2.0 - 1.0;

  var px: f32;
  var py: f32;
  var depth: f32 = 0.0;
  let mode = i32(uniforms.mode);

  if (mode == 2) {
    // trailRibbon — flat 2D map (trails drawn as ordered points; CPU also draws lines)
    px = ((dp.x - uniforms.x_min) / x_range) * 2.0 - 1.0;
    py = ((dp.y - uniforms.y_min) / y_range) * 2.0 - 1.0;
    depth = dp.t;
  } else {
    let pr = project(nx, ny, nz);
    px = pr.x;
    py = pr.y;
    depth = pr.z;
  }

  let color = get_color(dp.category);
  var pixel_size = uniforms.point_size * (0.4 + 0.6 * dp.size_norm) * uniforms.size_scale;
  var alpha = uniforms.opacity;

  if (mode == 1) {
    // firefly — larger soft sprites, brightness from size + time pulse
    let pulse = 0.75 + 0.25 * sin(uniforms.time * 3.0 + dp.t * 6.28318 + f32(dp.category));
    pixel_size = uniforms.point_size * (1.2 + dp.size_norm * 3.5) * uniforms.size_scale * pulse;
    alpha = uniforms.opacity * (0.25 + 0.75 * dp.size_norm) * pulse;
  }

  screen_points[idx] = ScreenPoint(
    px, py,
    color.r, color.g, color.b,
    alpha,
    pixel_size,
    depth,
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
  let mode = i32(in.mode_f);
  if (mode == 1) {
    // Soft additive firefly falloff
    let soft = exp(-d * d * 2.8);
    if (soft < 0.02) { discard; }
    return vec4<f32>(in.color.rgb * soft, in.color.a * soft);
  }
  // Hard circle with AA edge
  let alpha = 1.0 - smoothstep(0.85, 1.0, d);
  if (alpha < 0.01) { discard; }
  return vec4<f32>(in.color.rgb, in.color.a * alpha);
}
