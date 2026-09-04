import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const appRoot = path.join(docsRoot, "app");
const stashRoot = path.join(docsRoot, ".zh-build-stash");

const disabledRoutes = [
  "(catalog)",
  "(demos)/demos",
  "(demos)/learn",
  "(demos)/playground",
  "(demos)/react-o11y",
  "(demos)/safe-content-frame",
  "(demos)/tw-glass",
  "(demos)/tw-shimmer",
  "(design)",
  "(home)",
  "(products)",
  "api/anonymous-session",
  "api/chat",
  "api/doc",
  "api/mcp",
  "api/npm",
  "api/playground-chat",
  "api/status",
  "api/xulux",
  "static.json",
  "xulux-preview",
  "sitemap.ts",
];

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: docsRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });

const moved = [];

try {
  await rm(stashRoot, { recursive: true, force: true });
  await mkdir(stashRoot, { recursive: true });

  for (const route of disabledRoutes) {
    const source = path.join(appRoot, route);
    const destination = path.join(stashRoot, route);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    moved.push({ source, destination });
  }

  await writeFile(
    path.join(appRoot, "page.tsx"),
    'import { redirect } from "next/navigation";\n\nexport default function Home() {\n  redirect("/docs");\n}\n',
  );

  // A fresh Vercel checkout has no ignored package dist directories. Build
  // only the workspace packages the docs app consumes before Next resolves
  // package entrypoints and the @assistant-ui/next loader.
  await run("pnpm", [
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=@assistant-ui/docs^...",
    "--concurrency=2",
  ]);
  await run("pnpm", ["generate:type-docs"]);
  await run("pnpm", ["generate:source-snapshot"]);
  await run("next", ["build"]);
} finally {
  await rm(path.join(appRoot, "page.tsx"), { force: true });
  for (const { source, destination } of moved.reverse()) {
    await rename(destination, source);
  }
  await rm(stashRoot, { recursive: true, force: true });
}
