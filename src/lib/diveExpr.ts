// =================================================================
// Loom — Dive derived columns: a small DuckDB-flavoured expression language
// =================================================================
// Scuba's trick for "fix the data in the query editor": define a column
// as an expression and group / filter / aggregate on it like any other.
// Dive evaluates rows in JS (web has no SQL engine), so this is a tiny
// parser + evaluator for a DuckDB-compatible subset — the same text is
// pasted verbatim into the SQL preview, so it runs in DuckDB too.
//
//   lower(user) || ':' || wiki          CASE WHEN delta > 0 THEN 'add' ELSE 'cut' END
//   round(bytes / 1024, 1)              date_trunc('hour', ts)
//   regexp_extract(title, '^(\w+)', 1)  coalesce(country, 'unknown')
//   dayname(ts)  ·  hour(ts)            bot AND NOT minor
//
// Booleans, NULL propagation, IN / LIKE / ILIKE / BETWEEN / IS NULL,
// CAST(x AS type) and x::type are supported. Time functions read and
// write local wall-clock time, like the rest of Dive (naive timestamps
// show as written; DuckDB gives the same answers for naive columns).
// =================================================================

export type ExprValue = string | number | boolean | null;

type Node =
  | { t: "lit"; v: ExprValue }
  | { t: "col"; name: string }
  | { t: "un"; op: "-" | "not"; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "call"; fn: string; args: Node[] }
  | { t: "case"; subject: Node | null; whens: [Node, Node][]; else: Node | null }
  | { t: "in"; a: Node; list: Node[]; not: boolean }
  | { t: "like"; a: Node; pat: Node; not: boolean; ci: boolean }
  | { t: "between"; a: Node; lo: Node; hi: Node; not: boolean }
  | { t: "isnull"; a: Node; not: boolean }
  | { t: "cast"; a: Node; type: string };

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Tok = { k: "num" | "str" | "id" | "qid" | "op" | "eof"; v: string; pos: number };

