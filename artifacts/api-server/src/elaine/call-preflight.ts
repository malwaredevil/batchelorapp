import { z } from "zod/v4";

// Constraints, not destinations to dial: the verified account/contact remains
// the only source of the actual phone number.
export const callConstraintFields = {
  expectedDestination: z
    .string()
    .max(40)
    .transform((value) => value.replace(/[ ()-]/g, ""))
    .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/))
    .optional(),
  voicemailMessage: z.string().min(1).max(500).optional(),
  // Internal fail-closed flag set from the authenticated user's words.
  // Not advertised as an AI tool parameter.
  scriptClarificationRequired: z.boolean().optional(),
};
export const CallConstraintsSchema = z.object(callConstraintFields);
export type CallConstraints = z.infer<typeof CallConstraintsSchema>;

const PREFLIGHT_MESSAGES = {
  invalid_call_requirements:
    "No call was placed or scheduled: the calling requirements are invalid. Supply the destination in international +country-code format.",
  voicemail_script_unsupported:
    "No call was placed or scheduled: I cannot currently guarantee the requested script as voicemail on this call. I can call and deliver it after you answer, but only if you agree to omit the voicemail requirement.",
  call_destination_mismatch:
    "No call was placed or scheduled: the requested destination does not match the recipient's verified phone number. Check the recipient and number; I will not substitute another destination.",
  call_script_clarification_required:
    "No call was placed or scheduled: I could not safely identify the exact words to speak. Please provide one clearly quoted script, for example: say exactly “Bring tea”.",
} as const;

/** Only known, server-owned messages may cross the executor-error boundary. */
export function callPreflightUserMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const { code, attempted } = body as Record<string, unknown>;
  return attempted === false &&
    typeof code === "string" &&
    Object.hasOwn(PREFLIGHT_MESSAGES, code)
    ? PREFLIGHT_MESSAGES[code as keyof typeof PREFLIGHT_MESSAGES]
    : null;
}

function exactScriptRequirement(requestText: string): {
  script?: string;
  ambiguous: boolean;
  instructionText: string;
} {
  const marker =
    /\b(?:(?:say|saying|read|speak|deliver|repeat)(?:\s+(?:this|it|the following))?\s+exactly|exact\s+(?:(?:spoken|call)\s+)?(?:script|wording|words|message|text)|verbatim|word[ -]for[ -]word)\b/i.exec(
      requestText,
    );
  if (!marker) return { ambiguous: false, instructionText: requestText };
  const start = marker.index + marker[0].length;
  const suffix = requestText.slice(start);
  const prefix = /^(?:\s|[:—-]|(?:this|the following)\b)*/i.exec(suffix)![0];
  const quoted = suffix.slice(prefix.length);
  const close = (
    { '"': '"', "“": "”", "'": "'", "‘": "’" } as Record<string, string>
  )[quoted[0] ?? ""];
  if (!close) return { ambiguous: true, instructionText: requestText };
  const end = quoted.indexOf(close, 1);
  // Multiple potential closing quotes (including apostrophes) are ambiguous.
  // Ask rather than risking a truncated or rewritten external communication.
  if (end <= 1 || quoted.indexOf(close, end + 1) !== -1 || end - 1 > 500)
    return { ambiguous: true, instructionText: requestText };
  const script = quoted.slice(1, end);
  if (!script.trim()) return { ambiguous: true, instructionText: requestText };
  return {
    script,
    ambiguous: false,
    // Spoken text is data, not an instruction to leave voicemail or dial a number.
    instructionText: requestText.slice(0, start) + quoted.slice(end + 1),
  };
}

