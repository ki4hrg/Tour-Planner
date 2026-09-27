"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CategoryForm } from "./category-form";
import {
  updateCategory,
  deleteCategory,
  reorderCategories,
  sortCategoriesAlphabetically,
} from "./actions";

type Category = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  system: boolean;
  itemCount: number;
};

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const move = (index: number, dir: -1 | 1) => {
    const next = [...categories];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    start(async () => {
      await reorderCategories(next.map((c) => c.id));
    });
  };

  const sortAlpha = () =>
    start(async () => {
      const res = await sortCategoriesAlphabetically();
      if (res.message) toast.success(res.message);
    });

  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground">No categories.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" disabled={pending} onClick={sortAlpha}>
          Sort A–Z
        </Button>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {categories.map((c, i) => (
          <li key={c.id} className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full border"
                  style={{ backgroundColor: c.color ?? "var(--muted)" }}
                  aria-hidden
                />
                <span className="font-medium">{c.name}</span>
                {c.system ? (
                  <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Built-in
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  · {c.itemCount} item{c.itemCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move ${c.name} up`}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || i === categories.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${c.name} down`}
                >
                  ↓
                </Button>
                {/* Built-ins are protected: no edit/delete (only reorder). */}
                {c.system ? null : (
                  <>
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
                  </>
                )}
              </div>
            </div>
            {editingId === c.id && !c.system ? (
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
    </div>
  );
}
