/**
 * The market page's shape while its store reads land — the same bands
 * in the same places, so the page settles rather than jumps.
 */
export default function Loading() {
  return (
    <div className="px-4 py-7 md:px-6 lg:px-8" aria-busy>
      <div className="h-3 w-24 rounded-full bg-secondary" />
      <div className="mt-4 h-8 w-64 rounded-sm bg-secondary" />
      <div className="mt-3 h-3 w-96 max-w-full rounded-full bg-secondary" />

      <div className="mt-6 overflow-hidden rounded-sm border border-border bg-card">
        {[0, 1].map((band) => (
          <div
            key={band}
            className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 [&>*+*]:border-border sm:[&>*+*]:border-l"
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="px-5 py-4">
                <div className="h-2.5 w-20 rounded-full bg-secondary" />
                <div className="mt-2 h-6 w-24 rounded-sm bg-secondary" />
                <div className="mt-2 h-2.5 w-16 rounded-full bg-secondary" />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="h-80 rounded-sm border border-border bg-card" />
        <div className="h-80 rounded-sm border border-border bg-card" />
      </div>
      <div className="mt-5 h-96 rounded-sm border border-border bg-card" />
    </div>
  );
}
