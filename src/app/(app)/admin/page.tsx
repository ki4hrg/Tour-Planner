import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    href: "/trip-types",
    title: "Trip types",
  },
  {
    href: "/schedule-categories",
    title: "Schedule categories",
  },
  {
    href: "/admin/workflows",
    title: "Booking workflows",
  },
  {
    href: "/admin/regions",
    title: "Regions",
  },
  {
    href: "/admin/users",
    title: "Users",
  },
  {
    href: "/admin/places",
    title: "Google places",
    desc: "Link locations to Google Maps places (backfill + yearly place-ID refresh).",
  },
  {
    href: "/admin/api-keys",
    title: "API keys",
  },
];

export default async function AdminPage() {
  await requireRole("ADMIN");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="block">
            <Card className="h-full transition-colors hover:border-foreground/25">
              <CardHeader>
                <CardTitle>{s.title}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
