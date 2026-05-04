#!/usr/bin/env node
import "dotenv/config";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { glob } from "glob";
import readline from "readline";
import { execSync } from "child_process";

// ===== CONFIG =====
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const MODEL = "poolside/laguna-m.1:free";

// ===== HELPER =====
async function ask(prompt, role = "engineer") {
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `You are a senior ${role}. Return clean result only.`,
        },
        { role: "user", content: prompt },
      ],
      timeout: 20000,
    });

    return res.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.log("❌ AI Error:", err.message);
    return null;
  }
}

const readFile = (f) => {
  try { return fs.readFileSync(f, "utf-8"); }
  catch { return null; }
};

const writeFile = (f, c) => fs.writeFileSync(f, c, "utf-8");

// ===== DIFF =====
function diff(oldStr, newStr) {
  const o = oldStr.split("\n");
  const n = newStr.split("\n");
  let out = [];

  for (let i = 0; i < Math.max(o.length, n.length); i++) {
    if (o[i] !== n[i]) {
      if (o[i]) out.push(`- ${o[i]}`);
      if (n[i]) out.push(`+ ${n[i]}`);
    } else {
      out.push(`  ${o[i]}`);
    }
  }
  return out.join("\n");
}

// ===== INPUT =====
function promptUser(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

// ===== IMPORT PARSER =====
function getImports(code) {
  const r = /require\(['"](.+?)['"]\)|import.*from ['"](.+?)['"]/g;
  let m, out = [];
  while ((m = r.exec(code))) {
    const dep = m[1] || m[2];
    if (dep.startsWith(".")) out.push(dep);
  }
  return out;
}

function resolve(base, rel) {
  const dir = path.dirname(base);
  let p = path.resolve(dir, rel);

  if (!p.endsWith(".js")) {
    if (fs.existsSync(p + ".js")) return p + ".js";
    if (fs.existsSync(path.join(p, "index.js"))) return path.join(p, "index.js");
  }
  return fs.existsSync(p) ? p : null;
}

// ===== CONTEXT BUILDER =====
function buildContext(file) {
  const main = readFile(file);
  if (!main) return null;

  let ctx = `TARGET FILE: ${file}\n${main.slice(0, 4000)}\n`;
  const imps = getImports(main);

  for (let i = 0; i < imps.length && i < 5; i++) {
    const r = resolve(file, imps[i]);
    if (!r) continue;
    const c = readFile(r);
    if (!c) continue;

    ctx += `\nRELATED: ${r}\n${c.slice(0, 2000)}\n`;
  }

  return ctx;
}

// ===== FIX FILE =====
async function fixFile(file, auto = false) {
  const code = readFile(file);
  if (!code) return console.log(`❌ File not found: ${file}`);

  console.log(`\n🔧 Fixing: ${file}`);

  const ctx = buildContext(file);

  const result = await ask(`
${ctx}

Task:
- Fix bugs
- Improve code
- Return ONLY fixed full code
`);

  if (!result || result.trim() === code.trim()) {
    console.log("✅ No changes");
    return;
  }

  console.log("\n📊 DIFF:\n");
  console.log(diff(code, result));

  if (auto) {
    writeFile(file, result);
    console.log("⚡ Auto applied");
    return;
  }

  const ans = await promptUser("\nApply? (y/n/a/q): ");

  if (ans === "y") {
    writeFile(file, result);
    console.log("✅ Applied");
  } else if (ans === "a") {
    writeFile(file, result);
    return "ALL";
  } else if (ans === "q") {
    process.exit(0);
  } else {
    console.log("⏭ Skip");
  }
}

// ===== SCAN =====
async function scan(folder) {
  const files = await glob(`${folder}/**/*.js`);
  let auto = false;

  for (const f of files) {
    const r = await fixFile(f, auto);
    if (r === "ALL") auto = true;
  }
}

// ===== WATCH =====
function watch(folder) {
  console.log(`👀 Watching ${folder}...`);

  fs.watch(folder, { recursive: true }, async (_, file) => {
    if (file.endsWith(".js")) {
      console.log(`\n🔄 Change: ${file}`);
      await fixFile(path.join(folder, file), true);
    }
  });
}

// ===== DEVSECOPS =====
function npmAudit() {
  console.log("\n📦 npm audit\n");
  try {
    const out = execSync("npm audit --json", { encoding: "utf-8" });
    const data = JSON.parse(out);

    if (!data.vulnerabilities || Object.keys(data.vulnerabilities).length === 0) {
      return console.log("✅ No vuln");
    }

    for (const [k, v] of Object.entries(data.vulnerabilities)) {
      console.log(`- ${k} (${v.severity})`);
    }
  } catch {
    console.log("⚠️ audit found issues");
  }
}

function scanSecrets(code, file) {
  const patterns = [/sk-\w+/g, /password\s*=\s*['"].+/gi, /token\s*=\s*['"].+/gi];
  patterns.forEach(p => {
    const m = code.match(p);
    if (m) {
      console.log(`🔐 Secret in ${file}:`, m);
    }
  });
}

function scanDanger(code, file) {
  ["eval(", "exec(", "innerHTML"].forEach(p => {
    if (code.includes(p)) {
      console.log(`⚠️ ${p} in ${file}`);
    }
  });
}

async function audit(folder = "src") {
  console.log("🛡️ DEVSECOPS AUDIT\n");

  npmAudit();

  const files = await glob(`${folder}/**/*.js`);

  for (const f of files) {
    const c = readFile(f);
    if (!c) continue;

    scanSecrets(c, f);
    scanDanger(c, f);

    const ai = await ask(`
Security review:

${c.slice(0,2000)}

List vulnerabilities briefly.
`, "security");

    console.log(`\n🧠 AI (${f}):\n`, ai);
  }
}

// ===== DEBUG =====
async function debug(file) {
  const c = readFile(file);
  if (!c) return console.log("❌ file not found");

  const r = await ask(`
Debug this code:

${c}

Explain root cause and fix.
`);

  console.log("\n🧠 DEBUG:\n", r);
}

// ===== CLI =====
const [cmd, arg] = process.argv.slice(2);

(async () => {
  if (cmd === "fix") await fixFile(arg);
  else if (cmd === "scan") await scan(arg || "src");
  else if (cmd === "watch") watch(arg || "src");
  else if (cmd === "audit") await audit(arg || "src");
  else if (cmd === "debug") await debug(arg);
  else {
    console.log(`
🔥 AI DEV PRO

ai fix file.js
ai scan src
ai watch src
ai audit src
ai debug file.js
`);
  }
})();