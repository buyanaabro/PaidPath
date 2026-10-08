import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { modelChain } from "@/lib/ai";

// Deploy check. Reports only whether configuration is present — never secret values.
export async function GET() {
  await connection();
  getDb().run(sql`select 1`);
  const configured = (name: string) => Boolean(process.env[name]?.trim());
  return Response.json({
    ok: true,
    config: {
      gemini: configured("GOOGLE_GENERATIVE_AI_API_KEY"),
      paypal: configured("PAYPAL_CLIENT_ID") && configured("PAYPAL_CLIENT_SECRET"),
      buyerEmail: configured("PAYPAL_SANDBOX_BUYER_EMAIL"),
      models: modelChain(),
    },
  });
}
