// =================================================================
// Skeleton — Loading placeholders for table, chart, query results
// =================================================================

"use client";

export function TableSkeleton({ rows = 10, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full">
      <div className="flex gap-2 border-b border-loom-border pb-2 mb-2">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="loom-shimmer h-6 flex-1 rounded" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="flex gap-2 py-1.5 border-b border-loom-border/30">
          {Array.from({ length: cols }).map((_, ci) => (
            <div
              key={ci}
              className="loom-shimmer h-4 rounded"
              style={{ width: ci === 0 ? 32 : ci === 1 ? 48 : `${60 + (ci % 3) * 20}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="loom-shimmer w-3/4 h-3/4 rounded-xl flex items-center justify-center">
        <div className="w-24 h-24 rounded-lg bg-loom-bg/40" />
      </div>
    </div>
  );
}

export function QueryResultsSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4 space-y-2">
      <div className="flex gap-2">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="loom-shimmer h-5 flex-1 rounded" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="flex gap-2">
          {Array.from({ length: cols }).map((_, ci) => (
            <div key={ci} className="loom-shimmer h-4 flex-1 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}
