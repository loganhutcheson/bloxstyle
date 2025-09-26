"use client";

import { useState } from "react";

export default function Home() {
  const [promptText, setPromptText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setGeneratedImageUrl(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText })
      });

      if (!response.ok) {
        const maybeJson = await response
          .json()
          .catch(() => ({ message: "Failed to generate image" }));
        throw new Error(maybeJson?.message || "Failed to generate image");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setGeneratedImageUrl(objectUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold mb-4">Roblox Clothes Generator</h1>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            className="flex-1 rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2"
            placeholder="Describe the shirt you want to generate..."
            required
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {isSubmitting ? "Generating..." : "Generate"}
          </button>
        </form>

        {errorMessage ? (
          <p className="text-red-500 mt-4">{errorMessage}</p>
        ) : null}

        {generatedImageUrl ? (
          <div className="mt-6">
            <img
              src={generatedImageUrl}
              alt="Generated shirt preview"
              className="w-full h-auto rounded-md border border-black/10 dark:border-white/10"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
