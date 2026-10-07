import { afterEach, describe, expect, test } from "bun:test";

import {
  setAdvisorJevFilterEnabledRef,
  setAdvisorJevTransportRef,
} from "../src/config/state.ts";
import { resetPlaintextKeyWarning } from "../src/jev/key-store.ts";
import type { JevCredentials, JevTransportKind } from "../src/jev/transport.ts";
import { JevSetupSubmenu } from "../src/ui/jev-setup-submenu.ts";
import { MaskedInput } from "../src/ui/masked-input.ts";
import type { JevSetupDeps, JevSetupSelection } from "../src/ui/types.ts";
import { plainThemeMock } from "./helpers/theme.ts";

const credentials = (
  transport: JevTransportKind,
  source?: JevCredentials["source"]
): JevCredentials => {
  const value: JevCredentials = { apiKey: "tsk-live-key", transport };
  if (source) {
    value.source = source;
  }
  return value;
};

/** Deps tests inject; hasSecretStore rides along unused by the submenu. */
type SetupDepsFixture = JevSetupDeps & { hasSecretStore?: () => boolean };

const openSetup = (
  options: {
    currentTransport?: "auto" | JevTransportKind;
    currentValue?: string;
    onSelection?: (selection: JevSetupSelection) => boolean;
    deps?: SetupDepsFixture;
  } = {}
) => {
  const results: (string | undefined)[] = [];
  const renders: string[] = [];
  const setup = new JevSetupSubmenu(
    {
      currentTransport: options.currentTransport ?? "auto",
      currentValue: options.currentValue ?? "Off",
      done: (value) => results.push(value),
      onSelection: options.onSelection,
      theme: plainThemeMock,
      tui: { requestRender: () => renders.push("render") },
    },
    {
      resolveTransport: () => Promise.resolve(undefined),
      verify: () => Promise.resolve({ ok: true }),
      ...options.deps,
    }
  );
  return { renders, results, setup };
};

const screen = (setup: JevSetupSubmenu) => setup.render(100).join("\n");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  setAdvisorJevFilterEnabledRef(false);
  setAdvisorJevTransportRef("auto");
  resetPlaintextKeyWarning();
});

