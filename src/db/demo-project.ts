import type { PlanTree } from "@/server/plan-tree";

export const demoProject = {
  name: "Aurora Coffee — brand site",
  clientName: "Aurora Coffee",
  budgetCents: 700_000,
  startDate: "2026-11-02",
};

export const demoPlan: PlanTree = {
  nodes: [
    {
      key: "root",
      name: demoProject.name,
      children: [
        {
          key: "p1",
          name: "Discovery & brand direction",
          children: [
            { key: "interviews", name: "Stakeholder interviews", startDate: demoProject.startDate, duration: 2 },
            { key: "moodboards", name: "Moodboards & visual direction", duration: 3 },
            {
              key: "m1",
              name: "Milestone: Direction approved",
              duration: 0,
              amountCents: 150_000,
              invoiceStatus: "paid",
              paymentGate: true,
            },
          ],
        },
        {
          key: "p2",
          name: "Design",
          children: [
            { key: "wireframes", name: "Wireframes", duration: 4 },
            { key: "mockups", name: "High-fidelity mockups", duration: 5 },
            {
              key: "m2",
              name: "Milestone: Designs signed off",
              duration: 0,
              amountCents: 250_000,
              invoiceStatus: "sent",
              paymentGate: true,
            },
          ],
        },
        {
          key: "p3",
          name: "Build & launch",
          children: [
            { key: "frontend", name: "Frontend build", duration: 6 },
            { key: "shop", name: "Shop integration", duration: 3 },
            { key: "qa", name: "QA & launch", duration: 2 },
            {
              key: "m3",
              name: "Milestone: Site live",
              duration: 0,
              amountCents: 300_000,
              invoiceStatus: "draft",
            },
          ],
        },
      ],
    },
  ],
  links: [
    { from: "interviews", to: "moodboards" },
    { from: "moodboards", to: "m1" },
    { from: "m1", to: "wireframes" },
    { from: "wireframes", to: "mockups" },
    { from: "mockups", to: "m2" },
    { from: "m2", to: "frontend" },
    { from: "frontend", to: "shop" },
    { from: "shop", to: "qa" },
    { from: "qa", to: "m3" },
  ],
};
