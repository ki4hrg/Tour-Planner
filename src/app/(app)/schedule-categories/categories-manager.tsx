"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CategoryForm } from "./category-form";
import { updateCategory, deleteCategory } from "./actions";

type Category = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  itemCount: number;
};

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground">No categories yet.</p>;
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {categories.map((c) => (
        <li key={c.id} className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-full border"
                style={{ backgroundColor: c.color ?? "var(--muted)" }}
                aria-hidden
              />
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">
                · order {c.sortOrder} ·{" "}
                {c.itemCount} item{c.itemCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setEditingId((id) => (id === c.id ? null : c.id))
                }
              >
                {editingId === c.id ? "Close" : "Edit"}
              </Button>
              <form action={deleteCategory}>
                <input type="hidden" name="id" value={c.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                >
                  Delete
                </Button>
              </form>
            </div>
          </div>
          {editingId === c.id ? (
            <div className="mt-3">
              <CategoryForm
                action={updateCategory}
                submitLabel="Save"
                initial={{
                  id: c.id,
                  name: c.name,
                  color: c.color,
                  sortOrder: c.sortOrder,
                }}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
