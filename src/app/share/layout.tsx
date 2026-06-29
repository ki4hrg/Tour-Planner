// Public shell for shared itineraries — no app nav, no auth (the /share matcher
// is excluded from the middleware). Just a constrained, readable column.
export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        Shared from Tour Planner
      </footer>
    </div>
  );
}
