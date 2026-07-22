import { geminiClient } from "./client";
import { buildPrompt } from "./buildPrompt";

export type QaseTestCase = {
  id: number;
  title: string;
  description?: string;
  steps?: string[];
  preconditions?: string;
  postconditions?: string;
  priority?: string;
  labels?: string[];
};

export interface SuiteAnalysisResult {
  suiteId: number;
  moduleName?: string | null;
  globalScore: number;
  rating: string;
  justification: string;
  missingCriticalCases: MissingCase[];
  suggestedImprovements: string[];
  perTestFeedback: PerTestFeedback[];
}

export interface MissingCase {
  title: string;
  description: string;
  priority: string;
  rationale: string;
}

export type ScreenshotInput = {
  mimeType: string;
  data: string;
};

export type CoverageRating = "Excellent" | "Very good" | "Good" | "Bad";

export type MissingCriticalCase = {
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  rationale: string;
};

export type PerTestFeedback = {
  caseId: number;
  coverageScore: number;
  notes: string;
};

export type CoverageAnalysisResult = {
  suiteId: number;
  moduleName?: string;
  globalScore: number;
  rating: CoverageRating;
  justification: string;
  missingCriticalCases: MissingCriticalCase[];
  suggestedImprovements: string[];
  perTestFeedback: PerTestFeedback[];
};

function extractJsonObject(text: string): CoverageAnalysisResult {
  const fenced =
    text.match(/```json\s*([\s\S]*?)```/i) ||
    text.match(/```\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  const jsonString = raw.slice(first, last + 1);
  return JSON.parse(jsonString) as CoverageAnalysisResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isImageProcessingError(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Unable to process input image") ||
    msg.includes("process input image") ||
    msg.includes("image") ||
    msg.includes("IMAGE")
  );
}

async function callModelOnce(input: {
  modelName: string;
  prompt: string;
  screenshots: ScreenshotInput[];
  useImages: boolean;
}): Promise<string> {
  const { modelName, prompt, screenshots, useImages } = input;

  const model = geminiClient.getGenerativeModel({ model: modelName });

  const parts: any[] = [{ text: prompt }];

  if (useImages && screenshots.length > 0) {
    const imageParts = screenshots.map(s => ({
      inlineData: {
        mimeType: s.mimeType,
        data: s.data
      }
    }));
    const response = await model.generateContent([
      ...imageParts,
      { text: prompt }
    ]);
    const text = response.response.text();
    if (!text) {
      throw new Error("Empty response from Gemini (images + text)");
    }
    return text;
  }

  const response = await model.generateContent(parts);
  const text = response.response.text();
  if (!text) {
    throw new Error("Empty response from Gemini (text only)");
  }
  return text;
}

async function generateCoverageText(input: {
  modelName: string;
  suiteId: number;
  moduleName?: string;
  testCases: QaseTestCase[];
  screenshots: ScreenshotInput[];
  retries?: number;
}): Promise<string> {
  const { modelName, suiteId, moduleName, testCases, screenshots } = input;
  const retries = input.retries ?? 3;

  const prompt = buildPrompt({ suiteId, moduleName, testCases });

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (screenshots.length > 0) {
        try {
          return await callModelOnce({
            modelName,
            prompt,
            screenshots,
            useImages: true
          });
        } catch (err) {
          if (!isImageProcessingError(err)) {
            throw err;
          }

          console.log(
            "[Gemini] Image processing failed, falling back to text-only analysis"
          );

          return await callModelOnce({
            modelName,
            prompt,
            screenshots,
            useImages: false
          });
        }
      }

      return await callModelOnce({
        modelName,
        prompt,
        screenshots,
        useImages: false
      });
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError;
}

export async function analyzeSuiteCoverage(input: {
  suiteId: number;
  moduleName?: string;
  testCases: QaseTestCase[];
  screenshots: ScreenshotInput[];
  modelName?: string;
}): Promise<CoverageAnalysisResult> {
  const { suiteId, moduleName, testCases, screenshots } = input;
  const modelName = input.modelName || "gemini-2.5-flash-lite";

  const text = await generateCoverageText({
    modelName,
    suiteId,
    moduleName,
    testCases,
    screenshots,
    retries: 3
  });

  return extractJsonObject(text);
}
