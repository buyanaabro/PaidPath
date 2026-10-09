import { ImageResponse } from "next/og";

export const alt = "PaidPath — the project plan that reacts to money";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const bar = (left: number, width: number, top: number, color: string, label?: string) => (
  <div
    style={{
      position: "absolute",
      left,
      top,
      width,
      height: 34,
      borderRadius: 8,
      background: color,
      display: "flex",
      alignItems: "center",
      paddingLeft: 12,
      fontSize: 18,
      color: "#0b1f3a",
    }}
  >
    {label}
  </div>
);

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f6f5f1", padding: 64 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 700, color: "#0b1f3a" }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "#0b1f3a", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 22, height: 22, borderRadius: 11, background: "#22c55e" }} />
          </div>
          PaidPath
        </div>
        <div style={{ marginTop: 40, fontSize: 68, fontWeight: 700, color: "#0b1f3a", lineHeight: 1.05, maxWidth: 900 }}>
          The project plan that reacts to money.
        </div>
        <div style={{ marginTop: 20, fontSize: 28, color: "#3f4b5c", maxWidth: 950 }}>
          AI-priced milestones on a Bryntum Gantt · PayPal invoices that hold or pull in the next phase
        </div>
        <div style={{ position: "relative", marginTop: 44, height: 150, display: "flex" }}>
          {bar(0, 260, 0, "#bbf7d0", "Discovery · paid")}
          {bar(300, 240, 50, "#bfdbfe", "Design")}
          {bar(420, 60, 100, "#fde68a")}
          {bar(560, 360, 100, "#e5e7eb", "Build — waiting for payment")}
          <div style={{ position: "absolute", left: 500, top: 0, width: 3, height: 150, background: "#b45309" }} />
        </div>
      </div>
    ),
    size,
  );
}
