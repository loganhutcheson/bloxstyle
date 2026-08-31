# FLUX.2 Klein development target

This target runs `black-forest-labs/FLUX.2-klein-4B` locally on Apple Silicon or on an on-demand
Modal L40S GPU.

The watch drawing lab at `http://localhost:3000/watch-lab` uses a separate `POST /watch-render`
endpoint. It accepts a prepared 512 x 512 PNG `image` and grayscale PNG `mask`, applies a fixed
watch-refinement prompt and seed, and composites the model result through the mask before returning it.

This is the only model endpoint used by the web app. It is invoked only after the user clicks
**Generate Watch**; Modal scales the container to zero after the request instead of keeping a model
warm.

## Modal deployment

```sh
cd modal/flux2-klein
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install 'modal>=1.1,<2'
modal deploy modal_app.py
```

Set the endpoint printed by Modal in the web app's environment:

```text
WATCH_RENDER_URL=https://<workspace>--roblox-watch-renderer-watch-render.modal.run
```

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

In another terminal, start the web app and open the lab:

```sh
cd web
npm run dev
```

The web proxy defaults to `http://127.0.0.1:8000/watch-render`. Override it with
`WATCH_RENDER_URL` in `web/.env.local` when needed.

The first start downloads model files from Hugging Face and loads them into unified memory. Later starts reuse the Hugging Face cache.

Test the endpoint directly:

```sh
curl --fail-with-body \
  --form 'image=@/absolute/path/to/shirt.jpg' \
  --form-string 'prompt=Add a small embroidered banana logo; preserve every template seam and panel' \
  --form 'seed=1' \
  http://127.0.0.1:8000/ \
  --output /tmp/flux2-shirt.png
```

To point the Next.js proxy at the Mac server, set:

```text
WATCH_RENDER_URL=http://127.0.0.1:8000/watch-render
```

Optional overrides:

- `FLUX_DEVICE=mps` forces the Apple GPU backend.
- `FLUX_MODEL_ID=black-forest-labs/FLUX.2-klein-4B` selects the model repository.
- `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` can remove PyTorch's MPS allocation cap, but may make the whole Mac unresponsive. Do not set it unless an allocation failure requires a controlled experiment.

Run the lightweight tests without downloading weights:

```sh
python -m unittest -v test_engine.py
```

With the local server running, execute the fixed ten-case visual benchmark:

```sh
python watch_benchmark.py
```

It writes ignored inputs, outputs, and a native-resolution contact sheet under
`generated/watch-benchmark/`. The left column is the circle-and-strap input and the right column is
the first model result; no retries or candidate selection are used.

## Known limitations

- This setup has not been performance-tested on the target Mac from this Linux checkout.
- The engine resizes model input dimensions to multiples of 16 and caps the longest side at 1024, then restores the exact original pixel dimensions for the web app.
- A generative editor may still distort UV-layout boundaries. Use the fixed benchmark set before treating a new model version as a production replacement.
- The local endpoint binds only to loopback by default and has no authentication. Do not expose it publicly.
