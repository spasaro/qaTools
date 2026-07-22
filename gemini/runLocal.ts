import fs from "fs";
import path from "path";
import minimist from "minimist";
import { analyzeSuiteCoverage, QaseTestCase, ScreenshotInput } from "./analyzer";

async function main() {
  const args = minimist(process.argv.slice(2));

  const suiteId = Number(args.suite);
  const imagePath = args.image;

  if (!suiteId) {
    console.error("❌ Missing --suite=<id>");
    process.exit(1);
  }

  if (!imagePath) {
    console.error("❌ Missing --image=<path>");
    process.exit(1);
  }

  const absImagePath = path.resolve(imagePath);

  if (!fs.existsSync(absImagePath)) {
    console.error(`❌ Image not found: ${absImagePath}`);
    process.exit(1);
  }

  console.log(`📸 Using screenshot: ${absImagePath}`);

  const buffer = fs.readFileSync(absImagePath);
  const screenshots: ScreenshotInput[] = [
    { mimeType: "image/png", data: buffer.toString("base64") }
  ];

  const csvPath = path.resolve("../qase-updater/output/cases.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("❌ CSV not found. Run qase-updater first:");
    console.error("   npm run get:ids -- --suite=<id> --toCsv=output/cases.csv");
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, "utf8");

  const testCases: QaseTestCase[] = csvContent
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [idRaw, title] = line.split(",").map((v) => v.trim());
      return { id: Number(idRaw), title };
    });

  console.log(`🧪 Running Gemini analysis for suite ${suiteId}...`);

  const result = await analyzeSuiteCoverage({
    suiteId,
    testCases,
    screenshots,
    modelName: "gemini-2.5-flash-lite"
  });

  console.log("✅ Analysis:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});