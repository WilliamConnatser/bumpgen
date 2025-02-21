import OpenAI from "openai";

import type { SupportedModel } from "../../models/llm";
import { SupportedModels } from "../../models/llm";
import { createOpenAIService } from "./openai";

export const injectLLMService =
  ({ llmApiKey, model }: { llmApiKey: string; model: SupportedModel }) =>
  () => {
    if (SupportedModels.includes(model)) {
      const openai = new OpenAI({
        apiKey: llmApiKey,
      });

      return createOpenAIService(openai);
    } else {
      throw new Error("Model not supported");
    }
  };
