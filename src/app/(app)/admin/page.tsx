import Link from "next/link";
import { requireRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    href: "/trip-types",
    title: "Trip Types",
    desc: "Trip categories, default currency, and each type's locations and templates.",
  },
  {
    href: "/schedule-categories",
    title: "Schedule categories",
    desc: "Kinds of itinerary item and the accent colors that tint the route line.",
  },
  {
    href: "/admin/regions",
    title: "Regions",
    desc: "Hierarchical place catalog (e.g. England → London), tagged per trip type.",
  },
  {
    href: "/admin/users",
    title: "Users",
    desc: "People with access and their roles (Admin / Planner / Viewer).",
  },
  {
    href: "/admin/api-keys",
    title: "API Keys",
    desc: "Server-to-server keys for exporting trip data to the WordPress plugin.",
  },
];

export default async function AdminPage() {
  await requireRole("ADMIN");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage reference data and access.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="block">
            <Card className="h-full transition-colors hover:border-foreground/25">
              <CardHeader>
                <CardTitle className="text-base">{s.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {s.desc}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
