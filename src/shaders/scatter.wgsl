// =================================================================
// Loom — WebGPU Scatterplot Compute + Render Shaders
// =================================================================
// Two-pass pipeline:
//   1. Compute shader: transforms raw data points → screen positions
//   2. Vertex/Fragment shader: renders positioned points as circles
//
// Designed for 1M+ points at 60fps on Apple Silicon.
// =================================================================

// --- Shared Structs ---

struct Uniforms {
  viewport_width: f32,
  viewport_height: f32,
  x_min: f32,
  x_max: f32,
  y_min: f32,
  y_max: f32,
  point_size: f32,
  opacity: f32,
  size_scale: f32,
}

struct DataPoint {
  x: f32,
  y: f32,
  category: u32,
  size_norm: f32,  // 0–1 for data-driven size; 1 = use uniform only
}

struct ScreenPoint {
  pos_x: f32,
  pos_y: f32,
  color_r: f32,
  color_g: f32,
  color_b: f32,
  alpha: f32,
  size: f32,
  _pad: f32,
}

// --- Color Palette: 8 RGB colors (24 floats), bound from CPU (theme-aware) ---
@group(0) @binding(3) var<storage, read> palette: array<f32>;

fn get_color(category: u32) -> vec3<f32> {
  let i = (category % 8u) * 3u;
  return vec3<f32>(palette[i], palette[i + 1u], palette[i + 2u]);
}

// --- Compute Shader: Data → Screen Space ---

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> data_points: array<DataPoint>;
@group(0) @binding(2) var<storage, read_write> screen_points: array<ScreenPoint>;

@compute @workgroup_size(256)
fn compute_positions(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= arrayLength(&data_points)) {
    return;
  }

  let dp = data_points[idx];
  let x_range = uniforms.x_max - uniforms.x_min;
  let y_range = uniforms.y_max - uniforms.y_min;

  // Normalize to [0, 1] then to NDC [-1, 1]
  let nx = ((dp.x - uniforms.x_min) / x_range) * 2.0 - 1.0;
  let ny = ((dp.y - uniforms.y_min) / y_range) * 2.0 - 1.0;

  let color = get_color(dp.category);
  let pixel_size = uniforms.point_size * (0.4 + 0.6 * dp.size_norm) * uniforms.size_scale;

  screen_points[idx] = ScreenPoint(
    nx, ny,
    color.r, color.g, color.b,
    uniforms.opacity,
    pixel_size,
    0.0,
  );
}

// --- Vertex Shader: Point Sprites ---

struct VertexOutput {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> render_uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> points: array<ScreenPoint>;

@vertex
fn vertex_main(
  @builtin(vertex_index) vertex_idx: u32,
  @builtin(instance_index) instance_idx: u32,
) -> VertexOutput {
  let point = points[instance_idx];

  // Quad vertices for a point sprite
  let quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );

  let offset = quad[vertex_idx];
  let pixel_size = point.size / render_uniforms.viewport_width;

  var out: VertexOutput;
  out.clip_pos = vec4<f32>(
    point.pos_x + offset.x * pixel_size,
    point.pos_y + offset.y * pixel_size,
    0.0,
    1.0,
  );
  out.color = vec4<f32>(point.color_r, point.color_g, point.color_b, point.alpha);
  out.uv = offset * 0.5 + 0.5;

  return out;
}

// --- Fragment Shader: Circle with Soft Edge ---

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let dist = distance(in.uv, vec2<f32>(0.5, 0.5));

  // Discard outside circle
  if (dist > 0.5) {
    discard;
  }

  // Soft anti-aliased edge
  let edge_softness = 0.05;
  let alpha = smoothstep(0.5, 0.5 - edge_softness, dist) * in.color.a;

  return vec4<f32>(in.color.rgb, alpha);
}
