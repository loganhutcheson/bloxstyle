#!/usr/bin/env python3
"""
Script to generate a combo image dataset for Stable Diffusion LoRA training.
Processes PNG files from shirt_set_v1 directory and creates:
- Renamed images: shirt_1.png, shirt_2.png, etc.
- Caption files: shirt_1.txt, shirt_2.txt, etc.
"""

import os
import shutil
import re
from pathlib import Path

def clean_filename(filename):
    """
    Clean filename by removing (1) suffix and .png extension.
    Returns the clean name for caption generation.
    """
    # Remove .png extension
    name = filename.replace('.png', '')
    
    # Remove (1) suffix if present
    name = re.sub(r'\(1\)$', '', name)
    
    return name.strip()

def generate_caption(original_name):
    """
    Generate caption in the specified format:
    "rbx_shirt, rbx_shirt, roblox shirt template, <original_name>, minimal shading"
    """
    return f"rbx_shirt, rbx_shirt, roblox shirt template, {original_name}, minimal shading"

def main():
    # Define paths
    source_dir = Path("shirt_set_v1")
    output_dir = Path("lora_dataset")
    
    # Create output directory if it doesn't exist
    output_dir.mkdir(exist_ok=True)
    
    # Get all PNG files from source directory
    png_files = list(source_dir.glob("*.png"))
    
    if not png_files:
        print(f"No PNG files found in {source_dir}")
        return
    
    print(f"Found {len(png_files)} PNG files to process")
    
    # Sort files for consistent ordering
    png_files.sort()
    
    # Process each file
    for i, png_file in enumerate(png_files, 1):
        # Generate new filename
        new_image_name = f"shirt_{i}.png"
        new_caption_name = f"shirt_{i}.txt"
        
        # Get original name for caption
        original_name = clean_filename(png_file.name)
        
        # Copy image file
        source_path = png_file
        dest_image_path = output_dir / new_image_name
        shutil.copy2(source_path, dest_image_path)
        
        # Generate and write caption file
        caption = generate_caption(original_name)
        caption_path = output_dir / new_caption_name
        
        with open(caption_path, 'w', encoding='utf-8') as f:
            f.write(caption)
        
        print(f"Processed {i}/{len(png_files)}: {png_file.name} -> {new_image_name}")
    
    print(f"\nDataset generation complete!")
    print(f"Output directory: {output_dir.absolute()}")
    print(f"Generated {len(png_files)} image-caption pairs")
    
    # Show a few examples
    print("\nExample captions:")
    for i in range(1, min(4, len(png_files) + 1)):
        caption_file = output_dir / f"shirt_{i}.txt"
        if caption_file.exists():
            with open(caption_file, 'r', encoding='utf-8') as f:
                print(f"shirt_{i}.txt: {f.read().strip()}")

if __name__ == "__main__":
    main()