/**
 * The saved screen's shape while the account's lists and markets land.
 * The tab strip is real estate the content pushes down if it arrives
 * first, so it is reserved here.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10" aria-busy>
      <div className="h-8 w-40 rounded-sm bg-secondary" />
      <div className="mt-3 h-3 w-72 max-w-full rounded-full bg-secondary" />

      {/* The tab strip. */}
      <div className="mt-6 flex gap-1.5">
        <div className="h-9 w-28 rounded-sm bg-secondary" />
        <div className="h-9 w-28 rounded-sm bg-secondary/60" />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-36 rounded-sm border border-border bg-card" />
        ))}
      </div>
    </div>
  );
}
