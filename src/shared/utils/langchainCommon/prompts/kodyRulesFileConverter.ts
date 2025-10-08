export const prompt_kodyRulesFileConverter_system = () => `
Convert repository rule files (Cursor, Claude, GitHub rules, coding standards, etc.) into a JSON array of Kody Rules.

IMPORTANT OUTPUT CONTRACT:
- Return ONLY a valid JSON array (never an object). If no valid rule, return [].
- Remove any key not in the whitelist before answering.

Each item MUST match exactly:
{"title": string, "rule": string, "path": string, "sourcePath": string, "severity": "low"|"medium"|"high"|"critical", "scope"?: "file"|"pull-request", "status"?: "active"|"pending"|"rejected"|"deleted", "examples": [{ "snippet": string, "isCorrect": boolean }], "sourceSnippet"?: string}

Detection: extract a rule only if the text imposes a requirement/restriction/convention/standard.

Fidelity requirement for "rule":
- Preserve ALL normative details from the source: constraints, conditions, exceptions, edge cases, and any "source of truth" paths/enums.
- Do not generalize or simplify. Convert lists/sections into a compact BUT complete rule text using RFC-2119 words (MUST/SHOULD/MUST NOT/EXCEPT).
- If exemptions exist, include them as "Exemptions: …" INSIDE the rule string.
- If a canonical file/path/enum is referenced, include it as "Source of truth: <path>." INSIDE the rule.
- Write the rule as 1–3 sentences (use semicolons/short clauses as needed).

Examples policy:
- Provide minimal snippets (1–2 lines).
- Prefer 1 example that is CORRECT due to an exemption (when exemptions exist).
- Provide 1 example that is INCORRECT for violating the main constraint.

Severity map: must/required/security/blocker → "high" or "critical"; should/warn → "medium"; tip/info/optional → "low".

Scope: "file" for code/content; "pull-request" for PR titles/descriptions/commits/reviewers/labels.

Status: "active" if mandatory; "pending" if suggestive; "deleted" if deprecated.

path (target GLOB): use declared globs/paths when present (frontmatter like "globs:" or explicit sections). If none, set "**/*". If multiple, join with commas (e.g., "services/**,api/**").

sourcePath: ALWAYS set to the exact file path provided in input (see INPUT FORMAT). If FILEPATH is missing, output [].

sourceSnippet: when possible, include an EXACT copy (verbatim) of the bullet/line/paragraph that led to this rule. Do NOT paraphrase. If none is suitable, omit this key.

Language: keep the rule language consistent with the source (EN or PT-BR).

Validation gate (must pass before answering):
- Output is a JSON array (not an object).
- For every item, keys ⊆ {title, rule, path, sourcePath, severity, scope, status, examples, sourceSnippet}.
- "rule" includes (a) the main constraint, (b) any exemptions if present in the source, (c) any "source of truth" path if present.
- If any check fails, fix and re-emit the array.

INPUT FORMAT (single file per call):
FILEPATH: <exact repository path to the file being converted>
CONTENT:
<full file contents>
`;

export const prompt_kodyRulesFileConverter_user = (payload: {
    filePath: string;
    content: string;
}) => `File: ${payload.filePath}

Content:
${payload.content}`;

