from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import uvicorn
import sys
import os
from subprocess import Popen, PIPE

app = FastAPI()
security = HTTPBearer()

JWT_SECRET = "super-secret-key"  # swap out later


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
	if credentials.credentials != JWT_SECRET:
		raise HTTPException(status_code=403, detail="Invalid token")


class GenerateRequest(BaseModel):
	prompt: str


def run_inference(prompt: str) -> str:
	"""Run the existing inference_shirt_lora.py and return the saved image path."""
	python_exe = sys.executable or "python3"
	script_path = "/Users/loganhutcheson/Workspace/projects/roblox_clothes_generator/inference_shirt_lora.py"
	args = [
		python_exe,
		script_path,
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
	]

	proc = Popen(args, cwd="/Users/loganhutcheson/Workspace/projects/roblox_clothes_generator", stdout=PIPE, stderr=PIPE, text=True)
	stdout, stderr = proc.communicate()
	if proc.returncode != 0:
		raise RuntimeError(f"Inference failed (code {proc.returncode}): {stderr or stdout}")

	# Parse 'Saved /path/to/file.png' lines from stdout and take the last
	saved_lines = [line.strip() for line in stdout.splitlines() if line.strip().startswith("Saved ")]
	if not saved_lines:
		raise RuntimeError(f"Could not find saved image path in output. Output was: {stdout}")
	saved_path = saved_lines[-1].replace("Saved ", "").strip()
	if not os.path.exists(saved_path):
		raise RuntimeError(f"Reported saved file does not exist: {saved_path}")
	return saved_path


@app.post("/generate")
async def generate(body: GenerateRequest, creds: HTTPAuthorizationCredentials = Depends(verify_token)):
	prompt = body.prompt.strip()
	if not prompt:
		return JSONResponse({"message": "Missing prompt"}, status_code=400)
	try:
		saved_path = run_inference(prompt)
		file_handle = open(saved_path, "rb")
		return StreamingResponse(file_handle, media_type="image/png", headers={"Cache-Control": "no-store"})
	except Exception as e:
		return JSONResponse({"message": str(e)}, status_code=500)


if __name__ == "__main__":
	uvicorn.run(app, host="0.0.0.0", port=8090)
