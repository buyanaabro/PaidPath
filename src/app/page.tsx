import { redirect } from "next/navigation";

// Temporary entry point until the landing page (Phase 7).
export default function Home() {
  redirect("/projects");
}
