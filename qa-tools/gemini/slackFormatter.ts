import { SuiteAnalysisResult } from "./analyzer";

export function formatCoverageForSlack(result: SuiteAnalysisResult): string {
  const { suiteId, globalScore, rating, justification, missingCriticalCases, suggestedImprovements, perTestFeedback } = result;

  const header = `*TC Coverage Analysis*\nScore: *${globalScore}%* (${rating})`;

  const justificationBlock = `\n*Summary*\n${justification}`;

  const missing = missingCriticalCases.length
    ? `\n*Missing or Weak Cases*\n${missingCriticalCases
        .map(
          m =>
            `• *${m.title}*\n  Priority: ${m.priority}\n  ${m.description}`
        )
        .join("\n\n")}`
    : `\n*Missing or Weak Cases*\nNone`;

  const improvements = suggestedImprovements.length
    ? `\n*Suggested Improvements*\n${suggestedImprovements.map(i => `• ${i}`).join("\n")}`
    : `\n*Suggested Improvements*\nNone`;

  const feedback = perTestFeedback.length
    ? `\n*Per-Test Feedback*\n${perTestFeedback
        .map(
          f =>
            `• TC ${f.caseId}: ${f.coverageScore}% – ${f.notes}`
        )
        .join("\n")}`
    : `\n*Per-Test Feedback*\nNone`;

  return `${header}\n${justificationBlock}\n${missing}\n${improvements}\n${feedback}`;
}
