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

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/plain")) {
    const text = await res.text();
    if (!res.ok) {
      console.error(text);
      process.exit(1);
    }
    return text;
  }

  const data = await res.json();
  if (!res.ok) {
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  return data;
}

function out(data: unknown) {
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

function q(filePath: string): string {
  return `path=${encodeURIComponent(filePath)}`;
}

function usage(): never {
  console.error(`Usage: attrimark <command> [args]

Commands:
  read <file.attrimark>                     Output Markdown content
  read <file.attrimark> --json              Output full JSON structure

  doc list [--dir <dir>]                    List documents in directory
  doc get <file.attrimark>                  Get document with blocks and stats
  doc create <file.attrimark> --title <t>   Create document
  doc delete <file.attrimark>               Delete document

  block list <file.attrimark>               List blocks
  block create <file.attrimark> -c <text>   Create block
  block update <file.attrimark> <bid> -c <text>  Update block
  block patch <file.attrimark> <bid> --old <s> --new <s>  Patch block
  block split <file.attrimark> <bid> --pos <N>  Split block
  block merge <file.attrimark> <bid> --target <tid>  Merge blocks
  block delete <file.attrimark> <bid>       Delete block

  stats <file.attrimark>                    Get document stats
  export <file.attrimark> [--full]          Export document
  import <file.md> --output <out.attrimark> [--source human|agent]

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
const jsonFlag = findFlag("--json");

async function main() {
  const cmd = args[0];
  const sub = args[1];

  switch (cmd) {
    case "read": {
      const file = args[1];
      if (!file) usage();
      if (jsonFlag) {
        return out(await request("GET", `/documents/detail?${q(file)}`));
      } else {
        return out(await request("GET", `/export?${q(file)}&format=md`));
      }
    }

    case "doc": {
      switch (sub) {
        case "list": {
          const dir = findOption("--dir") ?? process.cwd();
          return out(await request("GET", `/documents?dir=${encodeURIComponent(dir)}`));
        }
        case "get": {
          const file = args[2];
          if (!file) usage();
          return out(await request("GET", `/documents/detail?${q(file)}`));
        }
        case "create": {
          const file = args[2];
          if (!file) usage();
          const title = findOption("--title") ?? "Untitled";
          return out(await request("POST", "/documents", { title, path: file }));
        }
        case "delete": {
          const file = args[2];
          if (!file) usage();
          await request("DELETE", `/documents?${q(file)}`);
          return out({ deleted: true });
        }
        default:
          usage();
      }
      break;
    }

    case "block": {
      const file = args[2];
      if (!file) usage();

      switch (sub) {
        case "list":
          return out(await request("GET", `/blocks?${q(file)}`));
        case "create": {
          const content = findOption("-c") ?? "";
          return out(
            await request("POST", `/blocks?${q(file)}`, {
              content,
              author,
            })
          );
        }
        case "update": {
          const bid = args[3];
          if (!bid) usage();
          const content = findOption("-c") ?? "";
          const blocks = (await request("GET", `/blocks?${q(file)}`)) as any[];
          const current = blocks.find((b: any) => b.id === bid);
          if (!current) {
            console.error("Block not found");
            process.exit(1);
          }
          return out(
            await request("PUT", `/blocks/${bid}?${q(file)}`, {
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
          const blocks = (await request("GET", `/blocks?${q(file)}`)) as any[];
          const current = blocks.find((b: any) => b.id === bid);
          if (!current) {
            console.error("Block not found");
            process.exit(1);
          }
          return out(
            await request("PATCH", `/blocks/${bid}?${q(file)}`, {
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
          const blocks = (await request("GET", `/blocks?${q(file)}`)) as any[];
          const current = blocks.find((b: any) => b.id === bid);
          if (!current) {
            console.error("Block not found");
            process.exit(1);
          }
          return out(
            await request("POST", `/blocks/${bid}/split?${q(file)}`, {
              position: pos,
              version: current.version,
            })
          );
        }
        case "merge": {
          const bid = args[3];
          if (!bid) usage();
          const targetId = findOption("--target");
          if (!targetId) usage();
          const blocks = (await request("GET", `/blocks?${q(file)}`)) as any[];
          const source = blocks.find((b: any) => b.id === bid);
          const target = blocks.find((b: any) => b.id === targetId);
          if (!source || !target) {
            console.error("Block not found");
            process.exit(1);
          }
          return out(
            await request("POST", `/blocks/${bid}/merge?${q(file)}`, {
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
          const blocks = (await request("GET", `/blocks?${q(file)}`)) as any[];
          const current = blocks.find((b: any) => b.id === bid);
          if (!current) {
            console.error("Block not found");
            process.exit(1);
          }
          await request("DELETE", `/blocks/${bid}?${q(file)}`, {
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
      const file = args[1];
      if (!file) usage();
      return out(await request("GET", `/stats?${q(file)}`));
    }

    case "export": {
      const file = args[1];
      if (!file) usage();
      const full = findFlag("--full");
      if (full) {
        return out(await request("GET", `/export?${q(file)}&format=full`));
      } else {
        return out(await request("GET", `/export?${q(file)}&format=md`));
      }
    }

    case "import": {
      const mdFile = args[1];
      if (!mdFile) usage();
      const outputPath = findOption("--output");
      if (!outputPath) usage();
      const source = findOption("--source") ?? "agent";
      const markdown = await Bun.file(mdFile).text();
      return out(
        await request("POST", "/import", {
          markdown,
          path: outputPath,
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
