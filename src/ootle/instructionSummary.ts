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

function short(addr: string, n = 8): string {
  return addr.length > n * 2 + 3 ? `${addr.slice(0, n)}…${addr.slice(-n)}` : addr;
}

function describeArg(arg: InstructionArg): string {
  if ("Workspace" in arg) return "a value from earlier in this transaction";
  if ("Blob" in arg) return `attached data blob #${arg.Blob}`;
  return "an encoded value"; // Literal — CBOR bytes, deliberately not decoded, see file header.
}

export interface InstructionSummary {
  title: string;
  detail?: string;
}

export function summarizeInstruction(instr: Instruction): InstructionSummary {
  if (instr === "DropAllProofsInWorkspace") return { title: "Drop all proofs" };

  const [kind, body] = Object.entries(instr)[0] as [string, Record<string, unknown>];

  switch (kind) {
    case "CreateAccount":
      return { title: "Create a new account" };
    case "CallFunction":
      return {
        title: `Call function "${body.function as string}"`,
        detail: `on template ${short(body.address as string)}`,
      };
    case "CallMethod": {
      const call = body.call as { Address?: string; Workspace?: number };
      const target = call.Address ? short(call.Address) : `a value from earlier in this transaction`;
      return { title: `Call method "${body.method as string}"`, detail: `on ${target}` };
    }
    case "PutLastInstructionOutputOnWorkspace":
      return { title: "Save the previous result for later in this transaction" };
    case "ClaimBurn":
      return { title: "Claim a burned Minotari (L1) output" };
    case "ClaimValidatorFees":
      return { title: "Claim validator fees", detail: `from ${short(body.address as string)}` };
    case "Assert":
      return { title: "Assert a condition holds" };
    case "TakeFromBucket":
      return { title: "Take from a bucket", detail: `amount: ${String(body.amount)}` };
    case "PublishTemplate":
      return { title: "Publish a new template (smart contract code)" };
    case "AllocateAddress":
      return { title: "Allocate a new address" };
    case "StealthTransfer":
      return { title: "Stealth transfer" };
    case "PayFeeFromBucket":
      return { title: "Pay the transaction fee from a bucket" };
    case "UpdateComponentTemplate": {
      const component = body.component as { Address?: string; Workspace?: number };
      const target = component.Address ? short(component.Address) : "a value from earlier in this transaction";
      return { title: "Update a component's template", detail: `on ${target}` };
    }
    case "PutIntoBucket":
      return { title: "Move a value into a bucket" };
    default:
      return { title: kind };
  }
}

/** Args are shown as a plain count of what kind of thing each is (see describeArg) — never their
 * decoded value. Returns [] for instruction kinds with no args array (most of them). */
export function summarizeArgs(instr: Instruction): string[] {
  if (instr === "DropAllProofsInWorkspace") return [];
  const [, body] = Object.entries(instr)[0] as [string, Record<string, unknown>];
  const args = body.args as InstructionArg[] | undefined;
  if (!args || args.length === 0) return [];
  return args.map(describeArg);
}