describe("JevSetupSubmenu", () => {
  test("resolves and labels an OpenRouter login reuse", async () => {
    const { setup } = openSetup({
      deps: {
        resolveTransport: () => Promise.resolve(credentials("openrouter")),
      },
    });
    await settle();
    expect(screen(setup)).toContain("OpenRouter (reusing Pi login)");
    expect(screen(setup)).toContain("OpenRouter (Pi login)");
  });

  test("labels the plaintext advisor.json source as not recommended", async () => {
    const { setup } = openSetup({
      deps: {
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "advisor-json")),
      },
    });
    await settle();
    expect(screen(setup)).toContain("plaintext, not recommended");
    expect(screen(setup)).toContain("typesafe_api_key");
    resetPlaintextKeyWarning();
    const second = openSetup({
      deps: {
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "advisor-json")),
      },
    });
    await settle();
    expect(screen(second.setup)).toContain("plaintext, not recommended");
  });

  test("enables only after a successful live verification", async () => {
    let verified = 0;
    const { results, setup } = openSetup({
      deps: {
        resolveTransport: (transport) =>
          Promise.resolve(credentials(transport ?? "openrouter")),
        verify: () => {
          verified += 1;
          return Promise.resolve({
            message: "Jev authentication failed: 401",
            ok: false,
          });
        },
      },
    });
    await settle();
    setup.handleInput("\u001B[B");
    setup.handleInput("\r");
    await settle();
    expect(verified).toBe(1);
    expect(results).toEqual([]);
    expect(screen(setup)).toContain("Verification failed");
    expect(screen(setup)).toContain("Jev authentication failed: 401");
  });

  test("flips the flag on when verification succeeds", async () => {
    const { results, setup } = openSetup({
      deps: {
        resolveTransport: (transport) =>
          Promise.resolve(credentials(transport ?? "openrouter")),
      },
    });
    await settle();
    setup.handleInput("\u001B[B");
    setup.handleInput("\r");
    await settle();
    expect(results).toEqual(["On"]);
  });

  test("stores an entered key in Bun.secrets after verifying", async () => {
    const written: string[] = [];
    const { results, setup } = openSetup({
      deps: {
        hasSecretStore: () => true,
        writeKey: (key: string) => {
          written.push(key);
          return Promise.resolve({ message: "stored", ok: true });
        },
      },
    });
    await settle();
    setup.handleInput("\r");
    await settle();
    expect(screen(setup)).toContain("Paste a TypeSafe API key");
    for (const key of ["t", "s", "k", "-", "9"]) {
      setup.handleInput(key);
    }
    setup.handleInput("\r");
    await settle();
    expect(written).toEqual(["tsk-9"]);
    expect(results).toEqual(["On"]);
  });

  test("shows the fixed Decisions model and accepts a masked Platform key", async () => {
    const stored: { key: string; transport: JevTransportKind }[] = [];
    const { results, setup } = openSetup({
      deps: {
        resolveTransport: () => Promise.resolve(undefined),
        verify: (value) =>
          Promise.resolve({
            message: `verified ${value.transport}`,
            ok: true,
          }),
        writeKey: (key, transport) => {
          stored.push({ key, transport });
          return Promise.resolve({ message: "stored securely", ok: true });
        },
      },
    });
    await settle();
    setup.handleInput("\u001B[B");
    setup.handleInput("\u001B[B");
    setup.handleInput("\r");
    await settle();
    expect(screen(setup)).toContain("gpt-6-luna");
    expect(screen(setup)).toContain("Paste an OpenAI Platform API key");
    for (const key of "sk-platform-test") {
      setup.handleInput(key);
    }
    setup.handleInput("\r");
    await settle();
    expect(stored).toEqual([
      { key: "sk-platform-test", transport: "openai-decisions" },
    ]);
    expect(results).toEqual(["On"]);
    expect(screen(setup)).not.toContain("sk-platform-test");
    expect(screen(setup)).toContain("stored securely");
  });

  test("does not store or enable an OpenAI key when live verification fails", async () => {
    const stored: string[] = [];
    const { results, setup } = openSetup({
      deps: {
        resolveTransport: () => Promise.resolve(undefined),
        verify: () =>
          Promise.resolve({ message: "HTTP 401 invalid key", ok: false }),
        writeKey: (key) => {
          stored.push(key);
          return Promise.resolve({ message: "stored", ok: true });
        },
      },
    });
    await settle();
    setup.handleInput("\u001B[B");
    setup.handleInput("\u001B[B");
    setup.handleInput("\r");
    await settle();
    for (const key of "sk-invalid") {
      setup.handleInput(key);
    }
    setup.handleInput("\r");
    await settle();
    expect(stored).toEqual([]);
    expect(results).toEqual([]);
    expect(screen(setup)).toContain("HTTP 401 invalid key");
  });

  test("does not offer a replacement key while a Pi Platform API key resolves", async () => {
    const { setup } = openSetup({
      currentTransport: "openai-decisions",
      deps: {
        resolveTransport: () =>
          Promise.resolve(credentials("openai-decisions", "openai-env")),
        verify: () =>
          Promise.resolve({ message: "HTTP 401 invalid key", ok: false }),
      },
    });
    await settle();
    setup.handleInput("\u001B[B");
    setup.handleInput("\u001B[B");
    setup.handleInput("\r");
    await settle();
    expect(screen(setup)).toContain("Verification failed");
    expect(screen(setup)).not.toContain("Enter an OpenAI Platform API key");
  });

  test("does not enable when an OpenAI key cannot be stored securely", async () => {
    const { results, setup } = openSetup({
      deps: {
        resolveTransport: () => Promise.resolve(undefined),
        verify: () => Promise.resolve({ ok: true }),
        writeKey: (_key, transport) => {
          expect(transport).toBe("openai-decisions");
          return Promise.resolve({
            message: "Bun.secrets denied the write.",
            ok: false,
          });
        },
      },
    });
    await settle();
    setup.handleInput("\u001B[B");
    setup.handleInput("\u001B[B");
    setup.handleInput("\r");
    await settle();
    setup.handleInput("s");
    setup.handleInput("k");
    setup.handleInput("\r");
    await settle();
    expect(results).toEqual([]);
    expect(screen(setup)).toContain("Bun.secrets denied the write.");
  });

  test("reuses and verifies a Pi OpenAI Platform API key without copying it", async () => {
    let writes = 0;
    const { results, setup } = openSetup({
      currentTransport: "openai-decisions",
      deps: {
        resolveTransport: (transport) =>
          Promise.resolve(
            credentials(
              transport ?? "openai-decisions",
              "openai-provider-credential"
            )
          ),
        writeKey: () => {
          writes += 1;
          return Promise.resolve({ message: "unexpected copy", ok: true });
        },
      },
    });
    await settle();
    expect(screen(setup)).toContain("OpenAI Decisions (gpt-6-luna");
    expect(screen(setup)).toContain("Pi stored API key");
    expect(screen(setup)).not.toContain("tsk-live-key");
    setup.handleInput("\u001B[B");
    setup.handleInput("\u001B[B");
    setup.handleInput("\r");
    await settle();
    expect(results).toEqual(["On"]);
    expect(writes).toBe(0);
  });

  test("masks the entered key on screen", () => {
    const masked = new MaskedInput({});
    for (const key of ["t", "s", "k"]) {
      masked.handleInput(key);
    }
    expect(masked.render(40)[0]).toBe("•••█");
    expect(masked.render(40)[0]).not.toContain("tsk");
    expect(masked.getValue()).toBe("tsk");
  });

  test("stores the entered key securely even without Bun.secrets and enables", async () => {
    const written: string[] = [];
    const { results, setup } = openSetup({
      deps: {
        writeKey: (key: string) => {
          written.push(key);
          return Promise.resolve({
            message: "Key stored in ~/.pi/agent/typesafe_api_key (mode 0600).",
            ok: true,
          });
        },
      },
    });
    await settle();
    setup.handleInput("\r");
    await settle();
    setup.handleInput("t");
    setup.handleInput("s");
    setup.handleInput("k");
    setup.handleInput("\r");
    await settle();
    expect(written).toEqual(["tsk"]);
    expect(results).toEqual(["On"]);
    const screenText = screen(setup);
    expect(screenText).toContain("mode 0600");
    expect(screenText).not.toContain("tsk");
  });

  test("a store failure surfaces the env alternative without enabling", async () => {
    const { results, setup } = openSetup({
      deps: {
        hasSecretStore: () => true,
        writeKey: () =>
          Promise.resolve({
            message:
              "Storing the key in Bun.secrets failed: denied. Alternatively set the TYPESAFE_API_KEY environment variable in your shell profile.",
            ok: false,
          }),
      },
    });
    await settle();
    setup.handleInput("\r");
    await settle();
    setup.handleInput("t");
    setup.handleInput("\r");
    await settle();
    expect(screen(setup)).toContain("TYPESAFE_API_KEY");
    expect(results).toEqual([]);
  });

  test("disable keeps the key; disable-and-clear clears the stored secret", async () => {
    let cleared = 0;
    const { results, setup } = openSetup({
      currentValue: "On",
      deps: {
        clearStoredKey: () => {
          cleared += 1;
          return Promise.resolve({ message: "Stored key cleared.", ok: true });
        },
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "bun-secrets")),
      },
    });
    await settle();
    expect(screen(setup)).toContain("Disable and clear stored key");
    // Index 3 is plain Disable: it keeps the stored key.
    for (let step = 0; step < 3; step += 1) {
      setup.handleInput("\u001B[B");
    }
    setup.handleInput("\r");
    await settle();
    expect(results).toEqual(["Off"]);
    expect(cleared).toBe(0);
    // Reopen and pick Disable and clear stored key (index 4).
    const second = openSetup({
      currentValue: "On",
      deps: {
        clearStoredKey: () => {
          cleared += 1;
          return Promise.resolve({ message: "Stored key cleared.", ok: true });
        },
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "bun-secrets")),
      },
    });
    await settle();
    for (let step = 0; step < 4; step += 1) {
      second.setup.handleInput("\u001B[B");
    }
    second.setup.handleInput("\r");
    await settle();
    expect(second.results).toEqual(["Off"]);
    expect(cleared).toBe(1);
  });

  test("keeps the filter disabled when clearing its key fails after saving", async () => {
    const selections: JevSetupSelection[] = [];
    const { setup } = openSetup({
      currentTransport: "openai-decisions",
      currentValue: "On",
      deps: {
        clearStoredKey: () =>
          Promise.resolve({ message: "keychain deletion denied", ok: false }),
        resolveTransport: () =>
          Promise.resolve(credentials("openai-decisions", "openai-file")),
      },
      onSelection: (selection) => {
        selections.push(selection);
        return true;
      },
    });
    await settle();
    for (let step = 0; step < 4; step += 1) {
      setup.handleInput("\u001B[B");
    }
    setup.handleInput("\r");
    await settle();
    expect(selections).toEqual([
      { enabled: false, transport: "openai-decisions" },
    ]);
    expect(screen(setup)).toContain("Filter: Off");
    expect(screen(setup)).toContain("keychain deletion denied");
    expect(screen(setup)).toContain("Clear stored key");
  });

  test("does not clear a key when saving the disabled state fails", async () => {
    let cleared = 0;
    const { results, setup } = openSetup({
      currentTransport: "openai-decisions",
      currentValue: "On",
      deps: {
        clearStoredKey: () => {
          cleared += 1;
          return Promise.resolve({ message: "cleared", ok: true });
        },
        resolveTransport: () =>
          Promise.resolve(credentials("openai-decisions", "openai-file")),
      },
      onSelection: () => false,
    });
    await settle();
    for (let step = 0; step < 4; step += 1) {
      setup.handleInput("\u001B[B");
    }
    setup.handleInput("\r");
    await settle();
    expect(cleared).toBe(0);
    expect(results).toEqual([]);
    expect(screen(setup)).toContain("Filter: On");
    expect(screen(setup)).toContain("key was not cleared");
  });

  test("clears only the selected OpenAI provider key", async () => {
    let cleared: JevTransportKind | undefined;
    const { results, setup } = openSetup({
      currentTransport: "openai-decisions",
      currentValue: "On",
      deps: {
        clearStoredKey: (transport) => {
          cleared = transport;
          return Promise.resolve({ message: "OpenAI key cleared.", ok: true });
        },
        resolveTransport: () =>
          Promise.resolve(credentials("openai-decisions", "openai-file")),
      },
    });
    await settle();
    expect(screen(setup)).toContain("stored file, mode 0600");
    for (let step = 0; step < 4; step += 1) {
      setup.handleInput("\u001B[B");
    }
    setup.handleInput("\r");
    await settle();
    expect(cleared).toBe("openai-decisions");
    expect(results).toEqual(["Off"]);
  });

  test("keeps disable-and-clear open when deleting the stored key fails", async () => {
    const { renders, results, setup } = openSetup({
      currentValue: "On",
      deps: {
        clearStoredKey: () =>
          Promise.resolve({ message: "clear denied", ok: false }),
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "bun-secrets")),
      },
    });
    await settle();
    for (let step = 0; step < 4; step += 1) {
      setup.handleInput("\u001B[B");
    }
    setup.handleInput("\r");
    await settle();

    expect(results).toEqual([]);
    expect(screen(setup)).toContain("clear denied");
    expect(screen(setup)).toContain("Disable and clear stored key");
    expect(renders).toContain("render");
  });

  test("migrates a plaintext advisor.json key into Bun.secrets on enable", async () => {
    const written: string[] = [];
    let removedPlaintext = false;
    const { results, setup } = openSetup({
      deps: {
        hasSecretStore: () => true,
        removePlaintextKey: () => {
          removedPlaintext = true;
          return {
            message: "Plaintext key removed from advisor.json.",
            ok: true,
          };
        },
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "advisor-json")),
        writeKey: (key: string) => {
          written.push(key);
          return Promise.resolve({ message: "stored", ok: true });
        },
      },
    });
    await settle();
    setup.handleInput("\r");
    await settle();
    expect(written).toEqual(["tsk-live-key"]);
    expect(removedPlaintext).toBe(true);
    expect(results).toEqual(["On"]);
  });

  test("shows the OpenRouter fallback hint when nothing resolves", async () => {
    const { setup } = openSetup();
    await settle();
    const text = screen(setup);
    expect(text).toContain("Saved transport: auto");
    expect(text).toContain("OpenRouter (Pi login)");
  });

  test("allows disabling an enabled filter when credentials are unavailable", async () => {
    const { results, setup } = openSetup({ currentValue: "On" });
    await settle();
    expect(screen(setup)).toContain("Disable");
    for (let step = 0; step < 3; step += 1) {
      setup.handleInput("\u001B[B");
    }
    setup.handleInput("\r");
    expect(results).toEqual(["Off"]);
  });
});
