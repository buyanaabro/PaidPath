// Hardcoded demo plan used until the SQLite-backed CrudManager lands (Phase 1).
export const demoProjectStart = "2026-11-02";

export const demoTasks = [
  {
    id: 1,
    name: "Aurora Coffee — brand site",
    expanded: true,
    children: [
      {
        id: 10,
        name: "Discovery & brand direction",
        expanded: true,
        children: [
          { id: 11, name: "Stakeholder interviews", startDate: demoProjectStart, duration: 2 },
          { id: 12, name: "Moodboards & visual direction", duration: 3 },
          {
            id: 13,
            name: "Milestone: Direction approved",
            duration: 0,
            amount: 1500,
            invoiceStatus: "paid",
            paymentGate: true,
          },
        ],
      },
      {
        id: 20,
        name: "Design",
        expanded: true,
        children: [
          { id: 21, name: "Wireframes", duration: 4 },
          { id: 22, name: "High-fidelity mockups", duration: 5 },
          {
            id: 23,
            name: "Milestone: Designs signed off",
            duration: 0,
            amount: 2500,
            invoiceStatus: "sent",
            paymentGate: true,
          },
        ],
      },
      {
        id: 30,
        name: "Build & launch",
        expanded: true,
        children: [
          { id: 31, name: "Frontend build", duration: 6 },
          { id: 32, name: "Shop integration", duration: 3 },
          { id: 33, name: "QA & launch", duration: 2 },
          {
            id: 34,
            name: "Milestone: Site live",
            duration: 0,
            amount: 3000,
            invoiceStatus: "draft",
            paymentGate: false,
          },
        ],
      },
    ],
  },
];

export const demoDependencies = [
  { id: 1, fromTask: 11, toTask: 12 },
  { id: 2, fromTask: 12, toTask: 13 },
  { id: 3, fromTask: 13, toTask: 21 },
  { id: 4, fromTask: 21, toTask: 22 },
  { id: 5, fromTask: 22, toTask: 23 },
  { id: 6, fromTask: 23, toTask: 31 },
  { id: 7, fromTask: 31, toTask: 32 },
  { id: 8, fromTask: 32, toTask: 33 },
  { id: 9, fromTask: 33, toTask: 34 },
];
