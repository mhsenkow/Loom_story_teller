// Theme-aware, decorative illustrations paired with a useful next step.
import type { ReactNode } from "react";

export type EmptyStateVariant = "data" | "filter" | "quiet" | "forecast" | "query";
export default function EmptyState({ variant = "data", title, children, action, compact = false }: {
  variant?: EmptyStateVariant; title: string; children: ReactNode; action?: ReactNode; compact?: boolean;
}) {
  return <div className={`loom-empty-state ${compact ? "loom-empty-state-compact" : ""}`}>
    <svg className="loom-empty-art" viewBox="0 0 160 100" fill="none" aria-hidden="true" focusable="false">
      <ellipse className="loom-empty-ground" cx="80" cy="87" rx="54" ry="5" fill="currentColor" opacity=".07" />
      <g className="loom-empty-frame" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="26" y="12" width="100" height="70" rx="10" fill="var(--loom-surface)" />
        <path d="M26 30h100" opacity=".2" />
        <path d="M37 21h13m7 0h3" opacity=".45" />
        {variant === "data" && <><path d="M40 67V51m17 16V43m17 24V55m17 12V38" strokeWidth="6" opacity=".45" /><path d="M37 72h70" opacity=".25" /></>}
        {variant === "filter" && <><path d="M40 43h53M40 53h34M40 63h43" opacity=".3" /><circle cx="108" cy="62" r="16" fill="var(--loom-surface)" /><path d="m120 74 13 12M101 62h14" /></>}
        {variant === "quiet" && <><path d="m38 60 14-3 13 4 13-5 12 3" opacity=".5" /><circle cx="113" cy="64" r="19" fill="var(--loom-surface)" /><path d="m104 64 6 6 12-13" strokeWidth="2.5" /></>}
        {variant === "forecast" && <><path d="m39 67 16-12 14 4 15-16" /><path d="m84 43 17 4 20-15" strokeDasharray="3 5" /><path d="m84 43 37 16V25Z" fill="currentColor" opacity=".08" /><circle cx="84" cy="43" r="3" fill="currentColor" /></>}
        {variant === "query" && <><path d="m40 44 8 7-8 7m16 0h14M40 69h63" opacity=".6" /><path d="m99 42-7 22m19-22-7 22" opacity=".3" /></>}
      </g>
      <g className="loom-empty-detail" stroke="currentColor" strokeLinecap="round" opacity=".5"><path d="M139 22v8m-4-4h8M15 58h5" /><circle cx="17" cy="38" r="2" /></g>
    </svg>
    <h3 className="text-sm font-semibold text-loom-text">{title}</h3>
    <div className="loom-empty-copy text-xs text-loom-muted">{children}</div>
    {action && <div className="loom-empty-action">{action}</div>}
  </div>;
}
