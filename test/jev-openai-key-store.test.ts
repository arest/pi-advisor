import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { JevSecretsLike } from "../src/jev/key-store.ts";
import {
  clearOpenAIDecisionsKey,
  OPENAI_DECISIONS_KEY_NAME,
  OPENAI_DECISIONS_KEY_SERVICE,
  resolveOpenAIDecisionsKey,
  writeOpenAIDecisionsKey,
} from "../src/jev/openai-key-store.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";

const keyOf = (options: { name: string; service: string }) =>
  `${options.service}/${options.name}`;

const memorySecrets = (initial = new Map<string, string>()) => {
  const stored = initial;
  const api: JevSecretsLike = {
    delete: (options) => {
      stored.delete(keyOf(options));
      return Promise.resolve(true);
    },
    get: (options) => Promise.resolve(stored.get(keyOf(options))),
    set: (options) => {
      stored.set(keyOf(options), options.value);
      return Promise.resolve();
    },
  };
  return { api, stored };
};

describe("OpenAI Decisions key store", () => {
  test("stores a dedicated Bun secret without overwriting TypeSafe credentials", async () => {
    const initial = new Map([["pi-advisor/typesafe-api-key", "typesafe-key"]]);
    const secrets = memorySecrets(initial);
    const result = await writeOpenAIDecisionsKey("  platform-key  ", {
      secrets: secrets.api,
      writeFileStore: () => {
        throw new Error("file store should not be used");
      },
    });

    expect(result.ok).toBe(true);
    expect(secrets.stored).toEqual(
      new Map([
        ["pi-advisor/typesafe-api-key", "typesafe-key"],
        [
          `${OPENAI_DECISIONS_KEY_SERVICE}/${OPENAI_DECISIONS_KEY_NAME}`,
          "platform-key",
        ],
      ])
    );
    expect(
      await resolveOpenAIDecisionsKey({
        readFileStore: () => "file-key",
        secrets: secrets.api,
      })
    ).toEqual({ key: "platform-key", source: "openai-bun-secrets" });
  });

  test("uses a customized agent directory for its 0600 file fallback", async () => {
    await withAgentDir({}, async (agentDir) => {
      const result = await writeOpenAIDecisionsKey("platform-key", {
        secrets: null,
      });
      const path = join(agentDir, "openai_api_key");
      expect(result.ok).toBe(true);
      expect(readFileSync(path, "utf-8").trim()).toBe("platform-key");
      const mode = Number.parseInt(
        statSync(path).mode.toString(8).slice(-3),
        8
      );
      expect(mode).toBe(0o600);
      expect(await resolveOpenAIDecisionsKey({ secrets: null })).toEqual({
        key: "platform-key",
        source: "openai-file",
      });
      expect(
        readFileSync(join(agentDir, "advisor.json"), "utf-8")
      ).not.toContain("platform-key");
    });
  });

  test("falls back to the dedicated file when Bun.secrets is unavailable", async () => {
    expect(
      await resolveOpenAIDecisionsKey({
        readFileStore: () => " file-key\n",
        secrets: null,
      })
    ).toEqual({ key: "file-key", source: "openai-file" });
    expect(
      await resolveOpenAIDecisionsKey({
        readFileStore: () => undefined,
        secrets: null,
      })
    ).toEqual({});
  });

  test("falls through to the file when secret lookup fails", async () => {
    const secrets: JevSecretsLike = {
      delete: () => Promise.reject(new Error("keychain locked")),
      get: () => Promise.reject(new Error("keychain locked")),
      set: () => Promise.reject(new Error("keychain locked")),
    };
    expect(
      await resolveOpenAIDecisionsKey({
        readFileStore: () => "file-key",
        secrets,
      })
    ).toEqual({ key: "file-key", source: "openai-file" });
  });

  test("clears only the OpenAI secret and its own file", async () => {
    await withAgentDir({}, async (agentDir) => {
      const typesafePath = join(agentDir, "typesafe_api_key");
      writeFileSync(typesafePath, "typesafe-key\n", { mode: 0o600 });
      await writeOpenAIDecisionsKey("platform-key", { secrets: null });
      const secrets = memorySecrets(
        new Map([
          ["pi-advisor/typesafe-api-key", "typesafe-key"],
          [
            `${OPENAI_DECISIONS_KEY_SERVICE}/${OPENAI_DECISIONS_KEY_NAME}`,
            "platform-key",
          ],
        ])
      );

      const result = await clearOpenAIDecisionsKey({ secrets: secrets.api });
      expect(result.ok).toBe(true);
      expect(secrets.stored.has("pi-advisor/typesafe-api-key")).toBe(true);
      expect(
        secrets.stored.has(
          `${OPENAI_DECISIONS_KEY_SERVICE}/${OPENAI_DECISIONS_KEY_NAME}`
        )
      ).toBe(false);
      expect(existsSync(join(agentDir, "openai_api_key"))).toBe(false);
      expect(readFileSync(typesafePath, "utf-8")).toBe("typesafe-key\n");
    });
  });

  test("rejects empty keys and reports secret-store write failures", async () => {
    expect(
      await writeOpenAIDecisionsKey("  ", { secrets: memorySecrets().api })
    ).toMatchObject({ ok: false });
    const secrets: JevSecretsLike = {
      delete: () => Promise.resolve(true),
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error("keychain locked")),
    };
    const result = await writeOpenAIDecisionsKey("platform-key", { secrets });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("keychain locked");
  });
});
