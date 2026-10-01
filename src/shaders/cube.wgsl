// =================================================================
// Loom — Data cube voxels (instanced unit cubes)
// =================================================================
// One instance per non-empty cell: center + half-size + RGBA.
// viewProj comes from dataCube.ts cubeView() so labels / picking on
// the CPU match the GPU exactly. Lambert term mirrors cubeShade().
// Output is premultiplied alpha over a transparent clear.
// =================================================================

struct Uniforms {
  view_proj: mat4x4<f32>,
  light: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) local: vec3<f32>,
}

@vertex
fn vertex_main(
  @location(0) corner: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) center_half: vec4<f32>,
  @location(3) color: vec4<f32>,
) -> VertexOut {
  let world = center_half.xyz + corner * center_half.w;
  var out: VertexOut;
  out.clip_pos = uniforms.view_proj * vec4<f32>(world, 1.0);
  out.color = color;
  out.normal = normal;
  out.local = corner;
  return out;
}

@fragment
fn fragment_main(in: VertexOut) -> @location(0) vec4<f32> {
  let shade = 0.42 + 0.58 * max(0.0, dot(normalize(in.normal), uniforms.light.xyz));
  // Darken near face edges so neighbouring voxels stay separable.
  let a = abs(in.local);
  let n = abs(in.normal);
  let edge = max(a.x * (1.0 - n.x), max(a.y * (1.0 - n.y), a.z * (1.0 - n.z)));
  let rim = 1.0 - 0.3 * smoothstep(0.82, 0.98, edge);
  let rgb = in.color.rgb * shade * rim;
  return vec4<f32>(rgb * in.color.a, in.color.a);
}
