import type { Theme } from "@earendil-works/pi-coding-agent";
import { noul } from "@typesafe-ai/sdk";

import type { JevTransport } from "../config/types.ts";
import { jevClientFromCredentials } from "../jev/client.ts";
import { OPENAI_DECISIONS_MODEL } from "../jev/decisions-client.ts";
import {
  clearKeyTypeSafeKey,
  removeTypeSafeKeyFromAdvisorJson,
  writeKeyTypeSafeKey,
} from "../jev/key-store.ts";
import {
  clearOpenAIDecisionsKey,
  writeOpenAIDecisionsKey,
} from "../jev/openai-key-store.ts";
import {
  resolveJevTransport,
  resolveJevTransportFor,
} from "../jev/transport.ts";
import type { JevCredentials, JevTransportKind } from "../jev/transport.ts";
import { redactSecrets } from "../redaction.ts";
import type {
  JevSetupDeps,
  JevSetupSelection,
  RenderRequester,
} from "./types.ts";

export interface JevSetupSubmenuOptions {
  afterSelection?: () => void;
  currentTransport: JevTransport;
  currentValue: string;
  done: (selectedValue?: string) => void;
  onSelection?: (selection: JevSetupSelection) => boolean;
  setupDeps?: JevSetupDeps;
  theme: Theme;
  tui: RenderRequester;
}

export type JevSetupOverrides = JevSetupDeps;
export type SetupMode =
  | "menu"
  | "key-entry"
  | "resolving"
  | "verifying"
  | "clearing";
export type SetupAction =
  | JevTransportKind
  | "clear-stored-key"
  | "disable"
  | "done"
  | "enter-key";

export interface JevSetupViewState {
  canEnterKey: boolean;
  credentials: JevCredentials | undefined;
  filterEnabled: boolean;
  mode: SetupMode;
  notice: string | undefined;
  selectedIndex: number;
  selectedTransport: JevTransportKind | undefined;
}

export const fireAndForget = async (
  action: Promise<unknown>,
  onError: (message: string) => void
): Promise<void> => {
  try {
    await action;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError(redactSecrets(message));
  }
};

export const providerName = (transport: JevTransportKind): string => {
  if (transport === "typesafe") {
    return "TypeSafe Jev";
  }
  if (transport === "openrouter") {
    return "OpenRouter (Pi login)";
  }
  return `OpenAI Decisions (${OPENAI_DECISIONS_MODEL})`;
};

export const transportLabel = (credentials: JevCredentials): string => {
  if (credentials.transport === "openrouter") {
    return "OpenRouter (reusing Pi login)";
  }
  if (credentials.transport === "openai-decisions") {
    let source = "verified API key";
    switch (credentials.source) {
      case "openai-bun-secrets": {
        source = "Bun.secrets";
        break;
      }
      case "openai-env": {
        source = "OPENAI_API_KEY";
        break;
      }
      case "openai-file": {
        source = "stored file, mode 0600";
        break;
      }
      case "openai-provider-credential": {
        source = "Pi stored API key";
        break;
      }
      default: {
        break;
      }
    }
    return `OpenAI Decisions (${OPENAI_DECISIONS_MODEL}; key: ${source})`;
  }
  switch (credentials.source) {
    case "advisor-json": {
      return "TypeSafe (key: advisor.json — plaintext, not recommended)";
    }
    case "bun-secrets": {
      return "TypeSafe (key: Bun.secrets)";
    }
    case "file": {
      return "TypeSafe (key: stored file, mode 0600)";
    }
    default: {
      return "TypeSafe (key: TYPESAFE_API_KEY)";
    }
  }
};

export const canClearCredential = (credentials: JevCredentials) =>
  credentials.source === "bun-secrets" ||
  credentials.source === "file" ||
  credentials.source === "openai-bun-secrets" ||
  credentials.source === "openai-file";

export const canReplaceWithEnteredKey = (credentials: JevCredentials) =>
  credentials.transport === "typesafe" ||
  (credentials.transport === "openai-decisions" &&
    (credentials.source === "openai-bun-secrets" ||
      credentials.source === "openai-file"));

export const defaultVerify = async (credentials: JevCredentials) => {
  const client = jevClientFromCredentials(credentials);
  try {
    await client.ask(
      { purpose: "pi-advisor setup verification" },
      { verified: noul("Answer yes.") }
    );
    return { ok: true };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
};

export const defaultSetupDeps: Required<JevSetupDeps> = {
  clearStoredKey: (transport) =>
    transport === "openai-decisions"
      ? clearOpenAIDecisionsKey()
      : clearKeyTypeSafeKey(),
  removePlaintextKey: removeTypeSafeKeyFromAdvisorJson,
  resolveTransport: (transport) =>
    transport ? resolveJevTransportFor(transport) : resolveJevTransport(),
  verify: defaultVerify,
  writeKey: (key, transport) =>
    transport === "openai-decisions"
      ? writeOpenAIDecisionsKey(key)
      : writeKeyTypeSafeKey(key),
};

export { consumePlaintextKeyWarning as consumeSetupPlaintextWarning } from "../jev/key-store.ts";
