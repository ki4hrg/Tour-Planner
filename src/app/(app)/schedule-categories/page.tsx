import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CategoryForm } from "./category-form";
import { CategoriesManager } from "./categories-manager";
import { createCategory } from "./actions";

export const dynamic = "force-dynamic";

export default async function ScheduleCategoriesPage() {
  const user = await requireUser();
  const canManage = user.role === "ADMIN";

  const categories = await prisma.scheduleItemCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });

  const rows = categories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    sortOrder: c.sortOrder,
    system: c.system,
    itemCount: c._count.items,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Schedule categories</h1>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add category</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryForm action={createCategory} submitLabel="Create" />
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <CategoriesManager categories={rows} />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-2 p-3">
              <span
                className="inline-block h-3 w-3 rounded-full border"
                style={{ backgroundColor: c.color ?? "var(--muted)" }}
                aria-hidden
              />
              <span className="font-medium">{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
