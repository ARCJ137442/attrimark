#!/usr/bin/env bun

const BASE_URL = process.env.PROVENANCE_API ?? "http://localhost:12479/api";

async function request(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);

  if (res.status === 204) return null;

  const data = await res.json();
  if (!res.ok) {
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  return data;
}

function out(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function usage(): never {
  console.error(`Usage: provenance-editor <command> [args]

Commands:
  doc list                                List documents
  doc get <id>                            Get document with blocks and stats
  doc create --title <title>              Create document
  doc delete <id>                         Delete document

  block list <doc-id>                     List blocks
  block create <doc-id> -c <content>      Create block
  block update <doc-id> <bid> -c <content>  Update block content
  block patch <doc-id> <bid> --old <s> --new <s>  Patch block
  block split <doc-id> <bid> --pos <N>     Split block at position N
  block merge <doc-id> <bid> --target <tid>  Merge bid into tid
  block delete <doc-id> <bid>             Delete block

  stats <doc-id>                          Get document stats
  export <doc-id> [--full]                Export document
  import <file.md> [--source human|agent] [--provenance <file>]

Options:
  --human           Set author.type to human (default: agent)
  --name <name>     Set author.name`);
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
if (args.length === 0) usage();

function findFlag(flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

function findOption(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val;
}

const isHuman = findFlag("--human");
const authorName = findOption("--name");
const author = { type: isHuman ? "human" as const : "agent" as const, name: authorName };

async function main() {
  const cmd = args[0];
  const sub = args[1];

  switch (cmd) {
    case "doc": {
      switch (sub) {
        case "list":
          return out(await request("GET", "/documents"));
        case "get": {
          const id = args[2];
          if (!id) usage();
          return out(await request("GET", `/documents/${id}`));
        }
        case "create": {
          const title = findOption("--title") ?? "Untitled";
          return out(await request("POST", "/documents", { title }));
        }
        case "delete": {
          const id = args[2];
          if (!id) usage();
          await request("DELETE", `/documents/${id}`);
          return out({ deleted: true });
        }
        default:
          usage();
      }
      break;
    }

    case "block": {
      const docId = args[2];
      if (!docId) usage();

      switch (sub) {
        case "list":
          return out(await request("GET", `/documents/${docId}/blocks`));
        case "create": {
          const content = findOption("-c") ?? "";
          return out(
            await request("POST", `/documents/${docId}/blocks`, {
              content,
              author,
            })
          );
        }
        case "update": {
          const bid = args[3];
          if (!bid) usage();
          const content = findOption("-c") ?? "";
          // Need to get current version first
          const block = (await request("GET", `/documents/${docId}/blocks`)) as any[];
          const current = block.find((b: any) => b.id === bid);
          if (!current) {
            console.error("Block not found");
            process.exit(1);
          }
          return out(
            await request("PUT", `/documents/${docId}/blocks/${bid}`, {
              content,
              author,
              version: current.version,
            })
          );
        }
        case "patch": {
          const bid = args[3];
          if (!bid) usage();
          const oldStr = findOption("--old");
          const newStr = findOption("--new");
          if (!oldStr || !newStr) usage();
          // Get current version
          const blocks = (await request("GET", `/documents/${docId}/blocks`)) as any[];
          const current = blocks.find((b: any) => b.id === bid);
          if (!current) {
            console.error("Block not found");
            process.exit(1);
          }
          return out(
            await request("PATCH", `/documents/${docId}/blocks/${bid}`, {
              old: oldStr,
              new: newStr,
              author,
              version: current.version,
            })
          );
        }
        case "split": {
          const bid = args[3];
          if (!bid) usage();
          const posStr = findOption("--pos");
          if (!posStr) usage();
          const pos = parseInt(posStr!, 10);
          const blocks2 = (await request("GET", `/documents/${docId}/blocks`)) as any[];
          const current2 = blocks2.find((b: any) => b.id === bid);
          if (!current2) {
            console.error("Block not found");
            process.exit(1);
          }
          return out(
            await request("POST", `/documents/${docId}/blocks/${bid}/split`, {
              position: pos,
              version: current2.version,
            })
          );
        }
        case "merge": {
          const bid = args[3];
          if (!bid) usage();
          const targetId = findOption("--target");
          if (!targetId) usage();
          const blocks3 = (await request("GET", `/documents/${docId}/blocks`)) as any[];
          const source = blocks3.find((b: any) => b.id === bid);
          const target = blocks3.find((b: any) => b.id === targetId);
          if (!source || !target) {
            console.error("Block not found");
            process.exit(1);
          }
          return out(
            await request("POST", `/documents/${docId}/blocks/${bid}/merge`, {
              targetBlockId: targetId,
              version: source.version,
              targetVersion: target.version,
              author,
            })
          );
        }
        case "delete": {
          const bid = args[3];
          if (!bid) usage();
          const blocks = (await request("GET", `/documents/${docId}/blocks`)) as any[];
          const current = blocks.find((b: any) => b.id === bid);
          if (!current) {
            console.error("Block not found");
            process.exit(1);
          }
          await request("DELETE", `/documents/${docId}/blocks/${bid}`, {
            version: current.version,
          });
          return out({ deleted: true });
        }
        default:
          usage();
      }
      break;
    }

    case "stats": {
      const docId = args[1];
      if (!docId) usage();
      return out(await request("GET", `/documents/${docId}/stats`));
    }

    case "export": {
      const docId = args[1];
      if (!docId) usage();
      const full = findFlag("--full");
      const format = full ? "full" : "md";
      const res = await fetch(`${BASE_URL}/documents/${docId}/export?format=${format}`);
      if (!res.ok) {
        console.error(await res.text());
        process.exit(1);
      }
      if (format === "md") {
        console.log(await res.text());
      } else {
        out(await res.json());
      }
      return;
    }

    case "import": {
      const file = args[1];
      if (!file) usage();
      const source = findOption("--source") ?? "agent";
      const provFile = findOption("--provenance");

      const markdown = await Bun.file(file).text();
      let provenance;
      if (provFile) {
        provenance = JSON.parse(await Bun.file(provFile).text());
      }

      return out(
        await request("POST", "/documents/import", {
          markdown,
          provenance,
          defaultSource: source,
        })
      );
    }

    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
