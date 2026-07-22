import fs from "fs";
import path from "path";
import { analyzeSuiteCoverage, ScreenshotInput } from "./analyzer";
import { loadQaseCasesFromCsv } from "./qaseCsvLoader";

function getArgValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main() {
  const suiteArg = getArgValue("suite");
  if (!suiteArg) {
    throw new Error("Missing --suite=<id>");
  }

  const suiteId = Number(suiteArg);
  if (Number.isNaN(suiteId)) {
    throw new Error("Invalid suite id");
  }

  const screenshots: ScreenshotInput[] = [];
  const screenshotsArg = getArgValue("screenshots");

  if (screenshotsArg) {
    const paths = screenshotsArg.split(",").map((p) => p.trim()).filter(Boolean);
    for (const p of paths) {
      const abs = path.resolve(p);
      const buffer = fs.readFileSync(abs);
      const mimeType = p.toLowerCase().endsWith(".jpg") || p.toLowerCase().endsWith(".jpeg")
        ? "image/jpeg"
        : "image/png";
      screenshots.push({
        mimeType,
        data: buffer.toString("base64")
      });
    }
  }

  const testCases = await loadQaseCasesFromCsv(suiteId);

  const result = await analyzeSuiteCoverage({
    suiteId,
    moduleName: undefined,
    testCases,
    screenshots
  });

  console.log(JSON.stringify(result, null, 2));
}

main();