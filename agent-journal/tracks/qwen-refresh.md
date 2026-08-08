# Qwen refresh

## Scope

Track the current Qwen image-edit production path, identify the missing deployment pieces, and record decisions and verified findings for a refresh of that path.

## Baseline (2026-08-03)

### Repository layout

- `modal/qwen/image-edit.json` is the active ComfyUI workflow definition.
- `modal/qwen/README.md` says the Python/Modal launcher is not in this checkout.
- `web/src/app/api/qwen_edit/route.ts` is the product-facing proxy.
- `web/src/components/AvatarViewer.tsx` invokes that proxy from the Magic edit UI and applies the returned image as the avatar shirt texture.
- This journal is ignored by `.gitignore` and must remain uncommitted.

### End-to-end request path

1. On homepage mount, `web/src/app/page.tsx` sends `{ "warm": true, "source": "homepage_prewarm" }` to `POST /api/qwen_edit`.
2. A Magic edit takes the current shirt texture, sends it as multipart field `image`, and optionally sends multipart field `prompt`.
3. The Next.js proxy resolves the upstream URL in this order: `MAGIC_EDIT_URL`, `SHIRT_GENERATOR_URL`, `QWEN_EDIT_URL`, `NEXT_PUBLIC_QWEN_EDIT_URL`.
4. Before forwarding an edit, the proxy atomically reserves one credit from the shared `global` credit record. It refunds the credit on an upstream error or caught exception.
5. The proxy forwards the same `image` and optional `prompt` fields to the upstream service and returns the upstream image bytes with `cache-control: no-store`.
6. The browser waits up to 290 seconds, then applies a successful response as `qwen_edited.png`.

### ComfyUI graph

- Workflow format: ComfyUI graph version `0.4`; 24 nodes and 30 links.
- Base diffusion model: `qwen_image_edit_2509_bf16.safetensors` via `UNETLoader`.
- Text/vision encoder: `qwen_2.5_vl_7b.safetensors` via `CLIPLoader` with type `qwen_image`.
- VAE: `qwen_image_vae.safetensors`.
- Acceleration LoRA: `Qwen-Image-Edit-Lightning-8steps-V1.0.safetensors`, strength `1.0`.
- Model sampling: `ModelSamplingAuraFlow`, shift `3`, followed by `CFGNorm` strength `1`.
- Sampling: 8 steps, CFG `1`, Euler sampler, simple scheduler, denoise `1`, random seed behavior.
- Output latent: empty SD3 latent at 1024 x 1024, batch size 1; decoded and saved as a PNG through `SaveImage`.
- Positive and negative conditioning both use `TextEncodeQwenImageEditPlus` and receive the same three image inputs. The positive prompt in the checked-in UI graph is a sample sentence; the negative prompt is empty.
- Image input 1 is scaled to 1 megapixel. Image inputs 2 and 3 are separate `LoadImage` nodes. The checked-in filenames are example/local UI inputs, not an established service API contract.
- ControlNet model: `InstantX/Qwen-Image-ControlNet-Union` (identified by the graph note; local loader filename is only `diffusion_pytorch_model.safetensors`).
- Active ControlNet conditioning uses a DWPose map derived from another loaded image, with strength `1.5`, start `0`, end `1`.
- A Depth Anything preprocessor runs on that same control image, but its output only goes to a preview node and does not affect sampling in the checked-in graph.

### Known gaps / uncertainties

- The Modal launcher is absent, so this checkout does not show how multipart fields are saved, which workflow node values are replaced, how ComfyUI is installed/started, where model files are downloaded, or how output files are selected and returned.
- The checked-in graph expects three edit images plus a separate pose/control image, while the web proxy sends only one image and a prompt. The missing launcher must either inject defaults/assets or rewrite the graph; this behavior cannot be verified here.
- Custom-node/package requirements are not pinned in this checkout. Non-core-looking nodes include `TextEncodeQwenImageEditPlus`, `CFGNorm`, `DepthAnythingPreprocessor`, and `DWPreprocessor`.
- The exact deployed upstream URL and deployed revision are environment state and are not recorded here.
- The workflow has example filenames and prompt values embedded in it. These should not be assumed to be production inputs without the launcher.

## Refresh questions

- Recover the deployed Modal source or reconstruct a launcher with an explicit request-to-node mapping.
- Inventory and pin ComfyUI, custom-node, model, and preprocessor versions.
- Decide whether the intended product operation needs one source image, three reference images, and/or a user-supplied control image.
- Verify whether DWPose ControlNet is desirable for Roblox shirt texture editing; the current graph appears derived from a person/pose editing example.
- Remove or deliberately connect the unused depth branch.
- Replace ambiguous model filenames with deterministic download paths and checksums or revisions.
- Add a local/API smoke test covering warmup, prompt injection, image injection, output selection, timeout, and error/refund behavior.

## Work log

