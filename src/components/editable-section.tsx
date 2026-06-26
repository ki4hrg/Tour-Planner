"use client";

import { createContext, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";

type EditSectionContext = {
  editing: boolean;
  setEditing: (editing: boolean) => void;
};

const EditSectionCtx = createContext<EditSectionContext | null>(null);

// Forms call this to flip back to the read-only view on a successful save and to
// render a Cancel button. Returns null when a form is rendered outside a section
// (e.g. the standalone `/new` create pages), so those keep working unchanged.
export function useEditSection(): EditSectionContext | null {
  return useContext(EditSectionCtx);
}

// Wraps a read-only `view` with an Edit button that swaps in the `children` form.
// Read-only is the default for everyone — avoids accidentally focusing/selecting
// a form field (notably on mobile) just by visiting the page.
export function EditableSection({
  canEdit,
  view,
  children,
  editLabel = "Edit",
}: {
  canEdit: boolean;
  view: React.ReactNode;
  children: React.ReactNode;
  editLabel?: string;
}) {
  const [editing, setEditing] = useState(false);

  if (!canEdit) return <>{view}</>;

  if (!editing) {
    return (
      <div className="space-y-4">
        {view}
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" />
          {editLabel}
        </Button>
      </div>
    );
  }

  return (
    <EditSectionCtx.Provider value={{ editing, setEditing }}>
      {children}
    </EditSectionCtx.Provider>
  );
}
