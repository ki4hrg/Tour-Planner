"use client";

import { createContext, useContext, useRef, useState } from "react";

// Drag-and-drop for the itinerary editor: reorder days, move schedule items
// within or between days, move planned locations between days. Native HTML5
// drag (mouse); the ↑/↓ buttons and "Move to day…" menu cover touch and
// keyboard. The payload lives here rather than in dataTransfer, because
// dragover handlers can't read dataTransfer data — only its types.

export const ITINERARY_DRAG_TYPE = "application/x-tour-itinerary";

export type ItineraryDrag =
  | { kind: "day"; id: string }
  | { kind: "item"; id: string; dayId: string }
  | { kind: "planned"; id: string; dayId: string };

export type ItineraryDrop =
  | { kind: "day"; dayId: string; after: boolean }
  | { kind: "item"; dayId: string; index: number }
  | { kind: "planned"; dayId: string };

type Ctx = {
  drag: ItineraryDrag | null; // for rendering
  current: () => ItineraryDrag | null; // for event handlers (never stale)
  over: ItineraryDrop | null;
  begin: (e: React.DragEvent, drag: ItineraryDrag, image?: Element | null) => void;
  end: () => void;
  hover: (e: React.DragEvent, over: ItineraryDrop | null) => void;
  drop: (e: React.DragEvent) => void;
};

const ItineraryDndContext = createContext<Ctx | null>(null);

export function ItineraryDndProvider({
  onDrop,
  children,
}: {
  onDrop: (drag: ItineraryDrag, over: ItineraryDrop) => void;
  children: React.ReactNode;
}) {
  // State drives the indicators; refs are what the handlers read, since
  // dragover is a continuous event whose state updates may not have rendered
  // by the time the drop fires.
  const [drag, setDragState] = useState<ItineraryDrag | null>(null);
  const [over, setOverState] = useState<ItineraryDrop | null>(null);
  const dragRef = useRef<ItineraryDrag | null>(null);
  const overRef = useRef<ItineraryDrop | null>(null);
  const setDrag = (d: ItineraryDrag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const setOver = (o: ItineraryDrop | null) => {
    overRef.current = o;
    setOverState(o);
  };

  const end = () => {
    setDrag(null);
    setOver(null);
  };

  const value: Ctx = {
    drag,
    current: () => dragRef.current,
    over,
    begin: (e, next, image) => {
      e.dataTransfer.setData(ITINERARY_DRAG_TYPE, next.id);
      e.dataTransfer.effectAllowed = "move";
      // Drag the whole card/row, not just its grip.
      if (image) e.dataTransfer.setDragImage(image, 16, 16);
      setDrag(next);
    },
    end,
    hover: (e, next) => {
      if (!dragRef.current || !e.dataTransfer.types.includes(ITINERARY_DRAG_TYPE)) return;
      e.stopPropagation();
      if (!next) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (JSON.stringify(next) !== JSON.stringify(overRef.current)) setOver(next);
    },
    drop: (e) => {
      const d = dragRef.current;
      const o = overRef.current;
      if (!d || !o) return;
      e.preventDefault();
      e.stopPropagation();
      onDrop(d, o);
      end();
    },
  };

  return (
    <ItineraryDndContext.Provider value={value}>
      {children}
    </ItineraryDndContext.Provider>
  );
}

export function useItineraryDnd(): Ctx {
  const ctx = useContext(ItineraryDndContext);
  if (!ctx) throw new Error("useItineraryDnd outside ItineraryDndProvider");
  return ctx;
}

/** Whether the pointer is in the lower half of an element (drop "after"). */
export function inLowerHalf(e: React.DragEvent): boolean {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
}
