// Turns a raw `Instruction[]` (the exact wire shape from `@tari-project/ootle-ts-bindings`) into
// plain-English summaries for the approval popup, so a user reviews "Call method transfer on
// component_ab12…cd34" instead of a wall of JSON.
//
// Deliberately stops at the instruction's own structural fields (kind, method/function name,
// target address) — never the CBOR-encoded bytes inside `InstructionArg.Literal`. Those bytes
// need `InstructionArg::Literal` CBOR decoding to mean anything, and getting that wrong would
// show a wrong-but-plausible amount/argument, exactly the silent-failure class this codebase's
// own README calls out for its crypto ports. The raw JSON stays available below the friendly
// summary in the approval screen precisely so nothing is hidden, only made easier to skim first.
import type { Instruction, InstructionArg } from "@tari-project/ootle-ts-bindings";
import { t } from "../i18n";

function short(addr: string, n = 8): string {
  return addr.length > n * 2 + 3 ? `${addr.slice(0, n)}…${addr.slice(-n)}` : addr;
}

function describeArg(arg: InstructionArg): string {
  if (!arg || typeof arg !== "object" || Array.isArray(arg)) throw new Error("Invalid instruction argument");
  const keys = Object.keys(arg);
  if (keys.length !== 1) throw new Error("Invalid instruction argument");
  if (keys[0] === "Workspace" && typeof (arg as { Workspace?: unknown }).Workspace === "number") {
    return t("instr.workspaceSlot", { n: (arg as unknown as { Workspace: number }).Workspace });
  }
  if (keys[0] === "Blob" && typeof (arg as { Blob?: unknown }).Blob === "number") {
    return t("instr.blob", { n: (arg as { Blob: number }).Blob });
  }
  if (keys[0] === "Literal" && typeof (arg as { Literal?: unknown }).Literal === "string") return t("instr.encoded");
  throw new Error("Invalid instruction argument");
}

export interface InstructionSummary {
  title: string;
  detail?: string;
}

export function summarizeInstruction(instr: Instruction): InstructionSummary {
  if (instr === "DropAllProofsInWorkspace") return { title: t("instr.dropProofs") };
  if (!instr || typeof instr !== "object" || Array.isArray(instr)) throw new Error("Invalid instruction");
  const entries = Object.entries(instr);
  if (entries.length !== 1) throw new Error("Invalid instruction");
  const [kind, body] = entries[0] as [string, Record<string, unknown>];
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid instruction body");

  switch (kind) {
    case "CreateAccount":
      return { title: t("instr.createAccount") };
    case "CallFunction":
      if (typeof body.function !== "string" || typeof body.address !== "string") throw new Error("Invalid CallFunction instruction");
      return { title: t("instr.callFunction", { name: body.function }), detail: t("instr.onTemplate", { address: short(body.address) }) };
    case "CallMethod": {
      if (typeof body.method !== "string" || !body.call || typeof body.call !== "object") throw new Error("Invalid CallMethod instruction");
      const call = body.call as { Address?: string; Workspace?: number };
      if (typeof call.Address !== "string" && typeof call.Workspace !== "number") throw new Error("Invalid CallMethod target");
      const target = typeof call.Address === "string" ? short(call.Address) : t("instr.slot", { n: call.Workspace as number });
      return { title: t("instr.callMethod", { name: body.method }), detail: t("instr.on", { target }) };
    }
    case "PutLastInstructionOutputOnWorkspace":
      return { title: t("instr.saveResult") };
    case "ClaimBurn":
      return { title: t("instr.claimBurn") };
    case "ClaimValidatorFees":
      if (typeof body.address !== "string") throw new Error("Invalid ClaimValidatorFees instruction");
      return { title: t("instr.claimFees"), detail: t("instr.from", { address: short(body.address) }) };
    case "Assert":
      return { title: t("instr.assert") };
    case "TakeFromBucket":
      if (body.amount === undefined) throw new Error("Invalid TakeFromBucket instruction");
      return { title: t("instr.takeFromBucket"), detail: t("instr.amount", { amount: String(body.amount) }) };
    case "PublishTemplate":
      return { title: t("instr.publishTemplate") };
    case "AllocateAddress":
      return { title: t("instr.allocateAddress") };
    case "StealthTransfer":
      return { title: t("instr.stealthTransfer") };
    case "PayFeeFromBucket":
      return { title: t("instr.payFee") };
    case "UpdateComponentTemplate": {
      if (!body.component || typeof body.component !== "object") throw new Error("Invalid UpdateComponentTemplate instruction");
      const component = body.component as { Address?: string; Workspace?: number };
      if (typeof component.Address !== "string" && typeof component.Workspace !== "number") throw new Error("Invalid component target");
      const target = typeof component.Address === "string" ? short(component.Address) : t("instr.slot", { n: component.Workspace as number });
      return { title: t("instr.updateTemplate"), detail: t("instr.on", { target }) };
    }
    case "PutIntoBucket":
      return { title: t("instr.putIntoBucket") };
    default:
      throw new Error(`Unsupported instruction kind: ${kind}`);
  }
}

export function summarizeInstructionArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("instructions must be an array");
  return value.flatMap((instr, index) => {
    const summary = summarizeInstruction(instr as Instruction);
    const args = summarizeArgs(instr as Instruction);
    const details = [summary.detail, ...args.map((arg) => t("instr.argument", { arg }))].filter(Boolean);
    return [`${index + 1}. ${summary.title}${details.length ? ` — ${details.join("; ")}` : ""}`];
  });
}

/** Args are shown as a plain count of what kind of thing each is (see describeArg) — never their
 * decoded value. Returns [] for instruction kinds with no args array (most of them). */
export function summarizeArgs(instr: Instruction): string[] {
  if (instr === "DropAllProofsInWorkspace") return [];
  if (!instr || typeof instr !== "object" || Array.isArray(instr)) throw new Error("Invalid instruction");
  const entries = Object.entries(instr);
  if (entries.length !== 1) throw new Error("Invalid instruction");
  const body = entries[0][1];
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid instruction body");
  const args = (body as { args?: unknown }).args;
  if (args === undefined) return [];
  if (!Array.isArray(args)) throw new Error("Invalid instruction arguments");
  return args.map(describeArg);
}
