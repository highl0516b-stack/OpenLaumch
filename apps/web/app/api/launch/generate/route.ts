import { generateLaunchPlan, type LaunchBrief } from "@openlaunch/core";
import { NextResponse } from "next/server";

const requiredFields: Array<keyof LaunchBrief> = ["productName", "oneLiner", "audience", "problem", "launchGoal", "channels"];

export async function POST(request: Request) {
  try {
    const brief = (await request.json()) as LaunchBrief;
    const missing = requiredFields.filter((field) => {
      const value = brief[field];
      return Array.isArray(value) ? value.length === 0 : !value;
    });

    if (missing.length > 0) {
      return NextResponse.json({ error: "Missing required fields", missing }, { status: 400 });
    }

    const plan = generateLaunchPlan(brief);
    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to generate launch plan" },
      { status: 500 },
    );
  }
}