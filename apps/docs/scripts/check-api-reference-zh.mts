import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  API_REFERENCE_CONTENT_DIR,
  DOCS_ROOT,
  REPO_ROOT,
} from "./generated-docs/paths.mts";
import { findReferenceDrift } from "./generated-docs/localized-reference.mts";

const { sourceCommit } = JSON.parse(
  fs.readFileSync(
    path.join(DOCS_ROOT, "translation/api-reference-source.json"),
    "utf8",
  ),
);
if (typeof sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw new Error("API reference sourceCommit must be a full Git commit hash");
}
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
const scope = path.relative(REPO_ROOT, API_REFERENCE_CONTENT_DIR);
const sourceFiles = git(
  "ls-tree",
  "-rz",
  "--name-only",
  sourceCommit,
  "--",
  scope,
)
  .split("\0")
  .filter(Boolean);
if (sourceFiles.length === 0)
  throw new Error("English API source tree is empty");

function readTree(directory: string): Map<string, string> {
  return new Map(
    fs
      .readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(directory, file), fs.readFileSync(file, "utf8")];
      }),
  );
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aui-api-reference-zh-"));
try {
  const baseline = new Map<string, string>();
  for (const file of sourceFiles) {
    const relative = path.relative(scope, file);
    const content = git("show", `${sourceCommit}:${file}`);
    baseline.set(relative, content);
    const target = path.join(scratch, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  execFileSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      path.join(DOCS_ROOT, "scripts/generate-api-reference.mts"),
      "--strict",
      "--reference-dir",
      scratch,
    ],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  const generated = readTree(scratch);
  const translated = readTree(API_REFERENCE_CONTENT_DIR);
  const errors = findReferenceDrift(baseline, generated, translated);
  if (errors.length > 0) {
    throw new Error(
      `API reference drift:\n${errors.join("\n")}\nReview the English regeneration and translate complete pages before updating translation/api-reference-source.json.`,
    );
  }
  console.log(
    `Chinese API reference is current: ${baseline.size} files match source ${sourceCommit}; translated prose was preserved.`,
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
