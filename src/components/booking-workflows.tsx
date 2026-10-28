"use client";

import { createContext, useContext } from "react";
import type { BookingStatus, PaymentOffsetUnit, StepActor } from "@prisma/client";

// The admin-defined booking workflows, loaded once by the (app) layout and read
// by every booking status control — so the many pages that render one don't
// each have to thread the catalog through their props.

export type WorkflowStepOption = {
  id: string;
  label: string;
  sortOrder: number;
  status: BookingStatus;
  actor: StepActor;
  // Due this many units before the trip's start (both or neither).
  dueOffsetValue: number | null;
  dueOffsetUnit: PaymentOffsetUnit | null;
};

export type WorkflowOption = {
  id: string;
  name: string;
  isDefault: boolean;
  steps: WorkflowStepOption[];
};

const BookingWorkflowsContext = createContext<WorkflowOption[]>([]);

export function BookingWorkflowsProvider({
  workflows,
  children,
}: {
  workflows: WorkflowOption[];
  children: React.ReactNode;
}) {
  return (
    <BookingWorkflowsContext.Provider value={workflows}>
      {children}
    </BookingWorkflowsContext.Provider>
  );
}

export function useBookingWorkflows(): WorkflowOption[] {
  return useContext(BookingWorkflowsContext);
}
