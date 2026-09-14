/**
 * The contact book's shape while it loads — header, search, then rows
 * where the rows will be.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10" aria-busy>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="h-8 w-44 rounded-sm bg-secondary" />
          <div className="mt-3 h-3 w-72 max-w-full rounded-full bg-secondary" />
        </div>
        <div className="h-9 w-32 rounded-sm bg-secondary" />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <div className="h-9 w-64 max-w-full rounded-sm bg-secondary" />
        <div className="h-9 w-28 rounded-sm bg-secondary" />
      </div>

      <div className="mt-4 overflow-hidden rounded-sm border border-border bg-card">
        <div className="h-10 border-b border-border bg-secondary/40" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-b-0">
            <div className="h-3.5 w-44 rounded-full bg-secondary" />
            <div className="ml-auto h-3.5 w-28 rounded-full bg-secondary" />
            <div className="h-3.5 w-20 rounded-full bg-secondary" />
          </div>
        ))}
      </div>
    </div>
  );
}
