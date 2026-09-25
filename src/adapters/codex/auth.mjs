import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeSecretFile } from "../../fs-utils.mjs";
import { run } from "../../process.mjs";

const minimumValidityMs = 60 * 60 * 1000;

/**
 * Gives the isolated home short-lived credentials borrowed from the main home.
 *
 * The refresh token is deliberately left behind. ChatGPT refresh tokens rotate,
 * so two homes holding the same one can invalidate each other and log the main
 * Codex out. Without it, the isolated instance can use the current access token
 * but can never rotate anything.
 */
export async function borrowAuth({ sourceHome, targetHome }) {
  const sourceFile = path.join(sourceHome, "auth.json");
  let source;
  try {
    source = JSON.parse(await readFile(sourceFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `No ${sourceFile}. Sign in to Codex first, or set "auth": "login" if your credentials live in the keychain.`,
      );
    }
    throw new Error(`Could not read ${sourceFile}: ${error.message}`);
  }

  let borrowed;
  if (source.tokens?.access_token) {
    const expiresAt = jwtExpiry(source.tokens.access_token);
    if (expiresAt !== null && expiresAt - Date.now() < minimumValidityMs) {
      throw new Error(
        "Your Codex access token has expired or expires within the hour. Open your main Codex once so it refreshes, then try again.",
      );
    }
    borrowed = {
      auth_mode: source.auth_mode,
      OPENAI_API_KEY: null,
      tokens: {
        id_token: source.tokens.id_token,
        access_token: source.tokens.access_token,
        refresh_token: "",
        account_id: source.tokens.account_id,
      },
      last_refresh: source.last_refresh,
    };
  } else if (source.OPENAI_API_KEY) {
    borrowed = { auth_mode: source.auth_mode ?? "apikey", OPENAI_API_KEY: source.OPENAI_API_KEY };
  } else {
    throw new Error(`${sourceFile} has no usable credentials. Sign in to Codex first.`);
  }

  await writeSecretFile(path.join(targetHome, "auth.json"), `${JSON.stringify(borrowed, null, 2)}\n`);
  return { expiresAt: source.tokens?.access_token ? jwtExpiry(source.tokens.access_token) : null };
}

export async function interactiveLogin({ cli, env }) {
  await run(cli, ["login"], { env, inherit: true });
}

export function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
