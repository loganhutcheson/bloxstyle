# FLUX.2 Klein development target

This target runs `black-forest-labs/FLUX.2-klein-4B` locally on Apple Silicon through PyTorch MPS.

It exposes the same multipart `image` + optional `prompt` contract used by `web/src/app/api/qwen_edit/route.ts`.

The first pass deliberately excludes the old Qwen workflow's pose ControlNet and unused depth branch. Establish a quality baseline before adding structural conditioning.

## Mac setup

Requirements: Apple Silicon, 48 GB unified memory, a current macOS release, Python 3.12, and at least 35 GB of free disk space for the environment, cache, and working headroom.

```sh
cd modal/flux2-klein
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-mac.txt
uvicorn local_server:app --host 127.0.0.1 --port 8000
```

The first start downloads model files from Hugging Face and loads them into unified memory. Later starts reuse the Hugging Face cache.

Test the endpoint directly:

```sh
curl --fail-with-body \
  -F 'image=@/absolute/path/to/shirt.png' \
  -F 'prompt=Add a small embroidered banana logo; preserve every template seam and panel' \
  -F 'seed=1' \
  http://127.0.0.1:8000/ \
  --output /tmp/flux2-shirt.png
```

To point the Next.js proxy at the Mac server, set one of its supported upstream variables in `web/.env.local`:

```text
QWEN_EDIT_URL=http://127.0.0.1:8000/
```

The variable retains its historical Qwen name; the HTTP contract is model-independent.

Optional overrides:

- `FLUX_DEVICE=mps` forces the Apple GPU backend.
- `FLUX_MODEL_ID=black-forest-labs/FLUX.2-klein-4B` selects the model repository.
- `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` can remove PyTorch's MPS allocation cap, but may make the whole Mac unresponsive. Do not set it unless an allocation failure requires a controlled experiment.

Run the lightweight tests without downloading weights:

```sh
python -m unittest -v test_engine.py
```

## Known limitations

- This setup has not been performance-tested on the target Mac from this Linux checkout.
- The engine resizes model input dimensions to multiples of 16 and caps the longest side at 1024, then restores the exact original pixel dimensions for the web app.
- A generative editor may still distort UV-layout boundaries. Use the benchmark set in the `qwen refresh` journal before treating this as a production replacement.
- The local endpoint binds only to loopback by default and has no authentication. Do not expose it publicly.
