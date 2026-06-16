import { NextResponse } from "next/server";

export interface LeadRecord {
  id: string;
  name: string;
  email: string;
  source: string;
  score: number;
  status: "new" | "contacted" | "qualified" | "converted";
  createdAt: string;
}

const seedLeads: LeadRecord[] = [
  { id: "lead_001", name: "Early User Alpha", email: "alpha@example.com", source: "product_hunt", score: 82, status: "new", createdAt: new Date().toISOString() },
  { id: "lead_002", name: "Partner Beta", email: "beta@example.com", source: "linkedin", score: 74, status: "contacted", createdAt: new Date().toISOString() },
  { id: "lead_003", name: "Angel Advisor", email: "advisor@example.com", source: "email", score: 91, status: "qualified", createdAt: new Date().toISOString() },
];

export function GET() {
  return NextResponse.json({ leads: seedLeads });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<LeadRecord>;
  const lead: LeadRecord = {
    id: `lead_${Date.now().toString(36)}`,
    name: body.name ?? "Anonymous lead",
    email: body.email ?? "",
    source: body.source ?? "manual",
    score: body.score ?? 50,
    status: body.status ?? "new",
    createdAt: new Date().toISOString(),
  };

  seedLeads.push(lead);
  return NextResponse.json({ lead }, { status: 201 });
}