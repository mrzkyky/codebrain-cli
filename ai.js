#!/usr/bin/env node
import "dotenv/config";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import readlineSync from "readline-sync";
import { glob } from "glob";

// ===== CONFIG =====
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const MODEL = "poolside/laguna-m.1:free";

// ===== AI =====
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
    console.log("❌ AI Error:", err.message);
    return null;
  }
}

// ===== FILE =====
const readFile = (f) => {
  try { return fs.readFileSync(f, "utf-8"); }
  catch { return null; }
};

const writeFile = (f, c) => fs.writeFileSync(f, c, "utf-8");

// ===== NLP =====
async function interpret(input) {
  const t = input.toLowerCase();

  if (t.includes("scan project") || t.includes("scan folder")) return "scan";
  if (t.includes("fix file")) return "fix";
  if (t.includes("debug file")) return "debug";
  if (t.includes("audit")) return "audit";

  return "plan"; // default pakai planner
}

function extractPath(input) {
  const m = input.match(/(src\/[^\s]+|[^\s]+\.js)/);
  return m ? m[0] : null;
}

// ===== 🧠 PLANNER =====
async function makePlan(input) {
  const res = await ask(`
User request:
"${input}"

Create a step-by-step execution plan.

Rules:
- max 5 steps
- short
- numbered list
- no explanation

Example:
1. Scan project
2. Find errors
3. Fix issues
4. Review result
`);

  return res;
}

// ===== ⚡ EXECUTOR =====
async function executePlan(plan, input) {
  const steps = plan
    .split("\n")
    .map(s => s.trim())
    .filter(s => s && /^\d+/.test(s));

  for (const step of steps) {
    console.log(`\n⚡ Executing: ${step}`);

    const lower = step.toLowerCase();

    if (lower.includes("scan")) {
      await scan("src");
    } 
    else if (lower.includes("fix")) {
      await fixFile("src/app.js");
    } 
    else if (lower.includes("debug")) {
      await debug("src/app.js");
    } 
    else {
      // fallback AI execution
      const res = await ask(`
Execute this step:
${step}

Context:
${input}
`);
      console.log(res);
    }
  }
}

// ===== FIX =====
async function fixFile(file) {
  const code = readFile(file);
  if (!code) return console.log("❌ File not found:", file);

  console.log(`🔧 Fixing ${file}...`);

  const result = await ask(`
Fix bugs in this code and return FULL fixed code only:

${code}
`);

  console.log("\n===== RESULT =====\n");
  console.log(result);
}

// ===== SCAN =====
async function scan(folder) {
  const files = await glob(`${folder}/**/*.js`);

  console.log(`📂 Found ${files.length} files`);

  for (const f of files) {
    console.log("→", f);
  }
}

// ===== DEBUG =====
async function debug(file) {
  const code = readFile(file);
  if (!code) return console.log("❌ File not found");

  const res = await ask(`Debug this:\n${code}`);
  console.log(res);
}

// ===== AUDIT =====
async function audit(folder) {
  console.log("🛡️ Audit running...");

  const files = await glob(`${folder}/**/*.js`);

  for (const f of files) {
    const c = readFile(f);
    if (!c) continue;

    if (c.includes("eval(")) {
      console.log(`⚠️ eval found in ${f}`);
    }
  }
}

// ===== 💬 CHAT MODE =====
async function chatMode() {
  console.log("\n🤖 AI DEV (Planner Mode)\nType 'exit' to quit\n");

  while (true) {
    const input = readlineSync.question("You > ");

    if (input === "exit") break;

    const intent = await interpret(input);
    const target = extractPath(input);

    // ===== DIRECT COMMAND =====
    if (intent === "fix") {
      await fixFile(target || "src/app.js");
      continue;
    }

    if (intent === "scan") {
      await scan(target || "src");
      continue;
    }

    if (intent === "debug") {
      await debug(target || "src/app.js");
      continue;
    }

    if (intent === "audit") {
      await audit(target || "src");
      continue;
    }

    // ===== 🧠 PLANNER FLOW =====
    console.log("\n🧠 Generating plan...");

    const plan = await makePlan(input);

    console.log("\n📋 PLAN:\n");
    console.log(plan);

    const confirm = readlineSync.question("\nApply plan? (y/n): ");

    if (confirm === "y") {
      await executePlan(plan, input);
    } else {
      console.log("❌ Cancelled");
    }
  }
}

// ===== CLI =====
const input = process.argv.slice(2).join(" ");

(async () => {
  if (!input) {
    await chatMode();
    return;
  }

  const intent = await interpret(input);
  const target = extractPath(input);

  if (intent === "fix") await fixFile(target || "src/app.js");
  else if (intent === "scan") await scan(target || "src");
  else if (intent === "debug") await debug(target || "src/app.js");
  else if (intent === "audit") await audit(target || "src");
  else {
    const plan = await makePlan(input);
    console.log("\n📋 PLAN:\n", plan);
  }
})();