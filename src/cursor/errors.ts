export class CursorApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "CursorApiError";
  }
}

export function cursorErrorForDiscord(error: unknown): string {
  if (!(error instanceof CursorApiError)) {
    return "Cursor could not be reached. Check the bot logs and try again.";
  }
  if (error.status === 401 || error.status === 403) {
    return "Cursor authentication failed. An administrator must check the API key and repository access.";
  }
  if (error.status === 404) {
    return "Cursor could not find the configured agent or repository. Check the project configuration.";
  }
  if (error.status === 409 && error.code === "agent_busy") {
    return "This agent is still running another prompt. Wait for it to finish, then retry.";
  }
  if (error.status === 429) {
    return "Cursor rate limit or quota was reached. Wait and try again, or check Cursor usage.";
  }
  if (error.status >= 500) {
    return "Cursor is temporarily unavailable. Please try again shortly.";
  }
  return `Cursor rejected the request: ${error.message}`;
}
