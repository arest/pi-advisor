import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Questions } from "@typesafe-ai/sdk";

import {
  buildDecisionsRequest,
  formatDecisionsInput,
  OPENAI_DECISIONS_MODEL,
} from "../src/jev/decisions-client.ts";
import {
  normalizeDecisionsResponse,
  parseDecisionsApiResponse,
} from "../src/jev/decisions-response.ts";

const questions: Questions = {
  self_answerable: {
    criteria: {
      false: "The Advisor's second opinion is needed.",
      true: "The executor can resolve this alone.",
    },
    instructions: "Can the executor resolve the request alone?",
    type: "noul",
  },
  stakes: {
    criteria: [
      "Negligible: routine and reversible.",
      "Moderate: bounded and recoverable.",
      "High: material or irreversible.",
    ],
    instructions: "How material are the stakes?",
    type: "score",
  },
};

const state = {
  executor_question: "Which import order?",
  recent_conversation: "The user asked for a review.",
  role: "executor",
};

describe("OpenAI Decisions request builder", () => {
  test("formats only the supplied Jev state as text input", () => {
    expect(formatDecisionsInput(state)).toBe(JSON.stringify(state, null, 2));
    expect(formatDecisionsInput("bounded text")).toBe("bounded text");
  });

  test("builds fixed-model named predicate and score questions", () => {
    expect(buildDecisionsRequest(state, questions)).toEqual({
      input: JSON.stringify(state, null, 2),
      model: OPENAI_DECISIONS_MODEL,
      questions: [
        {
          instructions:
            "Can the executor resolve the request alone?\n\nA true answer means: The executor can resolve this alone.\n\nA false answer means: The Advisor's second opinion is needed.",
          name: "self_answerable",
          type: "predicate",
        },
        {
          instructions: "How material are the stakes?",
          levels: [
            {
              description: "Negligible: routine and reversible.",
              label: "Negligible",
            },
            {
              description: "Moderate: bounded and recoverable.",
              label: "Moderate",
            },
            { description: "High: material or irreversible.", label: "High" },
          ],
          name: "stakes",
          type: "score",
        },
      ],
    });
    expect(OPENAI_DECISIONS_MODEL).toBe("gpt-6-luna");
  });

  test("rejects duplicate score-level labels", () => {
    const invalid: Questions = {
      invalid: {
        criteria: ["Same: first", "Same: second"],
        instructions: "Choose a level.",
        type: "score",
      },
    };
    expect(() => buildDecisionsRequest(state, invalid)).toThrow(
      "duplicate level labels"
    );
  });
});

const requestQuestions = buildDecisionsRequest(state, questions).questions;
const readFixture = (name: string): Response =>
  new Response(
    readFileSync(resolve("test/fixtures/decisions", name), "utf-8"),
    {
      headers: { "content-type": "application/json" },
    }
  );
const normalize = async (response: Response) =>
  normalizeDecisionsResponse(
    await parseDecisionsApiResponse(response),
    requestQuestions
  );
const scoreAnswer = {
  confidence: 0.9,
  name: "stakes",
  probabilities: [
    { label: "High", probability: 0.05, value: 2 },
    { label: "Negligible", probability: 0.9, value: 0 },
    { label: "Moderate", probability: 0.05, value: 1 },
  ],
  score: 0.15,
  type: "score",
};
const predicateAnswer = {
  name: "self_answerable",
  probability: 0.9,
  type: "predicate",
};
const decisionsResponse = {
  answers: [scoreAnswer, predicateAnswer],
  model: "gpt-6-luna",
  usage: { input_tokens: 159, output_tokens: 0 },
};

describe("OpenAI Decisions response normalization", () => {
  test("accepts official predicate, score, refusal, and usage fixture shapes", async () => {
    const valid = await normalize(readFixture("screening.json"));
    expect(valid.usage).toEqual({ inputTokens: 159, outputTokens: 0 });
    expect(valid.answers.self_answerable).toEqual({ noul: 0.9, type: "noul" });
    await expect(normalize(readFixture("refusal.json"))).rejects.toThrow(
      "refusal"
    );
  });

  test("maps named answers and score labels independent of response order", async () => {
    const result = await normalize(Response.json(decisionsResponse));
    expect(result.answers).toEqual({
      self_answerable: { noul: 0.9, type: "noul" },
      stakes: {
        legend: {
          "0": "Negligible: routine and reversible.",
          "1": "Moderate: bounded and recoverable.",
          "2": "High: material or irreversible.",
        },
        probabilities: { "0": 0.9, "1": 0.05, "2": 0.05 },
        type: "score",
      },
    });
    expect(result.usage).toEqual({ inputTokens: 159, outputTokens: 0 });
  });

  test("rejects duplicate, missing, refused, wrongly typed, and invalid answers", async () => {
    const invalidResponses: [unknown, string][] = [
      [
        {
          ...decisionsResponse,
          answers: [scoreAnswer, scoreAnswer, predicateAnswer],
        },
        "duplicate",
      ],
      [{ ...decisionsResponse, answers: [predicateAnswer] }, "missing"],
      [
        {
          ...decisionsResponse,
          answers: [{ name: "stakes", type: "refusal" }, predicateAnswer],
        },
        "refusal",
      ],
      [
        {
          ...decisionsResponse,
          answers: [{ ...predicateAnswer, type: "score" }, scoreAnswer],
        },
        "wrong type",
      ],
      [
        {
          ...decisionsResponse,
          answers: [{ ...predicateAnswer, probability: 1.1 }, scoreAnswer],
        },
        "predicate probability",
      ],
      [
        {
          ...decisionsResponse,
          answers: [
            {
              ...scoreAnswer,
              probabilities: [
                { label: "Moderate", probability: 0.05, value: 2 },
                ...scoreAnswer.probabilities.slice(1),
              ],
            },
            predicateAnswer,
          ],
        },
        "label/value",
      ],
    ];
    for (const [response, message] of invalidResponses) {
      await expect(normalize(Response.json(response))).rejects.toThrow(message);
    }
  });

  test("rejects malformed token usage", async () => {
    for (const usage of [
      undefined,
      {},
      { input_tokens: -1, output_tokens: 0 },
      { input_tokens: 1.5, output_tokens: 0 },
      { input_tokens: 1, output_tokens: "0" },
    ]) {
      const response = { ...decisionsResponse, usage };
      await expect(normalize(Response.json(response))).rejects.toThrow(
        "malformed usage"
      );
    }
  });
});
