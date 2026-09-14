/**
 * The markets explorer's shape while the catalogue and its stored
 * figures land — the same bands in the same places, so the page settles
 * rather than jumps.
 */
export default function Loading() {
  return (
    <div className="px-4 py-7 md:px-6 lg:px-8" aria-busy>
      <div className="h-8 w-56 rounded-sm bg-secondary" />
      <div className="mt-3 h-3 w-80 max-w-full rounded-full bg-secondary" />

      {/* The filter row. */}
      <div className="mt-6 flex flex-wrap gap-2">
        <div className="h-9 w-64 max-w-full rounded-sm bg-secondary" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 w-28 rounded-sm bg-secondary" />
        ))}
      </div>

      {/* The sort pills. */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-7 w-24 rounded-full bg-secondary" />
        ))}
      </div>

      {/* The table. */}
      <div className="mt-4 overflow-hidden rounded-sm border border-border bg-card">
        <div className="h-10 border-b border-border bg-secondary/40" />
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-b-0">
            <div className="h-3.5 w-40 rounded-full bg-secondary" />
            <div className="ml-auto h-3.5 w-16 rounded-full bg-secondary" />
            <div className="h-3.5 w-16 rounded-full bg-secondary" />
            <div className="h-3.5 w-16 rounded-full bg-secondary" />
          </div>
        ))}
      </div>
    </div>
  );
}
