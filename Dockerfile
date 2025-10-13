# syntax=docker/dockerfile:1

FROM python:3.10-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
	git \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only requirement files first for layer caching
COPY requirements.txt ./

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Environment defaults (override at runtime)
ENV PORT=8090 \
	JWT_SECRET=super-secret-key \
	PROJECT_ROOT=/app \
	LORA_PATH=/app/shirt_lora_output/shirt_generator_final.safetensors \
	OUTLINE_PATH=/app/Template-Shirts-Outline.png \
	OUTPUT_DIR=/app/generated

# Create output dir
RUN mkdir -p ${OUTPUT_DIR}

EXPOSE ${PORT}

# Start the FastAPI app
CMD ["python", "main.py"]