const OPS = ["::", "||", "<=", ">=", "<>", "!=", "==", "+", "-", "*", "/", "%", "=", "<", ">", "(", ")", ","];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      while (i < src.length && /[0-9.]/.test(src[i]!)) i++;
      if (/[eE]/.test(src[i] ?? "") && /[-+0-9]/.test(src[i + 1] ?? "")) {
        i += 2;
        while (i < src.length && /[0-9]/.test(src[i]!)) i++;
      }
      out.push({ k: "num", v: src.slice(start, i), pos: start });
      continue;
    }
    if (c === "'" || c === '"') {
      let s = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new ExprError(`Unclosed ${c === "'" ? "string" : "quoted name"}`, start);
        if (src[i] === c) {
          if (src[i + 1] === c) {
            s += c;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      out.push({ k: c === "'" ? "str" : "qid", v: s, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      out.push({ k: "id", v: src.slice(start, i), pos: start });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected “${c}”`, i);
    out.push({ k: "op", v: op, pos: i });
    i += op.length;
  }
  out.push({ k: "eof", v: "", pos: src.length });
  return out;
}

export class ExprError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Parser (precedence climbing: OR < AND < NOT < comparison < || < +- < */% < unary < ::)
// ---------------------------------------------------------------------------

const KEYWORDS = new Set(["and", "or", "not", "case", "when", "then", "else", "end", "in", "like", "ilike", "between", "is", "null", "true", "false", "cast", "as"]);

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek(): Tok {
    return this.toks[this.i]!;
  }
  kw(word: string): boolean {
    const t = this.peek();
    return t.k === "id" && t.v.toLowerCase() === word;
  }
  eatKw(word: string): boolean {
    if (!this.kw(word)) return false;
    this.i++;
    return true;
  }
  expectKw(word: string) {
    if (!this.eatKw(word)) this.fail(`Expected ${word.toUpperCase()}`);
  }
  isOp(op: string): boolean {
    const t = this.peek();
    return t.k === "op" && t.v === op;
  }
  eatOp(op: string): boolean {
    if (!this.isOp(op)) return false;
    this.i++;
    return true;
  }
  expectOp(op: string) {
    if (!this.eatOp(op)) this.fail(`Expected “${op}”`);
  }
  fail(msg: string): never {
    const t = this.peek();
    throw new ExprError(t.k === "eof" ? `${msg} at end` : `${msg} near “${t.v}”`, t.pos);
  }

  parse(): Node {
    const n = this.or();
    if (this.peek().k !== "eof") this.fail("Unexpected");
    return n;
  }
  or(): Node {
    let a = this.and();
    while (this.eatKw("or")) a = { t: "bin", op: "or", a, b: this.and() };
    return a;
  }
  and(): Node {
    let a = this.not();
    while (this.eatKw("and")) a = { t: "bin", op: "and", a, b: this.not() };
    return a;
  }
  not(): Node {
    if (this.eatKw("not")) return { t: "un", op: "not", a: this.not() };
    return this.cmp();
  }
  cmp(): Node {
    const a = this.concat();
    const t = this.peek();
    if (t.k === "op" && ["=", "==", "!=", "<>", "<", "<=", ">", ">="].includes(t.v)) {
      this.i++;
      const op = t.v === "==" ? "=" : t.v === "<>" ? "!=" : t.v;
      return { t: "bin", op, a, b: this.concat() };
    }
    if (this.eatKw("is")) {
      const not = this.eatKw("not");
      this.expectKw("null");
      return { t: "isnull", a, not };
    }
    const save = this.i;
    const not = this.eatKw("not");
    if (this.eatKw("in")) {
      this.expectOp("(");
      const list: Node[] = [this.or()];
      while (this.eatOp(",")) list.push(this.or());
      this.expectOp(")");
      return { t: "in", a, list, not };
    }
    if (this.kw("like") || this.kw("ilike")) {
      const ci = this.peek().v.toLowerCase() === "ilike";
      this.i++;
      return { t: "like", a, pat: this.concat(), not, ci };
    }
    if (this.eatKw("between")) {
      const lo = this.concat();
      this.expectKw("and");
      return { t: "between", a, lo, hi: this.concat(), not };
    }
    this.i = save;
    return a;
  }
  concat(): Node {
    let a = this.add();
    while (this.eatOp("||")) a = { t: "bin", op: "||", a, b: this.add() };
    return a;
  }
  add(): Node {
    let a = this.mul();
    for (;;) {
      if (this.eatOp("+")) a = { t: "bin", op: "+", a, b: this.mul() };
      else if (this.eatOp("-")) a = { t: "bin", op: "-", a, b: this.mul() };
      else return a;
    }
  }
  mul(): Node {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.k === "op" && (t.v === "*" || t.v === "/" || t.v === "%")) {
        this.i++;
        a = { t: "bin", op: t.v, a, b: this.unary() };
      } else return a;
    }
  }
  unary(): Node {
    if (this.eatOp("-")) return { t: "un", op: "-", a: this.unary() };
    if (this.eatOp("+")) return this.unary();
    return this.postfix();
  }
  postfix(): Node {
    let a = this.primary();
    while (this.eatOp("::")) a = { t: "cast", a, type: this.typeName() };
    return a;
  }
  typeName(): string {
    const t = this.peek();
    if (t.k !== "id") this.fail("Expected a type");
    this.i++;
    // Swallow precision like DECIMAL(10, 2).
    if (this.eatOp("(")) {
      while (!this.eatOp(")")) {
        if (this.peek().k === "eof") this.fail("Expected “)”");
        this.i++;
      }
    }
    return t.v.toLowerCase();
  }
  primary(): Node {
    const t = this.peek();
    if (t.k === "num") {
      this.i++;
      return { t: "lit", v: Number(t.v) };
    }
    if (t.k === "str") {
      this.i++;
      return { t: "lit", v: t.v };
    }
    if (t.k === "qid") {
      this.i++;
      return { t: "col", name: t.v };
    }
    if (this.eatOp("(")) {
      const n = this.or();
      this.expectOp(")");
      return n;
    }
    if (t.k === "id") {
      const w = t.v.toLowerCase();
      if (w === "null") return this.i++, { t: "lit", v: null };
      if (w === "true") return this.i++, { t: "lit", v: true };
      if (w === "false") return this.i++, { t: "lit", v: false };
      if (w === "case") return this.caseExpr();
      if (w === "cast") {
        this.i++;
        this.expectOp("(");
        const a = this.or();
        this.expectKw("as");
        const type = this.typeName();
        this.expectOp(")");
        return { t: "cast", a, type };
      }
      this.i++;
      if (this.eatOp("(")) {
        const args: Node[] = [];
        if (!this.eatOp(")")) {
          if (this.eatOp("*")) args.push({ t: "lit", v: 1 });
          else args.push(this.or());
          while (this.eatOp(",")) args.push(this.or());
          this.expectOp(")");
        }
        if (!FUNCS[w]) throw new ExprError(`Unknown function ${t.v}()`, t.pos);
        return { t: "call", fn: w, args };
      }
      if (KEYWORDS.has(w)) {
        this.i--;
        this.fail("Unexpected");
      }
      return { t: "col", name: t.v };
    }
    this.fail(t.k === "eof" ? "Expression ended early" : "Unexpected");
  }
  caseExpr(): Node {
    this.i++;
    const subject = this.kw("when") ? null : this.or();
    const whens: [Node, Node][] = [];
    while (this.eatKw("when")) {
      const w = this.or();
      this.expectKw("then");
      whens.push([w, this.or()]);
    }
    if (!whens.length) this.fail("Expected WHEN");
    const els = this.eatKw("else") ? this.or() : null;
    this.expectKw("end");
    return { t: "case", subject, whens, else: els };
  }
}

// ---------------------------------------------------------------------------
// Value semantics (SQL-ish: NULL propagates, comparisons are typed)
// ---------------------------------------------------------------------------

function isNull(v: ExprValue | undefined): v is null | undefined {
  return v == null || (typeof v === "number" && Number.isNaN(v));
}

function num(v: ExprValue): number | null {
  if (isNull(v)) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function str(v: ExprValue): string | null {
  if (isNull(v)) return null;
  return typeof v === "string" ? v : String(v);
}

function truthy(v: ExprValue): boolean | null {
  if (isNull(v)) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = v.trim().toLowerCase();
  if (s === "true" || s === "t" || s === "1") return true;
  if (s === "false" || s === "f" || s === "0" || s === "") return false;
  return null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Cell → epoch ms (naive timestamps are local time, as in Dive's toTime). */
export function exprTime(v: ExprValue): number | null {
  if (isNull(v)) return null;
  if (typeof v === "number") {
    const a = Math.abs(v);
    if (a > 1e17) return v / 1e6; // ns
    if (a > 1e14) return v / 1e3; // µs
    if (a > 1e11) return v; // ms
    if (a > 1e9) return v * 1000; // s
    return null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!ISO_DATE.test(s)) return null;
  // Date-only strings would parse as UTC; pin them to local midnight instead.
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00` : s.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Epoch ms → DuckDB-style local timestamp text (`2026-09-01 13:00:00`, or a bare date at midnight). */
export function formatExprTime(ms: number): string {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) return date;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function compare(a: ExprValue, b: ExprValue): number | null {
  if (isNull(a) || isNull(b)) return null;
  if (typeof a === "number" || typeof b === "number" || typeof a === "boolean" || typeof b === "boolean") {
    const x = num(a);
    const y = num(b);
    if (x != null && y != null) return x - y;
  }
  const ta = typeof a === "string" ? exprTime(a) : null;
  const tb = typeof b === "string" ? exprTime(b) : null;
  if (ta != null && tb != null) return ta - tb;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function likeToRegex(pat: string, ci: boolean): RegExp {
  let re = "";
  for (const ch of pat) re += ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${re}$`, ci ? "is" : "s");
}

const reCache = new Map<string, RegExp | null>();
function regex(p: string, flags = ""): RegExp | null {
  const key = `${flags}/${p}`;
  if (!reCache.has(key)) {
    try {
      reCache.set(key, new RegExp(p, flags));
    } catch {
      reCache.set(key, null);
    }
    if (reCache.size > 500) reCache.delete(reCache.keys().next().value!);
  }
  return reCache.get(key)!;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function truncTime(unit: string, ms: number): number | null {
  const d = new Date(ms);
  const Y = d.getFullYear();
  const M = d.getMonth();
  switch (unit.toLowerCase().replace(/s$/, "")) {
    case "second":
      return Math.floor(ms / 1000) * 1000;
    case "minute":
      return new Date(Y, M, d.getDate(), d.getHours(), d.getMinutes()).getTime();
    case "hour":
      return new Date(Y, M, d.getDate(), d.getHours()).getTime();
    case "day":
      return new Date(Y, M, d.getDate()).getTime();
    case "week":
      // ISO weeks start Monday.
      return new Date(Y, M, d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    case "month":
      return new Date(Y, M, 1).getTime();
    case "quarter":
      return new Date(Y, M - (M % 3), 1).getTime();
    case "year":
      return new Date(Y, 0, 1).getTime();
    default:
      return null;
  }
}

function strftime(ms: number, fmt: string): string {
  const d = new Date(ms);
  return fmt.replace(/%([a-zA-Z%])/g, (_, c: string) => {
    switch (c) {
      case "Y":
        return String(d.getFullYear());
      case "y":
        return pad(d.getFullYear() % 100);
      case "m":
        return pad(d.getMonth() + 1);
      case "d":
        return pad(d.getDate());
      case "H":
        return pad(d.getHours());
      case "M":
        return pad(d.getMinutes());
      case "S":
        return pad(d.getSeconds());
      case "j": {
        const start = new Date(d.getFullYear(), 0, 1).getTime();
        return pad(Math.floor((ms - start) / 86_400_000) + 1, 3);
      }
      case "a":
        return DAYS[d.getDay()]!.slice(0, 3);
      case "A":
        return DAYS[d.getDay()]!;
      case "b":
        return MONTHS[d.getMonth()]!.slice(0, 3);
      case "B":
        return MONTHS[d.getMonth()]!;
      case "w":
        return String(d.getDay());
      case "%":
        return "%";
      default:
        return `%${c}`;
    }
  });
}

type Fn = (args: ExprValue[]) => ExprValue;

/** Wrap a function so any NULL argument yields NULL (SQL default). */
const strict =
  (f: Fn): Fn =>
  (a) =>
    a.some((x) => isNull(x)) ? null : f(a);
const n1 = (f: (x: number) => number): Fn => strict((a) => {
  const x = num(a[0]!);
  if (x == null) return null;
  const r = f(x);
  return Number.isFinite(r) ? r : null;
});
const s1 = (f: (s: string) => ExprValue): Fn => strict((a) => f(str(a[0]!)!));
const t1 = (f: (ms: number, d: Date) => ExprValue): Fn => strict((a) => {
  const ms = exprTime(a[0]!);
  return ms == null ? null : f(ms, new Date(ms));
});

const FUNCS: Record<string, Fn> = {
  // strings
  lower: s1((s) => s.toLowerCase()),
  upper: s1((s) => s.toUpperCase()),
  length: s1((s) => [...s].length),
  trim: s1((s) => s.trim()),
  ltrim: s1((s) => s.trimStart()),
  rtrim: s1((s) => s.trimEnd()),
  reverse: s1((s) => [...s].reverse().join("")),
  concat: (a) => a.map((x) => str(x) ?? "").join(""),
  replace: strict((a) => str(a[0]!)!.split(str(a[1]!)!).join(str(a[2]!)!)),
  substr: strict((a) => {
    const s = [...str(a[0]!)!];
    const start = (num(a[1]!) ?? 1) - 1;
    const len = a.length > 2 ? (num(a[2]!) ?? s.length) : s.length;
    return s.slice(Math.max(0, start), Math.max(0, start) + len).join("");
  }),
  left: strict((a) => [...str(a[0]!)!].slice(0, num(a[1]!) ?? 0).join("")),
  right: strict((a) => {
    const s = [...str(a[0]!)!];
    const n = num(a[1]!) ?? 0;
    return n <= 0 ? "" : s.slice(-n).join("");
  }),
  split_part: strict((a) => {
    const parts = str(a[0]!)!.split(str(a[1]!)!);
    const i = num(a[2]!) ?? 1;
    return (i > 0 ? parts[i - 1] : parts[parts.length + i]) ?? "";
  }),
  contains: strict((a) => str(a[0]!)!.includes(str(a[1]!)!)),
  starts_with: strict((a) => str(a[0]!)!.startsWith(str(a[1]!)!)),
  ends_with: strict((a) => str(a[0]!)!.endsWith(str(a[1]!)!)),
  regexp_matches: strict((a) => regex(str(a[1]!)!)?.test(str(a[0]!)!) ?? null),
  regexp_extract: strict((a) => {
    const m = regex(str(a[1]!)!)?.exec(str(a[0]!)!);
    return m ? (m[a.length > 2 ? (num(a[2]!) ?? 0) : 0] ?? "") : "";
  }),
  regexp_replace: strict((a) => {
    const re = regex(str(a[1]!)!, a.length > 3 && str(a[3]!)!.includes("g") ? "g" : "");
    return re ? str(a[0]!)!.replace(re, str(a[2]!)!.replace(/\\(\d)/g, "$$$1")) : null;
  }),
  // numbers
  abs: n1(Math.abs),
  ceil: n1(Math.ceil),
  floor: n1(Math.floor),
  sign: n1(Math.sign),
  sqrt: n1(Math.sqrt),
  ln: n1(Math.log),
  log10: n1(Math.log10),
  log2: n1(Math.log2),
  exp: n1(Math.exp),
  round: strict((a) => {
    const x = num(a[0]!);
    const p = a.length > 1 ? (num(a[1]!) ?? 0) : 0;
    if (x == null) return null;
    const f = Math.pow(10, p);
    return Math.round(x * f) / f;
  }),
  pow: strict((a) => {
    const r = Math.pow(num(a[0]!) ?? NaN, num(a[1]!) ?? NaN);
    return Number.isFinite(r) ? r : null;
  }),
  greatest: (a) => a.filter((x) => !isNull(x)).reduce<ExprValue>((m, x) => (m == null || (compare(x, m) ?? 0) > 0 ? x : m), null),
  least: (a) => a.filter((x) => !isNull(x)).reduce<ExprValue>((m, x) => (m == null || (compare(x, m) ?? 0) < 0 ? x : m), null),
  // null handling + control flow
  coalesce: (a) => a.find((x) => !isNull(x)) ?? null,
  ifnull: (a) => (isNull(a[0]) ? (a[1] ?? null) : a[0]!),
  nullif: (a) => (compare(a[0]!, a[1]!) === 0 ? null : (a[0] ?? null)),
  if: (a) => (truthy(a[0]!) ? (a[1] ?? null) : (a[2] ?? null)),
  // time (local)
  year: t1((_, d) => d.getFullYear()),
  month: t1((_, d) => d.getMonth() + 1),
  day: t1((_, d) => d.getDate()),
  hour: t1((_, d) => d.getHours()),
  minute: t1((_, d) => d.getMinutes()),
  second: t1((_, d) => d.getSeconds()),
  dayofweek: t1((_, d) => d.getDay()),
  isodow: t1((_, d) => d.getDay() || 7),
  dayname: t1((_, d) => DAYS[d.getDay()]!),
  monthname: t1((_, d) => MONTHS[d.getMonth()]!),
  epoch: t1((ms) => ms / 1000),
  date_trunc: strict((a) => {
    const ms = exprTime(a[1]!);
    const t = ms == null ? null : truncTime(str(a[0]!)!, ms);
    return t == null ? null : formatExprTime(t);
  }),
  strftime: strict((a) => {
    const ms = exprTime(a[0]!);
    return ms == null ? null : strftime(ms, str(a[1]!)!);
  }),
  date_diff: strict((a) => {
    const x = exprTime(a[1]!);
    const y = exprTime(a[2]!);
    if (x == null || y == null) return null;
    const per: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
    const u = per[str(a[0]!)!.toLowerCase().replace(/s$/, "")];
    return u ? Math.trunc((y - x) / u) : null;
  }),
};
FUNCS.substring = FUNCS.substr!;
FUNCS.char_length = FUNCS.length!;
FUNCS.power = FUNCS.pow!;
FUNCS.ceiling = FUNCS.ceil!;
FUNCS.datetrunc = FUNCS.date_trunc!;
FUNCS.datediff = FUNCS.date_diff!;
FUNCS.dayofmonth = FUNCS.day!;

export const DIVE_EXPR_FUNCTIONS = Object.keys(FUNCS).sort();

function castTo(v: ExprValue, type: string): ExprValue {
  if (isNull(v)) return null;
  if (/^(int|integer|bigint|smallint|tinyint|hugeint|ubigint|uinteger)$/.test(type)) {
    const n = num(v);
    return n == null ? null : Math.trunc(n);
  }
  if (/^(double|float|real|decimal|numeric|float8|float4)$/.test(type)) return num(v);
  if (/^(varchar|text|string|char)$/.test(type)) return str(v);
  if (/^(bool|boolean)$/.test(type)) return truthy(v);
  if (/^(timestamp|datetime|timestamptz)$/.test(type)) {
    const t = exprTime(v);
    return t == null ? null : formatExprTime(t);
  }
  if (type === "date") {
    const t = exprTime(v);
    return t == null ? null : formatExprTime(truncTime("day", t)!);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

export interface CompiledExpr {
  /** Evaluate against one row (cells in `columns` order). */
  evaluate: (row: readonly unknown[]) => ExprValue;
  /** Columns the expression reads. */
  refs: string[];
}

function cell(v: unknown): ExprValue {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

/**
 * Parse `src` against `columns` (case-insensitive fallback for bare names).
 * Throws ExprError with a position on bad syntax or unknown columns.
 */
export function compileDiveExpr(src: string, columns: readonly string[]): CompiledExpr {
  if (!src.trim()) throw new ExprError("Empty expression", 0);
  const ast = new Parser(tokenize(src)).parse();
  const refs = new Set<string>();
  const lowerIdx = new Map(columns.map((c, i) => [c.toLowerCase(), i]));
  const resolve = (name: string): number => {
    let i = columns.indexOf(name);
    if (i < 0) i = lowerIdx.get(name.toLowerCase()) ?? -1;
    if (i < 0) throw new ExprError(`Unknown column ${name}`, src.indexOf(name));
    refs.add(columns[i]!);
    return i;
  };

  type Ev = (r: readonly unknown[]) => ExprValue;
  const build = (n: Node): Ev => {
    switch (n.t) {
      case "lit": {
        const v = n.v;
        return () => v;
      }
      case "col": {
        const i = resolve(n.name);
        return (r) => cell(r[i]);
      }
      case "un": {
        const a = build(n.a);
        if (n.op === "-") return (r) => {
          const x = num(a(r));
          return x == null ? null : -x;
        };
        return (r) => {
          const x = truthy(a(r));
          return x == null ? null : !x;
        };
      }
      case "bin": {
        const a = build(n.a);
        const b = build(n.b);
        switch (n.op) {
          case "and":
            return (r) => {
              const x = truthy(a(r));
              if (x === false) return false;
              const y = truthy(b(r));
              if (y === false) return false;
              return x == null || y == null ? null : true;
            };
          case "or":
            return (r) => {
              const x = truthy(a(r));
              if (x === true) return true;
              const y = truthy(b(r));
              if (y === true) return true;
              return x == null || y == null ? null : false;
            };
          case "||":
            return (r) => {
              const x = str(a(r));
              const y = str(b(r));
              return x == null || y == null ? null : x + y;
            };
          case "+":
          case "-":
          case "*":
          case "/":
          case "%": {
            const op = n.op;
            return (r) => {
              const x = num(a(r));
              const y = num(b(r));
              if (x == null || y == null) return null;
              const v = op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? (y === 0 ? null : x / y) : y === 0 ? null : x % y;
              return v == null || !Number.isFinite(v) ? null : v;
            };
          }
          default: {
            const op = n.op;
            return (r) => {
              const c = compare(a(r), b(r));
              if (c == null) return null;
              switch (op) {
                case "=":
                  return c === 0;
                case "!=":
                  return c !== 0;
                case "<":
                  return c < 0;
                case "<=":
                  return c <= 0;
                case ">":
                  return c > 0;
                default:
                  return c >= 0;
              }
            };
          }
        }
      }
      case "call": {
        const f = FUNCS[n.fn]!;
        const args = n.args.map(build);
        return (r) => f(args.map((g) => g(r)));
      }
      case "case": {
        const subject = n.subject ? build(n.subject) : null;
        const whens = n.whens.map(([w, t]) => [build(w), build(t)] as const);
        const els = n.else ? build(n.else) : () => null;
        return (r) => {
          const s = subject ? subject(r) : null;
          for (const [w, t] of whens) {
            const hit = subject ? compare(s, w(r)) === 0 : truthy(w(r)) === true;
            if (hit) return t(r);
          }
          return els(r);
        };
      }
      case "in": {
        const a = build(n.a);
        const list = n.list.map(build);
        const not = n.not;
        return (r) => {
          const x = a(r);
          if (isNull(x)) return null;
          const hit = list.some((g) => compare(x, g(r)) === 0);
          return not ? !hit : hit;
        };
      }
      case "like": {
        const a = build(n.a);
        const p = build(n.pat);
        const { not, ci } = n;
        return (r) => {
          const x = str(a(r));
          const pat = str(p(r));
          if (x == null || pat == null) return null;
          const hit = likeToRegex(pat, ci).test(x);
          return not ? !hit : hit;
        };
      }
      case "between": {
        const a = build(n.a);
        const lo = build(n.lo);
        const hi = build(n.hi);
        const not = n.not;
        return (r) => {
          const x = a(r);
          const c1 = compare(x, lo(r));
          const c2 = compare(x, hi(r));
          if (c1 == null || c2 == null) return null;
          const hit = c1 >= 0 && c2 <= 0;
          return not ? !hit : hit;
        };
      }
      case "isnull": {
        const a = build(n.a);
        const not = n.not;
        return (r) => {
          const v = a(r);
          const nul = isNull(v) || (typeof v === "string" && v.trim() === "");
          return not ? !nul : nul;
        };
      }
      case "cast": {
        const a = build(n.a);
        const type = n.type;
        return (r) => castTo(a(r), type);
      }
    }
  };

  const evaluate = build(ast);
  return { evaluate, refs: [...refs] };
}

// ---------------------------------------------------------------------------
// Derived columns over a whole dataset
// ---------------------------------------------------------------------------

export interface DiveDerived {
  name: string;
  expr: string;
  /** Off = kept in the list but not computed. */
  enabled: boolean;
}

export interface DerivedResult<R> {
  columns: string[];
  rows: R[];
  /** Per derived column (same order as input): error message or null. */
  errors: (string | null)[];
}

/** A safe, unused column name like `derived_2`. */
export function nextDerivedName(existing: readonly string[]): string {
  const taken = new Set(existing.map((s) => s.toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(`derived_${n}`)) return `derived_${n}`;
}

/**
 * Append enabled derived columns to every row. Later derived columns can
 * reference earlier ones. A broken expression is skipped (its column is
 * not added) and reported in `errors`.
 */
export function applyDerivedColumns(
  columns: readonly string[],
  rows: readonly (readonly ExprValue[])[],
  derived: readonly DiveDerived[],
): DerivedResult<ExprValue[]> {
  const errors: (string | null)[] = derived.map(() => null);
  const cols = [...columns];
  const fns: CompiledExpr[] = [];
  derived.forEach((d, i) => {
    if (!d.enabled) return;
    const name = d.name.trim();
    if (!name) {
      errors[i] = "Give the column a name";
      return;
    }
    if (cols.some((c) => c.toLowerCase() === name.toLowerCase())) {
      errors[i] = `“${name}” already exists`;
      return;
    }
    try {
      fns.push(compileDiveExpr(d.expr, cols));
      cols.push(name);
    } catch (e) {
      errors[i] = e instanceof Error ? e.message : String(e);
    }
  });
  if (!fns.length) return { columns: [...columns], rows: rows as ExprValue[][], errors };
  const base = columns.length;
  const out = rows.map((r) => {
    const row = r.slice() as ExprValue[];
    for (let k = 0; k < fns.length; k++) {
      let v: ExprValue;
      try {
        v = fns[k]!.evaluate(row);
      } catch {
        v = null;
      }
      row[base + k] = v;
    }
    return row;
  });
  return { columns: cols, rows: out, errors };
}
