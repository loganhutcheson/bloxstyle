import fs from "node:fs/promises";
import { spawn } from "node:child_process";

export const runtime = "nodejs";

type GenerateBody = { prompt?: string };

function runInference(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const pythonExe = process.env.PYTHON_EXECUTABLE || "python3";
    const scriptPath = "/Users/loganhutcheson/Workspace/projects/roblox_clothes_generator/inference_shirt_lora.py";

    const args = [
      scriptPath,
      "--lora_path",
      "/Users/loganhutcheson/Workspace/projects/roblox_clothes_generator/shirt_lora_output/shirt_generator_final.safetensors",
      "--outline",
      "/Users/loganhutcheson/Workspace/projects/roblox_clothes_generator/Template-Shirts-Outline.png",
      "--output",
      "/Users/loganhutcheson/Workspace/projects/roblox_clothes_generator/generated",
      "--width",
      "585",
      "--height",
      "559",
      "--steps",
      "30",
      "--guidance",
      "7.0",
      "--cn_scale",
      "1.0",
      "--disable_safety",
      "--lora_scale",
      "0.75",
      "--mask_from_black",
      "--dilate_mask",
      "6",
      "--prompt",
      prompt,
    ];

    let stdout = "";
    let stderr = "";
    const child = spawn(pythonExe, args, {
      cwd: "/Users/loganhutcheson/Workspace/projects/roblox_clothes_generator",
      env: process.env,
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start Python: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Inference exited with code ${code}: ${stderr || stdout}`));
      }
      // Parse the last saved path from stdout lines like: "Saved /path/to/file.png"
      const matches = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("Saved "));
      if (matches.length === 0) {
        return reject(new Error(`Could not find saved image path in output. Output was: ${stdout}`));
      }
      const lastLine = matches[matches.length - 1];
      const savedPath = lastLine.replace(/^Saved\s+/, "").trim();
      resolve(savedPath);
    });
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateBody;
    const prompt = (body?.prompt || "").trim();
    if (!prompt) {
      return new Response(JSON.stringify({ message: "Missing prompt" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const savedPath = await runInference(prompt);
    const bytes = await fs.readFile(savedPath);

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return new Response(JSON.stringify({ message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}


