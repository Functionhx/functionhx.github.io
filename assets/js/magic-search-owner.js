// Hidden sections are published repository content, not confidential storage.
// Fetch their sources only after GitHub verifies the owner's actual credential.
// This module never reads the encrypted private repository or persists prose.
const OWNER = "Functionhx";
const REPOSITORY = "Functionhx/functionhx.github.io";

export function parseOwnerRecord(path, source, language) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return null;
  const scalar = (key) => {
    const raw = match[1].match(new RegExp(`^${key}:([^\\r\\n]*)`, "m"))?.[1]?.trim() || "";
    if (raw.startsWith('"')) {
      try {
        return String(JSON.parse(raw));
      } catch {
        return "__invalid";
      }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
    return raw.replace(/\s+#.*$/, "").trim();
  };
  const privacy = scalar("private").toLowerCase();
  const visibility = scalar("visibility").toLowerCase();
  const published = scalar("published").toLowerCase();
  const draft = scalar("draft").toLowerCase();
  // Do not turn an unsupported YAML value or malformed private flag into public.
  if ((privacy && privacy !== "false") || (draft && draft !== "false")) return null;
  if (visibility && !["public", "unlisted"].includes(visibility)) return null;
  if (published && published !== "true") return null;
  if (scalar("lang") !== language) return null;
  const url = scalar("permalink");
  const title = scalar("title");
  const key = scalar("translation_key");
  if (!title || !key || !/^\/(?!\/)[^\s<>"\\]*$/.test(url) || key === "search") return null;
  const text = match[2]
    .replace(/{%[\s\S]*?%}|{{[\s\S]*?}}/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return { id: `owner:${path}`, translation_key: key, title, url, text, date: scalar("date").slice(0, 10) };
}

export async function loadOwnerRecords({ language, signal, publicKeys, auth = window.functionhxGitHubAuth, request = window.fetch.bind(window) }) {
  const session = await auth?.restore({ owner: OWNER, repository: REPOSITORY });
  if (!session?.token || signal.aborted) return null;
  const checkSession = async () => {
    const current = await auth.restore({ owner: OWNER, repository: REPOSITORY });
    if (signal.aborted || current?.token !== session.token) throw new DOMException("Owner search locked", "AbortError");
  };
  const get = async (path) => {
    await checkSession();
    const response = await request(`https://api.github.com${path}`, {
      cache: "no-store",
      credentials: "omit",
      signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${session.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`Owner search request failed (${response.status})`);
    return response.json();
  };
  const identity = await get("/user");
  if (String(identity.login).toLowerCase() !== OWNER.toLowerCase()) throw new Error("Owner identity required");
  const tree = await get(`/repos/${REPOSITORY}/git/trees/main?recursive=1`);
  if (tree.truncated) throw new Error("Owner source listing is incomplete");
  const files = (tree.tree || []).filter(
    (entry) => entry.type === "blob" && new RegExp(`^_(?:pages|posts|news|projects|books|teachings)/[^/]+-${language}\\.md$`).test(entry.path)
  );
  const records = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, files.length) }, async () => {
      while (next < files.length) {
        const file = files[next++];
        if (!/^[a-f0-9]{40,64}$/.test(file.sha)) throw new Error("Invalid source identifier");
        const blob = await get(`/repos/${REPOSITORY}/git/blobs/${file.sha}`);
        if (blob.encoding !== "base64") throw new Error("Unsupported source encoding");
        const source = new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g, "")), (character) => character.charCodeAt(0)));
        const record = parseOwnerRecord(file.path, source, language);
        if (record && !publicKeys.has(record.translation_key)) records.push(record);
      }
    })
  );
  await checkSession();
  return records;
}
