#!/usr/bin/env node
import "dotenv/config";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { glob } from "glob";
import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import readlineSync from "readline-sync";

// ===== CONFIG =====
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const MODEL = "poolside/laguna-m.1:free";

// ===== AI CALL =====
async function ask(prompt, role = "engineer") {
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: `You are a senior ${role}.` },
        { role: "user", content: prompt },
      ],
    });

    return res.choices?.[0]?.message?.content || "";
  } catch (err) {
    return "❌ AI Error: " + err.message;
  }
}

// ===== UI =====
function banner() {
  console.clear();
  console.log(
    boxen(
      chalk.cyan.bold("🤖 AI DEV TERMINAL PRO\nClaudeCode Style"),
      { padding: 1, borderStyle: "round" }
    )
  );
}

function printBox(title, content, color = "cyan") {
  console.log(
    boxen(
      chalk[color](content),
      {
        title: chalk.bold(title),
        borderStyle: "round",
        padding: 1,
      }
    )
  );
}

// ===== MARKDOWN RENDER =====
function renderMarkdown(text) {
  const lines = text.split("\n");
  let inCode = false;

  return lines.map(line => {
    if (line.startsWith("```")) {
      inCode = !inCode;
      return chalk.gray("─".repeat(40));
    }

    if (inCode) return chalk.green(line);

    if (line.startsWith("#")) return chalk.cyan.bold(line);
    if (line.startsWith("-")) return chalk.yellow(line);

    return line;
  }).join("\n");
}

// ===== FILE =====
const readFile = f => {
  try { return fs.readFileSync(f, "utf-8"); }
  catch { return null; }
};

const writeFile = (f, c) => fs.writeFileSync(f, c, "utf-8");

// ===== NLP =====
async function interpret(input) {
  const t = input.toLowerCase();

  // internal commands only
  if (
    t.includes("scan project") ||
    t.includes("scan folder") ||
    t.startsWith("scan ") ||
    t.startsWith("ai scan")
  ) {
    return "scan";
  }

  if (
    t.includes("fix file") ||
    t.startsWith("fix ") ||
    t.startsWith("ai fix")
  ) {
    return "fix";
  }

  if (
    t.includes("audit project") ||
    t.includes("security audit")
  ) {
    return "audit";
  }

  if (
    t.includes("debug file") ||
    t.startsWith("debug ")
  ) {
    return "debug";
  }

  // everything else = normal AI chat
  return "chat";
}

function extractPath(input) {
  const m = input.match(/(src\/[^\s]+|[^\s]+\.js)/);
  return m ? m[0] : null;
}

// ===== MULTI AGENT =====
async function multiAgent(input) {
  const spinner = ora("🧠 Debugger analyzing...").start();
  const debug = await ask(input, "debugger");
  spinner.stop();

  printBox("🧠 Debugger", renderMarkdown(debug), "yellow");

  const spinner2 = ora("💻 Coder generating fix...").start();
  const code = await ask(input + "\nProvide fixed code", "coder");
  spinner2.stop();

  printBox("💻 Coder", renderMarkdown(code), "green");

  const spinner3 = ora("🔍 Reviewer checking...").start();
  const review = await ask(code, "reviewer");
  spinner3.stop();

  printBox("🔍 Reviewer", renderMarkdown(review), "magenta");
}

// ===== FIX =====
async function fixFile(file) {
  const code = readFile(file);
  if (!code) return printBox("Error", "File not found", "red");

  const spinner = ora("Fixing file...").start();

  const result = await ask(`Fix this code:\n${code}`);
  spinner.stop();

  printBox("📊 Result", renderMarkdown(result), "green");
}

// ===== SCAN =====
async function scan(folder) {
  const files = await glob(`${folder}/**/*.js`);
  printBox("Scan", `Scanning ${files.length} files...`, "cyan");

  for (const f of files) {
    await fixFile(f);
  }
}

// ===== AUDIT =====
async function audit(folder = "src") {
  printBox("Security", "Running audit...", "red");

  try {
    const out = execSync("npm audit --json", { encoding: "utf-8" });
    printBox("npm audit", out.slice(0, 1000), "yellow");
  } catch {
    printBox("npm audit", "Issues found", "red");
  }
}

// ===== DEBUG =====
async function debug(file) {
  const code = readFile(file);
  if (!code) return printBox("Error", "File not found", "red");

  const res = await ask(`Debug this:\n${code}`);
  printBox("Debug Result", renderMarkdown(res), "yellow");
}

// ===== CHAT MODE =====
async function chatMode() {
  banner();

  while (true) {
    const input = readlineSync.question(chalk.green("You > "));

    if (input === "exit") {
      console.log(chalk.red("Bye 👋"));
      process.exit(0);
    }

    const intent = await interpret(input);
    const target = extractPath(input);

    if (intent === "fix") return fixFile(target || "src/app.js");
    if (intent === "scan") return scan(target || "src");
    if (intent === "audit") return audit(target || "src");
    if (intent === "debug") return debug(target || "src/app.js");

    await multiAgent(input);
  }
}

// ===== CLI =====
const input = process.argv.slice(2).join(" ");

(async () => {
  if (!input) return chatMode();

  const intent = await interpret(input);
  const target = extractPath(input);

  if (intent === "fix") await fixFile(target || "src/app.js");
  else if (intent === "scan") await scan(target || "src");
  else if (intent === "audit") await audit(target || "src");
  else if (intent === "debug") await debug(target || "src/app.js");
  else await multiAgent(input);
})();