function requiresVoicemail(requestText: string): boolean {
  return requestText.split(/[.!?;,\n]|\bbut\b/i).some((clause) => {
    const affirmative = clause.replace(
      /\b(?:do not|don't|don’t|never)\s+(?:leave|deliver|play|send|record)\b.*$/i,
      "",
    );
    return (
      /\b(?:voice[ -]*mail|answering[ -]machine)\b/i.test(
        affirmative.replace(/\bno\s+voice[ -]*mail\b/gi, ""),
      ) ||
      /\bleav(?:e|ing)\s+(?:(?:him|her|them|me)\s+)?(?:(?:a|the|this|that|same|my)\s+){0,3}(?:message|text|script|recording)\b/i.test(
        affirmative,
      )
    );
  });
}

/** Bind explicit constraints from the actual user turn, never page/tool text. */
export function bindCallRequestConstraints(
  name: string,
  payload: unknown,
  requestText?: string,
): unknown {
  if (
    !["call_me", "call_contact"].includes(name) ||
    !requestText ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  )
    return payload;
  const supplied = payload as Record<string, unknown>;
  const exact = exactScriptRequirement(requestText);
  const numbers = [
    ...new Set(
      (exact.instructionText.match(/\+[1-9][\d ()-]{6,}\d/g) ?? []).map(
        (number) => number.replace(/[ ()-]/g, ""),
      ),
    ),
  ];
  const voicemailRequested = requiresVoicemail(exact.instructionText);
  return {
    ...supplied,
    ...(exact.script !== undefined
      ? name === "call_me"
        ? { greeting: exact.script }
        : { message: exact.script }
      : {}),
    ...(exact.ambiguous ? { scriptClarificationRequired: true } : {}),
    ...(numbers.length === 1 ? { expectedDestination: numbers[0] } : {}),
    // Ambiguous explicit numbers must be clarified rather than silently omitted.
    ...(numbers.length > 1 ? { expectedDestination: "ambiguous" } : {}),
    ...(voicemailRequested && supplied.voicemailMessage === undefined
      ? { voicemailMessage: "Requested voicemail delivery" }
      : {}),
  };
}

export const CALL_CONSTRAINT_TOOL_PROPERTIES = {
  expectedDestination: {
    type: "string",
    description:
      "If the user supplied a phone number, include it here in international +country-code format. It must match the verified recipient; this never authorizes dialing an arbitrary number.",
  },
  voicemailMessage: {
    type: "string",
    description:
      "If voicemail delivery is requested, include the exact requested text (copy the spoken script for 'leave the same message'). Never silently omit this requirement. Per-call voicemail scripts are currently unsupported: the server will explain that limitation without dialing.",
  },
} as const;

export function callPreflight(
  constraints: unknown,
  verifiedDestination?: string | null,
): {
  status: number;
  body: { error: string; code: string; attempted: false };
} | null {
  const parsed = CallConstraintsSchema.safeParse(constraints);
  if (!parsed.success) {
    return {
      status: 422,
      body: {
        code: "invalid_call_requirements",
        attempted: false,
        error: PREFLIGHT_MESSAGES.invalid_call_requirements,
      },
    };
  }
  if (parsed.data.voicemailMessage !== undefined) {
    // AgentPhone documents voicemailMessage on the shared agent, not on
    // POST /v1/calls. Never mutate shared defaults to emulate a per-call option.
    return {
      status: 422,
      body: {
        code: "voicemail_script_unsupported",
        attempted: false,
        error: PREFLIGHT_MESSAGES.voicemail_script_unsupported,
      },
    };
  }
  if (parsed.data.scriptClarificationRequired) {
    return {
      status: 422,
      body: {
        code: "call_script_clarification_required",
        attempted: false,
        error: PREFLIGHT_MESSAGES.call_script_clarification_required,
      },
    };
  }
  if (
    parsed.data.expectedDestination !== undefined &&
    verifiedDestination !== undefined &&
    parsed.data.expectedDestination !== verifiedDestination
  ) {
    return {
      status: 422,
      body: {
        code: "call_destination_mismatch",
        attempted: false,
        error: PREFLIGHT_MESSAGES.call_destination_mismatch,
      },
    };
  }
  return null;
}
