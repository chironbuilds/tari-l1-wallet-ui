import fs from "node:fs";
import grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";
import path from "node:path";

const HOST = process.env.GRPC_HOST || "grpc.tari.com:443";
const DESCRIPTOR_PROTO = path.join("node_modules", "protobufjs", "google", "protobuf", "descriptor.proto");

const reflRoot = new protobuf.Root();
reflRoot.add(
  new protobuf.Type("ServerReflectionRequest")
    .add(new protobuf.Field("host", 1, "string"))
    .add(new protobuf.Field("file_by_filename", 3, "string"))
    .add(new protobuf.Field("file_containing_symbol", 4, "string"))
    .add(new protobuf.Field("list_services", 7, "string")),
);
reflRoot.add(
  new protobuf.Type("ServerReflectionResponse")
    .add(new protobuf.Field("valid_host", 1, "string"))
    .add(new protobuf.Field("file_descriptor_response", 4, "FileDescriptorResponse"))
    .add(new protobuf.Field("error_response", 7, "ErrorResponse")),
);
reflRoot.add(
  new protobuf.Type("FileDescriptorResponse").add(
    new protobuf.Field("file_descriptor_proto", 1, "bytes", "repeated"),
  ),
);
reflRoot.add(
  new protobuf.Type("ErrorResponse")
    .add(new protobuf.Field("error_code", 1, "int32"))
    .add(new protobuf.Field("error_message", 2, "string")),
);
reflRoot.resolveAll();
const Req = reflRoot.lookupType("ServerReflectionRequest");
const Resp = reflRoot.lookupType("ServerReflectionResponse");

const descRoot = protobuf.loadSync(DESCRIPTOR_PROTO);
const FileDescriptorProto = descRoot.lookupType("google.protobuf.FileDescriptorProto");

const Client = grpc.makeGenericClientConstructor({}, "ReflectionService", {});
const client = new Client(HOST, grpc.credentials.createSsl());

function reflect(symbol) {
  return new Promise((resolve, reject) => {
    const call = client.makeBidiStreamRequest(
      "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo",
      (arg) => Req.encode(Req.fromObject(arg)).finish(),
      (buf) => Resp.toObject(Resp.decode(buf), { bytes: Buffer }),
    );
    call.write({ file_containing_symbol: symbol });
    call.end();
    const out = [];
    call.on("data", (d) => out.push(d));
    call.on("end", () => resolve(out));
    call.on("error", reject);
    setTimeout(() => call.cancel(), 20000);
  });
}

function findMessage(t, name) {
  for (const m of t.messageType ?? []) {
    if (m.name === name) return m;
    const nested = findMessage(m, name);
    if (nested) return nested;
  }
  return null;
}

function printFields(fd, msgName) {
  const m = findMessage(fd, msgName);
  if (!m) return false;
  console.log(`${msgName} (${fd.name}):`);
  for (const f of m.field ?? []) {
    console.log(`  ${String(f.number).padStart(2)}: ${f.name} :: ${f.typeName || f.type}${f.label === 3 ? " []" : ""}`);
  }
  return true;
}

async function main() {
  for (const symbol of ["tari.rpc.TransactionInput", "tari.rpc.TransactionOutput"]) {
    const resps = await reflect(symbol);
    let found = false;
    const seen = new Set();
    for (const r of resps) {
      if (r.errorResponse?.errorMessage) {
        console.log(`[reflection error] ${r.errorResponse.errorMessage}`);
        continue;
      }
      for (const fdBytes of r.fileDescriptorResponse?.fileDescriptorProto ?? []) {
        const fd = FileDescriptorProto.toObject(FileDescriptorProto.decode(fdBytes), { defaults: true });
        if (seen.has(fd.name)) continue;
        seen.add(fd.name);
        if (printFields(fd, "TransactionInput")) found = true;
        if (printFields(fd, "TransactionOutput")) found = true;
      }
    }
    if (!found && !resps.length) console.log("[reflection] no response for", symbol);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("reflection failed:", e?.message || e);
    process.exit(1);
  },
);
