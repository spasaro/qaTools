import dotenv from "dotenv-extended";

dotenv.load({
  path: "../.env",
  defaults: undefined,
  schema: undefined
});

import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

if (!GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY");
}

export const geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);