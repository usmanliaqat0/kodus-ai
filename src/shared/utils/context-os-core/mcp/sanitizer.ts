type MCPAllowedInput = Record<string, unknown>;

const SENSITIVE_KEYWORDS = ['secret', 'token', 'password', 'key', 'credential'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(
        value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            !(value instanceof Date),
    );
}

function redact(value: unknown): unknown {
    if (typeof value === 'string') {
        return '[redacted]';
    }
    if (Array.isArray(value)) {
        return value.map(() => '[redacted]');
    }
    if (isPlainObject(value)) {
        return Object.keys(value).reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = '[redacted]';
            return acc;
        }, {});
    }
    return undefined;
}

function sanitizeValue(key: string, value: unknown): unknown {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYWORDS.some((keyword) => lowerKey.includes(keyword))) {
        return redact(value);
    }

    if (Array.isArray(value)) {
        return value.map((item, index) =>
            typeof item === 'string'
                ? item
                : sanitizeValue(`${key}[${index}]`, item),
        );
    }

    if (isPlainObject(value)) {
        return sanitizeMCPInput(value);
    }

    return value;
}

export function sanitizeMCPInput(input: MCPAllowedInput): MCPAllowedInput {
    return Object.entries(input).reduce<MCPAllowedInput>((acc, [key, value]) => {
        const sanitized = sanitizeValue(key, value);
        if (sanitized !== undefined) {
            acc[key] = sanitized;
        }
        return acc;
    }, {});
}