- 2026-08-03: Created track and documented the repository-visible workflow and web request path. No production or workflow behavior changed.
- 2026-08-03: Surveyed newer open-weight image-edit models for a 48 GB M4 Pro development machine. Recommended first local candidate is FLUX.2 Klein 4B; Qwen Image Edit 2511 remains the quality-continuity candidate but needs quantization/offloading and benchmarking on Apple Silicon.
- 2026-08-03: Added a local-only Apple-Silicon FLUX.2 Klein 4B Diffusers service under `modal/flux2-klein/`, with MPS loading, the product's multipart edit contract, exact output-dimension restoration, Mac setup instructions, and lightweight tests. Created commit `aeaeed1`; push from the current machine was blocked because no GitHub SSH key or `gh` login is available.

## Local-development model survey (2026-08-03)

### Current workflow memory implications

- The current graph combines a 20B Qwen Image Edit diffusion model, a Qwen 2.5-VL 7B encoder, a VAE, and a 2B ControlNet. At BF16, the named 20B + 7B + 2B components alone imply roughly 58 GB of raw parameter storage before the VAE, activations, temporary buffers, ComfyUI, and macOS.
- Therefore the checked-in workflow cannot reasonably be expected to run unchanged and fully resident in 48 GB unified memory. Quantization, component offloading, removal of ControlNet, or a smaller model is required.

### Significant releases since the checked-in Qwen 2509 workflow

- Qwen Image Edit 2511 (December 2025, 20B, Apache 2.0): successor to 2509. Qwen reports reduced image drift, better character and multi-person consistency, integrated community LoRA capabilities, better industrial-design generation, and stronger geometry. It supports multiple input images. Official model: https://huggingface.co/Qwen/Qwen-Image-Edit-2511
- Qwen Image Layered (December 2025, 20B): decomposes images into editable layers. Interesting for an asset-authoring pipeline, but it is not a drop-in replacement for instruction editing. Official collection: https://huggingface.co/collections/Qwen/qwen-image
- FLUX.2 dev (November 2025, 32B): unified generation and single-/multi-reference editing, but the official repository describes it as needing considerable VRAM. It is not the sensible first Mac target.
- FLUX.2 Klein 4B (January 2026, Apache 2.0): distilled four-step generation/editing model with single- and multi-reference support. The official card states about 13 GB VRAM and explicitly positions it for local development and production. This is the strongest first candidate for the 48 GB Mac.
- FLUX.2 Klein 9B (January 2026): higher-capacity compact editor, but non-commercially licensed. It may fit the Mac, but 4B is the safer first benchmark and has a much clearer product license.
- Z-Image Turbo (6B): an efficient eight-step, bilingual text-rendering model that fits in 16 GB-class GPU memory, but its main official release is text-to-image rather than the instruction-based texture editing needed here. It is not a direct replacement.

### Mac execution options

- ComfyUI officially supports Apple Silicon and lists Qwen Image / Qwen Image Edit support. Staying with ComfyUI minimizes workflow migration, but custom-node and MPS compatibility still need direct testing.
- Hugging Face Diffusers supports Apple Silicon through PyTorch MPS. Its documentation warns that memory pressure and swapping can drastically reduce speed below 64 GB; batch size 1 and memory-aware attention are relevant.
- Draw Things has a native Apple-Silicon engine and CLI. Its public CLI example currently includes a quantized FLUX.2 Klein 4B checkpoint, making it a useful fast feasibility test, although migrating the existing ComfyUI graph would require rebuilding the workflow/interface.

### Recommended evaluation order

1. Establish a small fixed set of real Roblox shirt edit inputs and expected edit prompts.
2. Benchmark FLUX.2 Klein 4B locally first at 1024 x 1024, initially without pose/depth ControlNet.
3. Benchmark a quantized Qwen Image Edit 2511 build on the same cases to measure whether its improved preservation/text editing justifies slower iteration.
4. Keep Modal only as a quality/reference lane for large Qwen or FLUX.2 dev experiments, rather than paying for every workflow iteration.
5. Choose the runtime only after quality tests: ComfyUI for workflow continuity; Draw Things/CLI for a native-Mac deployment experiment; Diffusers for the most explicit programmable baseline.

### Sources checked

- Qwen Image collection: https://huggingface.co/collections/Qwen/qwen-image
- Qwen Image Edit 2511: https://huggingface.co/Qwen/Qwen-Image-Edit-2511
- FLUX.2 official inference repository: https://github.com/black-forest-labs/flux2
- FLUX.2 Klein 4B official model card: https://huggingface.co/black-forest-labs/FLUX.2-klein-4B
- ComfyUI official repository: https://github.com/Comfy-Org/ComfyUI
- Draw Things community/CLI repository: https://github.com/drawthingsai/draw-things-community
- Hugging Face Diffusers MPS guide: https://huggingface.co/docs/diffusers/optimization/mps
